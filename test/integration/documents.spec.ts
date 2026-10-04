import { INestApplication } from '@nestjs/common';
import { mkdtemp, readdir, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { actorFixture, businessFixture, createTestApp } from './helpers';

describe('private document lifecycle', () => {
  let app: INestApplication;
  let directory: string;
  const previousDirectory = process.env.DOCUMENT_STORAGE_DIR;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orbita-documents-test-'));
    process.env.DOCUMENT_STORAGE_DIR = directory;
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
    for (const name of await readdir(directory)) await unlink(join(directory, name));
    await rmdir(directory);
    if (previousDirectory) process.env.DOCUMENT_STORAGE_DIR = previousDirectory;
    else delete process.env.DOCUMENT_STORAGE_DIR;
  });
  it('uploads, downloads, reviews and replaces documents without exposing storage or crossing tenant boundaries', async () => {
    const owner = await businessFixture(app);
    const other = await businessFixture(app);
    const admin = await actorFixture(app, 'ADMIN');
    const driver = await actorFixture(app, 'DRIVER');
    const api = request(app.getHttpServer());
    const bytes = Buffer.from('%PDF-1.4\nDocument integration fixture\n%%EOF');
    const uploaded = await api
      .post('/api/v1/documents')
      .auth(owner.accessToken, { type: 'bearer' })
      .field('entityType', 'BUSINESS')
      .field('entityId', owner.business.id)
      .field('type', 'BUSINESS')
      .attach('file', bytes, { filename: 'cadastro.pdf', contentType: 'application/pdf' })
      .expect(201);
    const document = uploaded.body as { id: string; status: string; storageKey?: string; sha256?: string };
    expect(document.status).toBe('PENDING');
    expect(document.storageKey).toBeUndefined();
    expect(document.sha256).toBeUndefined();
    const download = await api
      .get(`/api/v1/documents/${document.id}/content`)
      .auth(owner.accessToken, { type: 'bearer' })
      .expect(200);
    expect(download.body).toEqual(bytes);
    expect(download.headers['cache-control']).toContain('no-store');
    expect(download.headers['content-disposition']).toContain('attachment');
    await api
      .get(`/api/v1/documents/${document.id}/content`)
      .auth(other.accessToken, { type: 'bearer' })
      .expect(403);
    await api
      .get('/api/v1/documents')
      .query({ entityType: 'BUSINESS', entityId: owner.business.id })
      .auth(driver.accessToken, { type: 'bearer' })
      .expect(403);
    await api
      .patch(`/api/v1/documents/${document.id}/review`)
      .auth(owner.accessToken, { type: 'bearer' })
      .send({ status: 'APPROVED', notes: 'Validado' })
      .expect(403);
    await api
      .patch(`/api/v1/documents/${document.id}/review`)
      .auth(admin.accessToken, { type: 'bearer' })
      .send({ status: 'REJECTED', notes: 'Envie uma versão legível.' })
      .expect(200);
    const replacement = await api
      .post('/api/v1/documents')
      .auth(owner.accessToken, { type: 'bearer' })
      .field('entityType', 'BUSINESS')
      .field('entityId', owner.business.id)
      .field('type', 'BUSINESS')
      .field('replacesId', document.id)
      .attach('file', bytes, { filename: 'nova-versao.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(replacement.body).toMatchObject({ replacesId: document.id, status: 'PENDING' });
    const list = await api
      .get('/api/v1/documents')
      .query({ entityType: 'BUSINESS', entityId: owner.business.id })
      .auth(owner.accessToken, { type: 'bearer' })
      .expect(200);
    expect(list.body).toHaveLength(2);
    const driverId = driver.actor.driverId;
    if (!driverId) throw new Error('Driver fixture did not create a driver');
    await api
      .post('/api/v1/documents')
      .auth(driver.accessToken, { type: 'bearer' })
      .field('entityType', 'DRIVER')
      .field('entityId', driverId)
      .field('type', 'IDENTITY')
      .attach('file', bytes, { filename: 'id.pdf', contentType: 'application/pdf' })
      .expect(201);
  });
  it('rejects forged content types, unknown content, oversized files and uploads for other owners', async () => {
    const owner = await businessFixture(app);
    const other = await businessFixture(app);
    const api = request(app.getHttpServer());
    const upload = (bytes: Buffer, mimeType: string, entityId = owner.business.id) =>
      api
        .post('/api/v1/documents')
        .auth(owner.accessToken, { type: 'bearer' })
        .field('entityType', 'BUSINESS')
        .field('entityId', entityId)
        .field('type', 'BUSINESS')
        .attach('file', bytes, { filename: 'file.pdf', contentType: mimeType });
    await upload(Buffer.from('<script>evil</script>'), 'application/pdf').expect(400);
    await upload(Buffer.from('%PDF-1.4\nhello'), 'image/png').expect(400);
    await upload(Buffer.from('%PDF-1.4\nhello'), 'application/pdf', other.business.id).expect(403);
    await upload(Buffer.alloc(5 * 1024 * 1024 + 1), 'application/pdf').expect(413);
    await api.get('/api/v1/documents/policy').expect(401);
  });
});
