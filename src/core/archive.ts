import {
  aad,
  deriveKey,
  fromBase64UrlNoPadding,
  isSupportedKdf,
  open,
  normalizePassphrase,
  ready,
  splitPacked,
  wipe,
  type KdfParams,
  type PackedParts,
} from './crypto';
import { isOutOfMemory, ReaderError } from './errors';
import { verifyManifest, type IntegrityReport, type Manifest } from './manifest';
import { findBySuffix, isZip, readZip, type ZipEntries } from './zip';

export const BACKUP_FORMAT_VERSION = 1;

const HEADER_SUFFIX = '.yearwego.header.json';
const SEALED_SUFFIX = '.yearwego.data.encrypted';

export type ArchiveFile = { name: string; bytes: Uint8Array };

export type BackupHeader = {
  salt: string;
  backupFormatVersion: number;
  kdfParams: KdfParams;
};

export type ProgressStep =
  | 'reading'
  | 'unlocking-backup'
  | 'checking'
  | 'opening-database'
  | 'unlocking-words'
  | 'reading-words'
  | 'done';

/** May return a promise; the reader waits for it, so a page can repaint before slow steps. */
export type ProgressCallback = (step: ProgressStep) => void | Promise<void>;

export type UnsealedArchive = {
  header: BackupHeader;
  manifest: Manifest | null;
  entries: ZipEntries;
  integrity: IntegrityReport;
  /** The passphrase text that opened the archive (after the relaxed retry, if one was needed). */
  passphrase: string;
};

/** One zip, or its two files after something unzipped it. */
export function locateArchiveParts(files: ArchiveFile[]): {
  header: BackupHeader;
  sealed: Uint8Array;
} {
  let headerBytes: Uint8Array | null = null;
  let sealed: Uint8Array | null = null;

  for (const file of files) {
    if (isZip(file.bytes)) {
      const entries = readZip(file.bytes, 'not-a-backup');
      headerBytes ??= findBySuffix(entries, HEADER_SUFFIX)?.[1] ?? null;
      sealed ??= findBySuffix(entries, SEALED_SUFFIX)?.[1] ?? null;
    } else if (file.name.endsWith(HEADER_SUFFIX) || file.name.endsWith('.json')) {
      headerBytes ??= file.bytes;
    } else if (file.name.endsWith(SEALED_SUFFIX) || file.name.endsWith('.encrypted')) {
      sealed ??= file.bytes;
    }
  }

  if (!headerBytes || !sealed) throw new ReaderError('not-a-backup');
  return { header: parseHeader(headerBytes), sealed };
}

export function parseHeader(bytes: Uint8Array): BackupHeader {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ReaderError('not-a-backup', 'The header is not JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.salt !== 'string') {
    throw new ReaderError('not-a-backup', 'The header has no salt.');
  }
  const version = typeof parsed.backupFormatVersion === 'number' ? parsed.backupFormatVersion : 0;
  if (version !== BACKUP_FORMAT_VERSION) {
    throw new ReaderError('unsupported-version', `Backup format ${version}.`);
  }
  if (!isSupportedKdf(parsed.kdfParams)) {
    throw new ReaderError('unsupported-version', 'Unexpected key-stretching settings.');
  }
  return { salt: parsed.salt, backupFormatVersion: version, kdfParams: parsed.kdfParams };
}

function splitBlob(sealed: Uint8Array): PackedParts {
  const split = splitPacked(sealed);
  if (split.ok) return split.parts;
  switch (split.reason) {
    case 'too-short':
      throw new ReaderError('damaged', 'The encrypted data is too short.');
    case 'not-ours':
      throw new ReaderError('not-a-backup', 'The encrypted data is not a YearWeGo blob.');
    case 'newer':
      throw new ReaderError('unsupported-version', `Blob version ${sealed[4]}.`);
  }
}

export async function unsealArchive(
  files: ArchiveFile[],
  passphrase: string,
  onProgress: ProgressCallback = () => {},
): Promise<UnsealedArchive> {
  await ready();
  await onProgress('reading');
  const { header, sealed } = locateArchiveParts(files);
  const { nonce, ciphertext } = splitBlob(sealed);

  let salt: Uint8Array;
  try {
    salt = fromBase64UrlNoPadding(header.salt);
  } catch {
    throw new ReaderError('not-a-backup', 'The header salt is not readable.');
  }

  await onProgress('unlocking-backup');
  const usedPassphrase = normalizePassphrase(passphrase);
  let inner: Uint8Array | null = null;
  let key: Uint8Array | null = null;
  try {
    key = deriveKey(usedPassphrase, salt, header.kdfParams);
    inner = open(key, nonce, ciphertext, aad.archive(header.backupFormatVersion, header.salt));
  } catch (error) {
    if (isOutOfMemory(error)) throw new ReaderError('out-of-memory');
    throw error;
  } finally {
    wipe(key);
  }
  if (!inner) throw new ReaderError('wrong-passphrase');

  await onProgress('checking');
  const entries = readZip(inner, 'damaged');
  const { manifest, integrity } = verifyManifest(entries);
  return { header, manifest, entries, integrity, passphrase: usedPassphrase };
}
