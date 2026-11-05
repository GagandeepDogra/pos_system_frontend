// Fails when a built JavaScript bundle is over the 150 KB gzip budget (fast screen open, REQ-125).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const BUDGET = 150 * 1024;
const dir = process.argv[2] ?? 'apps/pos-web/dist/assets';
if (!existsSync(dir)) { console.error(`No build at ${dir}: run npm run build first.`); process.exit(1); }
let failed = false;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
  const size = gzipSync(readFileSync(join(dir, f))).length;
  const over = size > BUDGET;
  failed ||= over;
  console.log(`${over ? 'OVER' : 'ok  '} ${f} ${(size / 1024).toFixed(1)} KB gzip (budget 150 KB)`);
}
process.exit(failed ? 1 : 0);
