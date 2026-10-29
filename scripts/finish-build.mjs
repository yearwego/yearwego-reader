// Renames the single-file build and records its SHA-256 in the README.
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

const built = 'dist/index.html';
const target = 'dist/yearwego-reader.html';
renameSync(built, target);

const bytes = readFileSync(target);
const sha256 = createHash('sha256').update(bytes).digest('hex');
writeFileSync(`${target}.sha256`, `${sha256}  yearwego-reader.html\n`);

const readme = readFileSync('README.md', 'utf8');
const updated = readme.replace(
  /<!-- sha256 -->[\s\S]*?<!-- \/sha256 -->/,
  `<!-- sha256 -->\`${sha256}\`<!-- /sha256 -->`,
);
writeFileSync('README.md', updated);

console.log(`${target}: ${(bytes.length / 1024 / 1024).toFixed(2)} MB, sha256 ${sha256}`);
