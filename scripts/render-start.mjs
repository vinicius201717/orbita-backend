import process from 'node:process';
import { Buffer } from 'node:buffer';
import { log } from 'node:console';

// Render generates 256-bit secrets as base64; the application expects hex.
if (!process.env.OUTBOX_ENCRYPTION_KEY && process.env.OUTBOX_ENCRYPTION_KEY_BASE64) {
  const encoded = process.env.OUTBOX_ENCRYPTION_KEY_BASE64;
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error('OUTBOX_ENCRYPTION_KEY_BASE64 must encode exactly 32 bytes');
  }
  process.env.OUTBOX_ENCRYPTION_KEY = key.toString('hex');
}

if (!process.env.PUBLIC_BASE_URL && process.env.RENDER_EXTERNAL_URL) {
  process.env.PUBLIC_BASE_URL = process.env.RENDER_EXTERNAL_URL;
}

const mode = process.argv[2];
if (mode === '--check-config') {
  const { environmentSchema } = await import('../dist/config/config.service.js');
  environmentSchema.parse(process.env);
  log('Render configuration is valid.');
} else if (mode === 'api') {
  await import('../dist/main.js');
} else if (mode === 'worker') {
  await import('../dist/worker.js');
} else {
  throw new Error('Usage: node scripts/render-start.mjs api|worker|--check-config');
}
