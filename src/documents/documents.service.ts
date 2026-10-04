import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PrismaService } from '../infra/prisma.service';
import { Actor } from '../common/actor';
import { DomainError } from '../common/domain-error';
import { DocumentOwnerDto, ReviewDocumentDto, UploadDocumentDto } from './documents.dto';
export type UploadedDocument = { buffer: Buffer; originalname: string; mimetype: string; size: number };
export const documentPolicy = {
  maxBytes: 5 * 1024 * 1024,
  mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
  extensions: ['.pdf', '.jpg', '.jpeg', '.png'],
  types: ['IDENTITY', 'VEHICLE', 'BUSINESS', 'OTHER'],
  requiredTypes: [] as string[],
};

function safeFileName(value: string) {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || character === '\\' || character === '/' ? '_' : character;
  }).join('').slice(0, 180);
}
export function documentMime(bytes: Buffer) {
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  throw new DomainError('INVALID_DOCUMENT', 'Only PDF, JPEG and PNG files are accepted', 400);
}
@Injectable()
export class DocumentsService {
  constructor(private readonly db: PrismaService) {}
  assertOwner(actor: Actor, owner: DocumentOwnerDto) {
    if (actor.role === 'ADMIN') return;
    if (owner.entityType === 'DRIVER' && actor.role === 'DRIVER' && actor.driverId === owner.entityId) return;
    if (
      owner.entityType === 'BUSINESS' &&
      ['BUSINESS_OWNER', 'BUSINESS_STAFF'].includes(actor.role) &&
      actor.businessId === owner.entityId
    )
      return;
    throw new DomainError('DOCUMENT_FORBIDDEN', 'Document is not accessible', 403);
  }
  private view(row: { storageKey: string; sha256: string; [key: string]: unknown }) {
    const { storageKey: _key, sha256: _hash, ...metadata } = row;
    void _key;
    void _hash;
    return metadata;
  }
  async list(actor: Actor, owner: DocumentOwnerDto) {
    this.assertOwner(actor, owner);
    const rows = await this.db.document.findMany({ where: owner, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((row) => this.view(row));
  }
  async upload(actor: Actor, dto: UploadDocumentDto, file?: UploadedDocument) {
    this.assertOwner(actor, dto);
    if (!file?.buffer.length || file.size > documentPolicy.maxBytes)
      throw new DomainError('INVALID_DOCUMENT', 'Choose a file up to 5 MB', 400);
    const mimeType = documentMime(file.buffer);
    if (mimeType !== file.mimetype)
      throw new DomainError('INVALID_DOCUMENT', 'File content does not match its type', 400);
    const target =
      dto.entityType === 'BUSINESS'
        ? await this.db.business.findUnique({ where: { id: dto.entityId } })
        : await this.db.driver.findUnique({ where: { id: dto.entityId } });
    if (!target) throw new DomainError('NOT_FOUND', 'Owner not found', 404);
    if (dto.replacesId) {
      const previous = await this.db.document.findUnique({ where: { id: dto.replacesId } });
      if (
        !previous ||
        previous.entityId !== dto.entityId ||
        previous.entityType !== dto.entityType ||
        previous.type !== dto.type
      )
        throw new DomainError('DOCUMENT_FORBIDDEN', 'Invalid document revision', 403);
    }
    const directory = resolve(process.env.DOCUMENT_STORAGE_DIR || '.data/documents');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const storageKey = randomUUID();
    const filePath = join(directory, storageKey);
    await writeFile(filePath, file.buffer, { flag: 'wx', mode: 0o600 });
    try {
      return await this.db.transaction(async (tx) => {
        const row = await tx.document.create({
          data: {
            entityType: dto.entityType,
            entityId: dto.entityId,
            type: dto.type,
            expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
            replacesId: dto.replacesId,
            uploadedById: actor.id,
            fileName: safeFileName(file.originalname),
            mimeType,
            sizeBytes: file.size,
            storageKey,
            sha256: createHash('sha256').update(file.buffer).digest('hex'),
          },
        });
        await tx.auditLog.create({
          data: { actorId: actor.id, action: 'document.uploaded', entityType: 'Document', entityId: row.id },
        });
        return this.view(row);
      });
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  }
  async content(actor: Actor, id: string) {
    const row = await this.db.document.findUnique({ where: { id } });
    if (!row) throw new DomainError('NOT_FOUND', 'Document not found', 404);
    this.assertOwner(actor, { entityType: row.entityType as 'BUSINESS' | 'DRIVER', entityId: row.entityId });
    if (!/^[0-9a-f-]{36}$/.test(row.storageKey))
      throw new DomainError('DOCUMENT_UNAVAILABLE', 'Document unavailable', 503);
    const buffer = await readFile(
      join(resolve(process.env.DOCUMENT_STORAGE_DIR || '.data/documents'), row.storageKey),
    ).catch(() => {
      throw new DomainError('DOCUMENT_UNAVAILABLE', 'Document unavailable', 503);
    });
    if (createHash('sha256').update(buffer).digest('hex') !== row.sha256)
      throw new DomainError('DOCUMENT_UNAVAILABLE', 'Document integrity check failed', 503);
    return { buffer, mimeType: row.mimeType, fileName: row.fileName };
  }
  async review(actor: Actor, id: string, dto: ReviewDocumentDto) {
    if (actor.role !== 'ADMIN') throw new DomainError('FORBIDDEN', 'Administrator required', 403);
    return this.db.transaction(async (tx) => {
      const row = await tx.document.update({
        where: { id },
        data: { status: dto.status, reviewNotes: dto.notes, reviewedAt: new Date(), reviewedById: actor.id },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'document.reviewed',
          entityType: 'Document',
          entityId: id,
          metadata: { status: dto.status },
        },
      });
      return this.view(row);
    });
  }
}
