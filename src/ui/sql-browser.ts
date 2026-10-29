import initSqlJs from 'sql.js';
import wasmBase64 from 'virtual:sql-wasm-base64';
import type { SqlLoader } from '../core';

// Decoded here rather than fetched: the page’s Content-Security-Policy allows no fetches at
// all, data URLs included.
function bytesFromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

let loaded: ReturnType<SqlLoader> | null = null;

export const loadSqlInBrowser: SqlLoader = () => {
  loaded ??= initSqlJs({ wasmBinary: bytesFromBase64(wasmBase64) as unknown as ArrayBuffer });
  return loaded;
};
