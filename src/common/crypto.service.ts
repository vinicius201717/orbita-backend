import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { ConfigService } from '../config/config.service';
const scryptAsync = promisify(scrypt);
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [algorithm, salt, encoded] = hash.split(':');
  if (algorithm !== 'scrypt' || !salt || !encoded) return false;
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(encoded, 'hex');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
@Injectable()
export class CryptoService {
  constructor(private readonly config: ConfigService) {}
  hash(value: string): string {
    return createHmac('sha256', this.config.get('PIN_PEPPER')).update(value).digest('hex');
  }
  pin(): string {
    return randomInt(0, 10000).toString().padStart(4, '0');
  }
  token(): string {
    return randomBytes(32).toString('base64url');
  }
  matches(value: string, hash: string): boolean {
    const actual = Buffer.from(this.hash(value), 'hex');
    const expected = Buffer.from(hash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  encrypt(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(this.config.get('OUTBOX_ENCRYPTION_KEY'), 'hex'),
      iv,
    );
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
  }
  decrypt(value: string): unknown {
    const [iv, tag, body] = value.split('.');
    if (!iv || !tag || !body) throw new Error('Invalid ciphertext');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(this.config.get('OUTBOX_ENCRYPTION_KEY'), 'hex'),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(
      Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8'),
    ) as unknown;
  }
}
