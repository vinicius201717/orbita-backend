import { loadTestEnvironment } from '../scripts/test-environment';
import { applyTestSecrets } from './test-secrets';
loadTestEnvironment();
// Fixed test secrets are applied only after refusing unsafe database targets.
applyTestSecrets();
process.env.MAPS_PROVIDER = 'mock';
process.env.WHATSAPP_ENABLED = 'false';
process.env.SMART_POOL_WAIT_SECONDS = '0';
process.env.ECONOMY_POOL_WAIT_SECONDS = '0';
process.env.WHATSAPP_APP_SECRET = 'test-whatsapp-app-secret';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
