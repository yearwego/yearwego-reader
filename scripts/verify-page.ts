import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embeddedWasm, findWasmBase64, listedWasmSha256s, sha256 } from './wasm.ts';

export interface Check {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLISHED_SHA256_FILE = join(ROOT, 'dist/yearwego-reader.html.sha256');

function wasmChecks(html: string): Check[] {
  const found = findWasmBase64(html);
  const expected = embeddedWasm();
  const checks: Check[] = expected.map((wasm) => {
    const name = `${wasm.packageName} ${wasm.version} WebAssembly`;
    const matches = found.filter((blob) => blob.bytes.equals(wasm.bytes));
    if (matches.length === 1) {
      return {
        name,
        status: 'pass',
        detail: `identical to ${wasm.packageName}/${wasm.sourceFile}, ${wasm.bytes.length} bytes, SHA-256 ${wasm.sha256}`,
      };
    }
    return {
      name,
      status: 'fail',
      detail:
        matches.length === 0
          ? `no blob in the page matches ${wasm.packageName}/${wasm.sourceFile} (SHA-256 ${wasm.sha256})`
          : `${matches.length} copies in the page; the build embeds one`,
    };
  });

  const unknown = found.filter((blob) => !expected.some((wasm) => blob.bytes.equals(wasm.bytes)));
  checks.push({
    name: 'No other WebAssembly',
    status: unknown.length === 0 ? 'pass' : 'fail',
    detail:
      unknown.length === 0
        ? `the page holds ${found.length} WebAssembly blobs, all accounted for`
        : unknown.map((blob) => `unrecognised blob at character ${blob.offset}, SHA-256 ${blob.sha256}`).join('; '),
  });

  const listed = listedWasmSha256s(html);
  const wanted = expected.map((wasm) => wasm.sha256);
  const agrees = listed.length === wanted.length && wanted.every((hash) => listed.includes(hash));
  checks.push({
    name: 'The page’s own WebAssembly table',
    status: agrees ? 'pass' : 'fail',
    detail: agrees
      ? 'the leading comment lists the same SHA-256s'
      : `the leading comment lists ${listed.join(', ') || 'nothing'}`,
  });
  return checks;
}

function publishedChecksum(pageSha256: string): Check {
  const name = 'Published SHA-256';
  if (!existsSync(PUBLISHED_SHA256_FILE)) {
    return { name, status: 'fail', detail: 'dist/yearwego-reader.html.sha256 is missing' };
  }
  const published = readFileSync(PUBLISHED_SHA256_FILE, 'utf8').split(/\s+/)[0];
  return published === pageSha256
    ? { name, status: 'pass', detail: `matches dist/yearwego-reader.html.sha256 (${published})` }
    : { name, status: 'fail', detail: `dist/yearwego-reader.html.sha256 says ${published}` };
}

/** Builds the page into a temporary folder, leaving dist/ and the README untouched, and returns its SHA-256. */
export function freshBuildSha256(): string {
  const outDir = mkdtempSync(join(tmpdir(), 'yearwego-reader-verify-'));
  try {
    const vite = join(ROOT, 'node_modules/vite/bin/vite.js');
    const result = spawnSync(
      process.execPath,
      [vite, 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
    );
    if (result.status !== 0) throw new Error(`vite build exited with ${result.status ?? result.signal}`);
    return sha256(readFileSync(join(outDir, 'index.html')));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

function rebuildCheck(pageSha256: string, rebuild: boolean): Check {
  const name = 'Fresh build';
  if (!rebuild) return { name, status: 'skip', detail: 'pass --rebuild to build from source and compare' };
  try {
    const built = freshBuildSha256();
    return built === pageSha256
      ? { name, status: 'pass', detail: `a build from this checkout has the same SHA-256 (${built})` }
      : { name, status: 'fail', detail: `a build from this checkout has SHA-256 ${built}` };
  } catch (error) {
    return { name, status: 'fail', detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Every check for one copy of the built page. */
export function verifyPage(page: Buffer, options: { rebuild?: boolean } = {}): { sha256: string; checks: Check[] } {
  const pageSha256 = sha256(page);
  return {
    sha256: pageSha256,
    checks: [
      ...wasmChecks(page.toString('utf8')),
      publishedChecksum(pageSha256),
      rebuildCheck(pageSha256, options.rebuild ?? false),
    ],
  };
}
