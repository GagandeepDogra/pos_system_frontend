// Fails when en.json and hi.json do not have the same keys, or a value is empty.
import { join } from 'node:path';
import { diffLocaleKeys, LOCALES_DIR, readJson } from './checks.mjs';

const { missingInHi, missingInEn, empty } = diffLocaleKeys(
  readJson(join(LOCALES_DIR, 'en.json')),
  readJson(join(LOCALES_DIR, 'hi.json')),
);
const problems = [
  ...missingInHi.map((k) => `missing in hi.json: ${k}`),
  ...missingInEn.map((k) => `missing in en.json: ${k}`),
  ...empty.map((k) => `empty value: ${k}`),
];
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('i18n: en and hi keys match');
