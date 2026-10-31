import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageDirectory } from './licenses.ts';

export interface EmbeddedWasm {
  packageName: string;
  version: string;
  /** The file inside the package that holds the WebAssembly. */
  sourceFile: string;
  /** Whether the package ships a .wasm file or a base64 string inside its JavaScript. */
  shippedAs: 'wasm file' | 'base64 in JS';
  bytes: Buffer;
  sha256: string;
}

export interface FoundWasm {
  offset: number;
  base64: string;
  bytes: Buffer;
  sha256: string;
}

// "\0asm" followed by version 1 starts every WebAssembly module, and encodes to "AGFzbQEAAAA".
const WASM_BASE64 = /(?<![A-Za-z0-9+/])AGFzbQEAAAA[A-Za-z0-9+/]*={0,2}/g;

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Every base64 run in `text` that decodes to a WebAssembly module. */
export function findWasmBase64(text: string): FoundWasm[] {
  return [...text.matchAll(WASM_BASE64)].map((match) => {
    const bytes = Buffer.from(match[0], 'base64');
    return { offset: match.index, base64: match[0], bytes, sha256: sha256(bytes) };
  });
}

function readPackage(directory: string): { name: string; version: string } {
  return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name: string; version: string };
}

function fromPackage(directory: string, sourceFile: string, shippedAs: EmbeddedWasm['shippedAs']): EmbeddedWasm {
  const { name, version } = readPackage(directory);
  const contents = readFileSync(join(directory, sourceFile));
  let bytes: Buffer = contents;
  if (shippedAs === 'base64 in JS') {
    const found = findWasmBase64(contents.toString('utf8'));
    if (found.length !== 1) {
      throw new Error(`Expected one base64 WebAssembly module in ${name}/${sourceFile}, found ${found.length}.`);
    }
    bytes = found[0]!.bytes;
  }
  return { packageName: name, version, sourceFile, shippedAs, bytes, sha256: sha256(bytes) };
}

/** The WebAssembly the page embeds, read from the installed npm packages it is bundled from. */
export function embeddedWasm(): EmbeddedWasm[] {
  const wrappers = packageDirectory('libsodium-wrappers-sumo');
  return [
    // libsodium-wrappers-sumo's ESM build imports libsodium-sumo's, which carries its wasm as base64.
    fromPackage(packageDirectory('libsodium-sumo', wrappers), 'dist/modules-sumo-esm/libsodium-sumo.mjs', 'base64 in JS'),
    fromPackage(packageDirectory('sql.js'), 'dist/sql-wasm-browser.wasm', 'wasm file'),
  ];
}

export function sqlWasm(): EmbeddedWasm {
  return embeddedWasm().find((wasm) => wasm.packageName === 'sql.js')!;
}

function describe(wasm: EmbeddedWasm): string {
  const where = wasm.shippedAs === 'base64 in JS' ? `${wasm.sourceFile} (as base64)` : wasm.sourceFile;
  return `${wasm.packageName} ${wasm.version}, ${where}, ${wasm.bytes.length} bytes`;
}

/** An HTML comment naming each embedded WebAssembly module and the SHA-256 of its decoded bytes. */
export function wasmComment(modules: EmbeddedWasm[]): string {
  const intro = [
    'WebAssembly: this file embeds the compiled libraries below as base64, unchanged from their npm packages.',
    'Decode one and its SHA-256 matches the file named here. In the reader’s repository,',
    '“npm run verify” followed by the path to this file checks each one byte for byte.',
  ].join('\n');
  const rows = modules.map((wasm) => `${describe(wasm)}\nSHA-256 ${wasm.sha256}`);
  return `<!--\n${intro}\n\n${rows.join('\n\n')}\n-->`;
}

/** The SHA-256s a built page's leading WebAssembly comment lists. */
export function listedWasmSha256s(html: string): string[] {
  const comment = /<!--\nWebAssembly:[\s\S]*?-->/.exec(html)?.[0] ?? '';
  return [...comment.matchAll(/^SHA-256 ([0-9a-f]{64})$/gm)].map((match) => match[1]!);
}

/** The same table as Markdown, for the README. */
export function wasmMarkdown(modules: EmbeddedWasm[]): string {
  const rows = modules.map(
    (wasm) =>
      `| ${wasm.packageName} | ${wasm.version} | \`${wasm.sourceFile}\`${wasm.shippedAs === 'base64 in JS' ? ' (as base64)' : ''} | ${wasm.bytes.length.toLocaleString('en-US')} | \`${wasm.sha256}\` |`,
  );
  return ['| Package | Version | File | Bytes | SHA-256 of the WebAssembly |', '| --- | --- | --- | --- | --- |', ...rows].join(
    '\n',
  );
}
