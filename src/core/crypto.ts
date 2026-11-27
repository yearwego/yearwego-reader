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

const PACKED_MAGIC = [0x59, 0x57, 0x47, 0x31];
const PACKED_VERSION = 0x01;
const PACKED_HEADER_BYTES = 5;
const NONCE_BYTES = 24;
const TAG_BYTES = 16;

/** Opens one sealed column value (spec §10.6): `YWG1`, the version byte, the nonce, then the
 *  ciphertext and tag. Null when it isn't one or doesn't open. */
export function openPacked(key: Uint8Array, packed: Uint8Array, aadText: string): Uint8Array | null {
  if (packed.length < PACKED_HEADER_BYTES + NONCE_BYTES + TAG_BYTES) return null;
  if (PACKED_MAGIC.some((byte, index) => packed[index] !== byte)) return null;
  if (packed[PACKED_MAGIC.length] !== PACKED_VERSION) return null;
  const nonceEnd = PACKED_HEADER_BYTES + NONCE_BYTES;
  return open(key, packed.subarray(PACKED_HEADER_BYTES, nonceEnd), packed.subarray(nonceEnd), aadText);
}

/** Removes ISO/IEC 7816-4 padding (libsodium’s `sodium_pad`): trailing zeros, then one `0x80`. */
export function unpad(padded: Uint8Array, blockSize = 32): Uint8Array | null {
  if (padded.length === 0 || padded.length % blockSize !== 0) return null;
  for (let index = padded.length - 1; index >= padded.length - blockSize; index -= 1) {
    if (padded[index] === 0x80) return padded.slice(0, index);
    if (padded[index] !== 0) return null;
  }
  return null;
}

export const aad = {
  archive: (formatVersion: number, saltBase64: string) =>
    `v1|backup.archive|${formatVersion}|${saltBase64}`,
  keyBackup: (cryptoKeyId: string) => `v1|crypto_key_backup|${cryptoKeyId}`,
  dataKey: (cryptoKeyId: string) => `v1|crypto_key.data_encryption_key|${cryptoKeyId}`,
  transcript: (transcriptId: string) => `v1|transcript.text|${transcriptId}`,
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
  measureName: (measureId: string) => `v1|measure.name|${measureId}`,
  measureUnitLabel: (measureId: string) => `v1|measure.unit_label|${measureId}`,
  measureEntryValue: (measureEntryId: string) => `v1|measure_entry.value|${measureEntryId}`,
  milestoneMeasureTarget: (milestoneMeasureId: string) =>
    `v1|milestone_measure.target_total|${milestoneMeasureId}`,
  milestoneMeasureBaseline: (milestoneMeasureId: string) =>
    `v1|milestone_measure.baseline|${milestoneMeasureId}`,
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

