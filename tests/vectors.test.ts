import sodium from 'libsodium-wrappers-sumo';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseHeader } from '../src/core/archive';
import { decryptChunkedRecording } from '../src/core/audio';
import { aad, checksum, deriveKey, hash32, open, ready, sealedParts, splitPacked } from '../src/core/crypto';
import { vectors } from './helpers';

const v = vectors();
const hex = (bytes: Uint8Array) => sodium.to_hex(bytes);
const bytes = (text: string) => sodium.from_hex(text);

describe('known-answer vectors from the app (spec/vectors.json)', () => {
  beforeAll(async () => {
    await ready();
  });

  it('reads the header and derives the archive key', () => {
    const header = parseHeader(new TextEncoder().encode(v.archive.header_json));
    expect(header.salt).toBe(v.archive.salt_base64);
    expect(header.kdfParams).toEqual(v.archive.kdf_params);
    const key = deriveKey(v.passphrase, bytes(v.archive.salt_hex), header.kdfParams);
    expect(hex(key)).toBe(v.archive.key_hex);
  });

  it('opens the sealed inner zip', () => {
    const sealed = bytes(v.archive.sealed_hex);
    expect(aad.archive(1, v.archive.salt_base64)).toBe(v.archive.aad);
    const plaintext = open(
      bytes(v.archive.key_hex),
      sealed.subarray(5, 29),
      sealed.subarray(29),
      v.archive.aad,
    );
    expect(plaintext && hex(plaintext)).toBe(v.archive.plaintext_hex);
  });

  it('unwraps the root key from the key-backup row with the second key derivation', () => {
    const row = v.key_backup;
    const key = deriveKey(v.passphrase, bytes(row.kdf_salt_hex), JSON.parse(row.kdf_params_json));
    expect(hex(key)).toBe(row.key_hex);
    expect(aad.keyBackup(row.crypto_key_id)).toBe(row.aad);
    const rootKey = open(key, bytes(row.nonce_hex), bytes(row.encrypted_key_hex), row.aad);
    expect(rootKey && hex(rootKey)).toBe(row.root_key_hex);
    expect(checksum(rootKey!)).toBe(row.root_key_checksum_hex);
  });

  it('unwraps a data encryption key and checks it', () => {
    const row = v.data_encryption_key;
    expect(aad.dataKey(row.crypto_key_id)).toBe(row.aad);
    const dek = open(bytes(row.root_key_hex), bytes(row.nonce_hex), bytes(row.encrypted_key_hex), row.aad);
    expect(dek && hex(dek)).toBe(row.dek_hex);
    expect(checksum(dek!)).toBe(row.checksum_hex);
  });

  it('decrypts a transcript', () => {
    const row = v.transcript;
    expect(aad.transcript(row.transcript_id)).toBe(row.aad);
    const plaintext = open(bytes(row.dek_hex), bytes(row.text_nonce_hex), bytes(row.encrypted_text_hex), row.aad);
    expect(new TextDecoder().decode(plaintext!)).toBe(row.text);
  });

  it('opens each sealed column in the packed layout too', () => {
    const backupKey = bytes(v.key_backup.key_hex);
    const rootKey = sealedParts(bytes(v.key_backup.packed_hex), null)!;
    expect(hex(open(backupKey, rootKey.nonce, rootKey.ciphertext, v.key_backup.aad)!)).toBe(
      v.key_backup.root_key_hex,
    );

    const dataKey = sealedParts(bytes(v.data_encryption_key.packed_hex), null)!;
    expect(
      hex(open(bytes(v.data_encryption_key.root_key_hex), dataKey.nonce, dataKey.ciphertext, v.data_encryption_key.aad)!),
    ).toBe(v.data_encryption_key.dek_hex);

    const text = sealedParts(bytes(v.transcript.packed_hex), null)!;
    expect(
      new TextDecoder().decode(open(bytes(v.transcript.dek_hex), text.nonce, text.ciphertext, v.transcript.aad)!),
    ).toBe(v.transcript.text);
  });

  it('prefers a separate nonce column over splitting the value', () => {
    const row = v.transcript;
    const parts = sealedParts(bytes(row.encrypted_text_hex), bytes(row.text_nonce_hex))!;
    expect(hex(parts.nonce)).toBe(row.text_nonce_hex);
    expect(hex(parts.ciphertext)).toBe(row.encrypted_text_hex);
  });

  it('refuses a value that is not a packed blob, without throwing', () => {
    const packed = bytes(v.transcript.packed_hex);
    expect(splitPacked(packed.subarray(0, 40))).toEqual({ ok: false, reason: 'too-short' });
    expect(splitPacked(bytes(v.transcript.encrypted_text_hex))).toEqual({ ok: false, reason: 'not-ours' });
    const newer = packed.slice();
    newer[4] = 0x02;
    expect(splitPacked(newer)).toEqual({ ok: false, reason: 'newer' });
    expect(sealedParts(newer, null)).toBeNull();
  });

  it('builds every audio chunk AAD the same way', () => {
    for (const chunk of v.audio.chunks) {
      expect(
        aad.audioChunk({
          recordingId: v.audio.recording_id,
          cryptoKeyId: v.audio.crypto_key_id,
          fileNonceHex: v.audio.file_nonce_hex,
          sampleRate: v.audio.sample_rate,
          channels: v.audio.channels,
          chunkIndex: chunk.index,
          isFinal: chunk.final,
        }),
      ).toBe(chunk.aad);
    }
  });

  const openAudio = (file: Uint8Array) =>
    decryptChunkedRecording({
      bytes: file,
      key: bytes(v.audio.dek_hex),
      recordingId: v.audio.recording_id,
      cryptoKeyId: v.audio.crypto_key_id,
    });

  it('decrypts the three-chunk recording to its ADTS frames', () => {
    const result = openAudio(bytes(v.audio.file_hex));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(hex(result.audio.bytes)).toBe(v.audio.audio_hex);
    expect(result.audio.complete).toBe(true);
    expect(result.audio.mimeType).toBe('audio/aac');
  });

  it('keeps the audio of a recording with no FINAL chunk, and says it was cut short', () => {
    const withoutFinal = bytes(v.audio.header_hex + v.audio.chunks[0].framed_hex + v.audio.chunks[1].framed_hex);
    const result = openAudio(withoutFinal);
    expect(result.ok && hex(result.audio.bytes)).toBe(v.audio.audio_hex);
    expect(result.ok && result.audio.complete).toBe(false);
  });

  it('keeps the chunks before a partial last chunk', () => {
    const second = v.audio.chunks[1].framed_hex as string;
    const truncated = bytes(v.audio.header_hex + v.audio.chunks[0].framed_hex + second.slice(0, second.length - 20));
    const result = openAudio(truncated);
    expect(result.ok && hex(result.audio.bytes)).toBe(v.audio.chunks[0].frames_hex);
    expect(result.ok && result.audio.complete).toBe(false);
  });

  it('refuses a recording whose first chunk was altered', () => {
    const file = bytes(v.audio.file_hex);
    file[35] = file[35]! ^ 0x01;
    expect(openAudio(file)).toEqual({ ok: false, reason: 'damaged' });
  });

  it('matches the entry checksum and manifest hash', () => {
    expect(checksum(bytes(v.checksums.entry_checksum.input_hex))).toBe(
      v.checksums.entry_checksum.blake2b_8_hex,
    );
    expect(hash32(new TextEncoder().encode(v.checksums.manifest_hash.manifest_without_hash_json))).toBe(
      v.checksums.manifest_hash.blake2b_32_hex,
    );
  });
});
