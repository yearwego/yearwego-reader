import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import type { ArchiveFile, SqlLoader } from '../src/core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const loadSql: SqlLoader = () =>
  initSqlJs({
    wasmBinary: new Uint8Array(readFileSync(path.join(root, 'node_modules/sql.js/dist/sql-wasm.wasm')))
      .buffer as ArrayBuffer,
  });

export function fixture(name: string): ArchiveFile {
  return { name, bytes: new Uint8Array(readFileSync(path.join(root, 'fixtures', name))) };
}

export function vectors() {
  return JSON.parse(readFileSync(path.join(root, 'spec/vectors.json'), 'utf8'));
}

export const GOLDEN = 'golden.yearwego.backup.zip';
export const GOLDEN_NO_MILESTONES = 'golden-no-milestones.yearwego.backup.zip';
export const GOLDEN_SECOND_PASSPHRASE = 'golden-second-passphrase.yearwego.backup.zip';
