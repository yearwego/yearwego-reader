import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verifyPage } from '../scripts/verify-page.ts';
import { embeddedWasm, findWasmBase64, wasmMarkdown } from '../scripts/wasm.ts';

const built = readFileSync('dist/yearwego-reader.html');

function statuses(page: Buffer, rebuild = false) {
  return Object.fromEntries(verifyPage(page, { rebuild }).checks.map((check) => [check.name, check.status]));
}

describe('verify', () => {
  it('passes every check on the committed build, including a fresh build', () => {
    const { checks } = verifyPage(built, { rebuild: true });
    expect(checks.map((check) => [check.name, check.status])).toEqual([
      ['libsodium-sumo 0.8.4 WebAssembly', 'pass'],
      ['sql.js 1.14.2 WebAssembly', 'pass'],
      ['No other WebAssembly', 'pass'],
      ['The page’s own WebAssembly table', 'pass'],
      ['Published SHA-256', 'pass'],
      ['Fresh build', 'pass'],
    ]);
  });

  it('fails when one byte of embedded WebAssembly changes', () => {
    const text = built.toString('utf8');
    const sql = embeddedWasm().find((wasm) => wasm.packageName === 'sql.js')!;
    const blob = findWasmBase64(text).find((found) => found.bytes.equals(sql.bytes))!;
    const at = blob.offset + 1000;
    const tampered = Buffer.from(text.slice(0, at) + (text[at] === 'A' ? 'B' : 'A') + text.slice(at + 1), 'utf8');
    expect(statuses(tampered)).toMatchObject({
      'libsodium-sumo 0.8.4 WebAssembly': 'pass',
      'sql.js 1.14.2 WebAssembly': 'fail',
      'No other WebAssembly': 'fail',
      'Published SHA-256': 'fail',
      'Fresh build': 'skip',
    });
  });

  it('fails the checksum when anything outside the WebAssembly changes', () => {
    const tampered = Buffer.from(built.toString('utf8').replace('Download everything', 'Download everythinG'), 'utf8');
    expect(statuses(tampered)).toMatchObject({
      'sql.js 1.14.2 WebAssembly': 'pass',
      'No other WebAssembly': 'pass',
      'Published SHA-256': 'fail',
    });
  });

  it('lists the same WebAssembly in the README', () => {
    expect(readFileSync('README.md', 'utf8')).toContain(wasmMarkdown(embeddedWasm()));
  });
});
