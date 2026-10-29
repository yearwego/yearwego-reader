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
};

/** Exact text first; then trimmed and lowercased, which is how generated passphrases are written. */
export function passphraseCandidates(passphrase: string): string[] {
  const relaxed = passphrase.trim().toLowerCase();
  return relaxed && relaxed !== passphrase ? [passphrase, relaxed] : [passphrase];
}
