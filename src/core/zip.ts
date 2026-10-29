import { unzipSync, zipSync, type Zippable } from 'fflate';
import { ReaderError } from './errors';

export type ZipEntries = Map<string, Uint8Array>;

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function readZip(bytes: Uint8Array, onFailure: 'not-a-backup' | 'damaged'): ZipEntries {
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes);
  } catch (error) {
    throw new ReaderError(onFailure, error instanceof Error ? error.message : String(error));
  }
  const entries: ZipEntries = new Map();
  for (const [name, data] of Object.entries(raw)) {
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;
    entries.set(name, data);
  }
  return entries;
}

export function findBySuffix(entries: ZipEntries, suffix: string): [string, Uint8Array] | null {
  for (const [name, data] of entries) {
    if (name.endsWith(suffix)) return [name, data];
  }
  return null;
}

/** Entries are stored, not deflated, when they are already compressed (audio). */
export function writeZip(files: { path: string; data: Uint8Array; compress: boolean }[]): Uint8Array {
  const tree: Zippable = {};
  for (const file of files) {
    tree[file.path] = [file.data, { level: file.compress ? 6 : 0 }];
  }
  return zipSync(tree);
}
