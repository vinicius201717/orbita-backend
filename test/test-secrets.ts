export function applyTestSecrets(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL ??= 'postgresql://orbita:orbita_local_only@localhost:54432/orbita_test?schema=public';
  process.env.REDIS_URL ??= 'redis://localhost:56379/1';
  process.env.CORS_ORIGINS ??= 'http://localhost:3001';
  process.env.JWT_SECRET = 'test-access-secret-00000000000000000000';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-000000000000000000';
  process.env.PIN_PEPPER = 'test-pin-pepper-00000000000000000000000';
  process.env.OUTBOX_ENCRYPTION_KEY = 'a'.repeat(64);
}
