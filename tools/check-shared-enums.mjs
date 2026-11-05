// Fails when an enum is defined in an app instead of packages/shared.
import { readFileSync } from 'node:fs';
import { findEnumDefinitions, listFiles } from './checks.mjs';

const files = listFiles('apps', ['.ts', '.tsx']).filter((f) => !/\.test\.tsx?$/.test(f));
const problems = files.flatMap((f) =>
  findEnumDefinitions(readFileSync(f, 'utf8')).map((m) => `${f}:${m.line}: define enums in packages/shared: ${m.text.trim()}`),
);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('shared enums: no app-local enums');
