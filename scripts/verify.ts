import { readFileSync } from 'node:fs';
import { verifyPage } from './verify-page.ts';
import { sha256 } from './wasm.ts';

const args = process.argv.slice(2);
const rebuild = args.includes('--rebuild');
const paths = args.filter((arg) => arg !== '--rebuild');

if (paths.length !== 1) {
  console.error('Usage: npm run verify -- <path to yearwego-reader.html> [--rebuild]');
  process.exit(2);
}

const path = paths[0]!;
const page = readFileSync(path);
console.log(`Checking ${path} (${page.length} bytes, SHA-256 ${sha256(page)})\n`);

const { checks } = verifyPage(page, { rebuild });
const label = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' } as const;
for (const check of checks) console.log(`${label[check.status]}  ${check.name}: ${check.detail}`);

const failed = checks.filter((check) => check.status === 'fail').length;
if (failed > 0) {
  console.log(`\n${failed} of ${checks.length} checks failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
