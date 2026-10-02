import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env')) {
  console.log('.env already exists; it was preserved.');
} else {
  let content = readFileSync('.env.example', 'utf8');
  for (const key of [
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'PIN_PEPPER',
    'OUTBOX_ENCRYPTION_KEY',
    'SEED_PASSWORD',
  ])
    content = content.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${randomBytes(32).toString('hex')}`);
  writeFileSync('.env', content, { mode: 0o600 });
  console.log('Local .env created with random development secrets. Never commit this file.');
}
