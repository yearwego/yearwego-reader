import sodium from 'libsodium-wrappers-sumo';

export type KdfParams = {
  keyLength: number;
  opsLimit: number;
  memLimit: number;
  algorithm: number;
};

export const KDF_V1: KdfParams = {
  keyLength: 32,
  opsLimit: 3,
  memLimit: 268_435_456,
  algorithm: 2,
};

const MAX_MEM_LIMIT = 1_073_741_824;
const MAX_OPS_LIMIT = 10;

export async function ready(): Promise<typeof sodium> {
  await sodium.ready;
  return sodium;
}

export function isSupportedKdf(params: unknown): params is KdfParams {
  if (!params || typeof params !== 'object') return false;
  const value = params as Record<string, unknown>;
  return (
    value.keyLength === 32 &&
    value.algorithm === 2 &&
    Number.isInteger(value.opsLimit) &&
    Number.isInteger(value.memLimit) &&
    (value.opsLimit as number) >= 1 &&
    (value.opsLimit as number) <= MAX_OPS_LIMIT &&
    (value.memLimit as number) >= 8192 &&
    (value.memLimit as number) <= MAX_MEM_LIMIT
  );
}

export function deriveKey(passphrase: string, salt: Uint8Array, params: KdfParams): Uint8Array {
  return sodium.crypto_pwhash(
    params.keyLength,
    passphrase,
    salt,
    params.opsLimit,
    params.memLimit,
    params.algorithm,
  );
}

const PACKED_MAGIC = [0x59, 0x57, 0x47, 0x31];
const PACKED_VERSION = 0x01;
export const PACKED_HEADER_BYTES = 5;
export const NONCE_BYTES = 24;
export const TAG_BYTES = 16;

export type PackedParts = { nonce: Uint8Array; ciphertext: Uint8Array };

/** Splits a `YWG1` blob (spec §5.2): the 5-byte header, the 24-byte nonce, then ciphertext ‖ tag.
 *  The sealed inner zip and, since 2026-11-27, every sealed column use it. */
export function splitPacked(
  blob: Uint8Array,
): { ok: true; parts: PackedParts } | { ok: false; reason: 'too-short' | 'not-ours' | 'newer' } {
  if (blob.length < PACKED_HEADER_BYTES + NONCE_BYTES + TAG_BYTES) return { ok: false, reason: 'too-short' };
  if (PACKED_MAGIC.some((byte, index) => blob[index] !== byte)) return { ok: false, reason: 'not-ours' };
  if (blob[4] !== PACKED_VERSION) return { ok: false, reason: 'newer' };
  return {
    ok: true,
    parts: {
      nonce: blob.subarray(PACKED_HEADER_BYTES, PACKED_HEADER_BYTES + NONCE_BYTES),
      ciphertext: blob.subarray(PACKED_HEADER_BYTES + NONCE_BYTES),
    },
  };
}

/** A sealed column's nonce and ciphertext, in either layout (spec §10.5): backups up to the app's
 *  1.0.0 (13) keep the nonce in a column of its own, later ones pack it into the value. Null when
 *  the value can't be split. */
export function sealedParts(value: Uint8Array | null, separateNonce: Uint8Array | null): PackedParts | null {
  if (!value) return null;
  if (separateNonce) return { nonce: separateNonce, ciphertext: value };
  const split = splitPacked(value);
  return split.ok ? split.parts : null;
}

export const PADDING_BLOCK_BYTES = 32;

/** The text of a padded value (spec §8.2): libsodium's `sodium_pad` format, to 32-byte blocks.
 *  Null when the padding is malformed. */
export function unpadText(padded: Uint8Array): string | null {
  try {
    return new TextDecoder().decode(sodium.unpad(padded, PADDING_BLOCK_BYTES));
  } catch {
    return null;
  }
}

/** Null when the tag does not verify: wrong key, wrong place, or damaged bytes. */
export function open(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: string,
): Uint8Array | null {
  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, aad, nonce, key);
  } catch {
    return null;
  }
}

export function checksum(bytes: Uint8Array): string {
  return sodium.to_hex(sodium.crypto_generichash(8, bytes, null));
}

export function hash32(bytes: Uint8Array): string {
  return sodium.to_hex(sodium.crypto_generichash(32, bytes, null));
}

export function toHex(bytes: Uint8Array): string {
  return sodium.to_hex(bytes);
}

export function fromBase64UrlNoPadding(text: string): Uint8Array {
  return sodium.from_base64(text, sodium.base64_variants.URLSAFE_NO_PADDING);
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index]! ^ b[index]!;
  return diff === 0;
}

export function wipe(bytes: Uint8Array | null | undefined): void {
  bytes?.fill(0);
}

export const aad = {
  archive: (formatVersion: number, saltBase64: string) =>
    `v1|backup.archive|${formatVersion}|${saltBase64}`,
  keyBackup: (cryptoKeyId: string) => `v1|crypto_key_backup|${cryptoKeyId}`,
  dataKey: (cryptoKeyId: string) => `v1|crypto_key.data_encryption_key|${cryptoKeyId}`,
  transcript: (transcriptId: string) => `v1|transcript.text|${transcriptId}`,
  journeyName: (journeyId: string) => `v1|journey.name|${journeyId}`,
  audioChunk: (parts: {
    recordingId: string;
    cryptoKeyId: string;
    fileNonceHex: string;
    sampleRate: number;
    channels: number;
    chunkIndex: number;
    isFinal: boolean;
  }) =>
    [
      'v1',
      'recording.audio.chunk',
      parts.recordingId,
      parts.cryptoKeyId,
      parts.fileNonceHex,
      String(parts.sampleRate),
      String(parts.channels),
      String(parts.chunkIndex),
      parts.isFinal ? 'final' : 'more',
    ].join('|'),
  legacyAudio: (recordingId: string, cryptoKeyId: string) =>
    `v1|recording.audio|${recordingId}|${cryptoKeyId}`,
};

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
const NOT_A_LETTER = /[^a-z]+/g;

/** The app's normalised form (spec §4): words of a–z joined by single dashes. */
export function normalizePassphrase(typed: string): string {
  return typed
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .toLowerCase()
    .replace(NOT_A_LETTER, '-')
    .replace(/^-+|-+$/g, '');
}

