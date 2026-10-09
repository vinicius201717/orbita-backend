import { spawnSync } from 'node:child_process';
import { loadTestEnvironment } from './test-environment';

loadTestEnvironment();
const migrate = process.argv[2] === '--migrate';
const command = migrate ? 'node_modules/prisma/build/index.js' : 'node_modules/jest/bin/jest.js';
const args = migrate ? ['migrate', 'deploy'] : ['--runInBand', '--config', 'jest.integration.config.cjs', ...process.argv.slice(2)];
console.log(migrate ? 'Migrating the isolated local orbita_test database.' : 'Integration targets verified: local orbita_test and Redis database 1.');
const result = spawnSync(process.execPath, [command, ...args], { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
