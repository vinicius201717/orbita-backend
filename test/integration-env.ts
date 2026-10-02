import './env';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://orbita:orbita_local_only@localhost:54432/orbita_test?schema=public';
process.env.MAPS_PROVIDER = 'mock';
process.env.WHATSAPP_ENABLED = 'false';
process.env.SMART_POOL_WAIT_SECONDS = '0';
process.env.ECONOMY_POOL_WAIT_SECONDS = '0';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:56379/1';
process.env.WHATSAPP_APP_SECRET = 'test-whatsapp-app-secret';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
