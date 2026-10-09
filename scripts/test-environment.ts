import { config } from 'dotenv';

export function assertTestTargets(databaseUrl: string, redisUrl: string): void {
  const database = new URL(databaseUrl);
  const redis = new URL(redisUrl);
  const local = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !local.has(database.hostname) || database.pathname !== '/orbita_test' || (database.searchParams.get('schema') ?? 'public') !== 'public')
    throw new Error('Integration refused: PostgreSQL must be local and use the dedicated orbita_test database/public schema.');
  if (redis.protocol !== 'redis:' || !local.has(redis.hostname) || redis.pathname !== '/1')
    throw new Error('Integration refused: Redis must be local and use dedicated database 1.');
}

export function loadTestEnvironment(): void {
  config({ quiet: true });
  if (process.env.NODE_ENV === 'production') throw new Error('Integration refused in NODE_ENV=production.');
  const databaseUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://orbita:orbita_local_only@localhost:54432/orbita_test?schema=public';
  const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://localhost:56379/1';
  assertTestTargets(databaseUrl, redisUrl);
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.TEST_DATABASE_URL = databaseUrl;
  process.env.TEST_REDIS_URL = redisUrl;
  process.env.NODE_ENV = 'test';
}
