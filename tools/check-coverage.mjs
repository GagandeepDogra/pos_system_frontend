// Fails when any file in a storage/ or billing/ module is below 80% coverage.
// Run after `vitest run --coverage` (reads coverage/coverage-summary.json).
import { existsSync } from 'node:fs';
import { coverageFailures, readJson } from './checks.mjs';

const path = 'coverage/coverage-summary.json';
if (!existsSync(path)) {
  console.error(`${path} not found: run vitest with --coverage first`);
  process.exit(1);
}
const failures = coverageFailures(readJson(path), process.cwd());
if (failures.length) {
  console.error(`storage/billing coverage below 80%:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('coverage: storage and billing modules at or above 80%');
