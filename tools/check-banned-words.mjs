// Fails when a staff-screen translation file uses a technical word ('Invoice', 'Submit KOT', 'Void line').
import { readFileSync } from 'node:fs';
import { findBannedWords, listFiles, LOCALES_DIR } from './checks.mjs';

const problems = listFiles(LOCALES_DIR, ['.json']).flatMap((f) =>
  findBannedWords(readFileSync(f, 'utf8')).map((w) => `${f}: banned word /${w}/`),
);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('banned words: none found');
