import { aad, open, toHex } from './crypto';

const YWGA_MAGIC = [0x59, 0x57, 0x47, 0x41];
const YWG1_MAGIC = [0x59, 0x57, 0x47, 0x31];
const YWGA_VERSION = 0x01;
const HEADER_BYTES = 27;
const FRAMING_BYTES = 5;
const FLAG_FINAL = 0x01;
const TAG_BYTES = 16;
const FILE_NONCE_BYTES = 16;
const SAMPLES_PER_AAC_FRAME = 1024;

export type DecryptedAudio = {
  bytes: Uint8Array;
  mimeType: 'audio/aac' | 'audio/mp4';
  extension: 'aac' | 'm4a';
  /** False when the take was cut short (no FINAL marker) or a later chunk was damaged. */
  complete: boolean;
  durationMs: number | null;
};

export type AudioFailure = 'not-ours' | 'unsupported' | 'damaged';

export type AudioResult = { ok: true; audio: DecryptedAudio } | { ok: false; reason: AudioFailure };

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, index) => bytes[index] === byte);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function chunkNonce(fileNonce: Uint8Array, index: number): Uint8Array {
  const nonce = new Uint8Array(24);
  nonce.set(fileNonce, 0);
  new DataView(nonce.buffer).setBigUint64(FILE_NONCE_BYTES, BigInt(index), true);
  return nonce;
}

function countAdtsFrames(audio: Uint8Array): number | null {
  let count = 0;
  let offset = 0;
  while (offset + 7 <= audio.length) {
    if (audio[offset] !== 0xff || (audio[offset + 1]! & 0xf0) !== 0xf0) return null;
    const length =
      ((audio[offset + 3]! & 0x03) << 11) | (audio[offset + 4]! << 3) | (audio[offset + 5]! >> 5);
    if (length < 7) return null;
    offset += length;
    count += 1;
  }
  return offset === audio.length ? count : null;
}

/** Opens a YWGA file. Keeps every chunk that authenticates up to the first that is missing or
 *  damaged, so a take cut short still plays as far as it got. */
export function decryptChunkedRecording({
  bytes,
  key,
  recordingId,
  cryptoKeyId,
}: {
  bytes: Uint8Array;
  key: Uint8Array;
  recordingId: string;
  cryptoKeyId: string;
}): AudioResult {
  if (bytes.length < HEADER_BYTES || !startsWith(bytes, YWGA_MAGIC)) {
    return { ok: false, reason: 'not-ours' };
  }
  if (bytes[4] !== YWGA_VERSION || bytes[26] !== 0x01) return { ok: false, reason: 'unsupported' };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fileNonce = bytes.slice(5, 5 + FILE_NONCE_BYTES);
  const fileNonceHex = toHex(fileNonce);
  const sampleRate = view.getUint32(21, true);
  const channels = bytes[25]!;

  const frames: Uint8Array[] = [];
  let offset = HEADER_BYTES;
  let index = 0;
  let complete = false;
  let firstChunkFailed = false;

  while (offset + FRAMING_BYTES <= bytes.length && !complete) {
    const length = view.getUint32(offset, true);
    const isFinal = (bytes[offset + 4]! & FLAG_FINAL) !== 0;
    const end = offset + FRAMING_BYTES + length;
    if (length < TAG_BYTES || end > bytes.length) break;

    const plaintext = open(
      key,
      chunkNonce(fileNonce, index),
      bytes.subarray(offset + FRAMING_BYTES, end),
      aad.audioChunk({ recordingId, cryptoKeyId, fileNonceHex, sampleRate, channels, chunkIndex: index, isFinal }),
    );
    if (!plaintext) {
      firstChunkFailed = index === 0;
      break;
    }
    const levelCount = plaintext[0] ?? 0;
    if (1 + levelCount > plaintext.length) break;
    if (isFinal) {
      complete = true;
    } else {
      frames.push(plaintext.subarray(1 + levelCount));
    }
    offset = end;
    index += 1;
  }

  if (firstChunkFailed) return { ok: false, reason: 'damaged' };
  const audio = concat(frames);
  const frameCount = countAdtsFrames(audio);
  return {
    ok: true,
    audio: {
      bytes: audio,
      mimeType: 'audio/aac',
      extension: 'aac',
      complete: complete && offset === bytes.length,
      durationMs:
        frameCount === null || sampleRate === 0
          ? null
          : Math.round((frameCount * SAMPLES_PER_AAC_FRAME * 1000) / sampleRate),
    },
  };
}

/** A whole-file seal from before chunked recording. No shipped build wrote these. */
export function decryptLegacyRecording({
  bytes,
  key,
  recordingId,
  cryptoKeyId,
}: {
  bytes: Uint8Array;
  key: Uint8Array;
  recordingId: string;
  cryptoKeyId: string;
}): AudioResult {
  if (bytes.length < 5 + 24 + TAG_BYTES || !startsWith(bytes, YWG1_MAGIC) || bytes[4] !== 0x01) {
    return { ok: false, reason: 'not-ours' };
  }
  const plaintext = open(
    key,
    bytes.subarray(5, 29),
    bytes.subarray(29),
    aad.legacyAudio(recordingId, cryptoKeyId),
  );
  if (!plaintext) return { ok: false, reason: 'damaged' };
  return {
    ok: true,
    audio: { bytes: plaintext, mimeType: 'audio/mp4', extension: 'm4a', complete: true, durationMs: null },
  };
}

export function decryptRecordingFile(args: {
  bytes: Uint8Array;
  key: Uint8Array;
  recordingId: string;
  cryptoKeyId: string;
}): AudioResult {
  if (startsWith(args.bytes, YWG1_MAGIC)) return decryptLegacyRecording(args);
  return decryptChunkedRecording(args);
}
