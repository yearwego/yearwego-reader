import { unzipSync, zipSync } from 'fflate';
import sodium from 'libsodium-wrappers-sumo';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  openBackup,
  ReaderError,
  unlockBackup,
  unsealArchive,
  type ArchiveFile,
  type OpenedBackup,
  type UnsealedArchive,
} from '../src/core';
import { aad, deriveKey, fromBase64UrlNoPadding, ready } from '../src/core/crypto';
import { localDate } from '../src/core/export';
import { fixture, GOLDEN, GOLDEN_NO_MILESTONES, GOLDEN_SECOND_PASSPHRASE, loadSql } from './helpers';

const PASSPHRASE = 'TEST';

async function expectReaderError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(ReaderError);
  await expect(promise).rejects.toMatchObject({ code });
}

/** Rebuilds an archive with changed inner files, sealed the way the app seals it. */
function resealWith(
  original: ArchiveFile,
  archive: UnsealedArchive,
  change: (inner: Record<string, Uint8Array>) => void,
): ArchiveFile {
  const inner: Record<string, Uint8Array> = Object.fromEntries(archive.entries);
  change(inner);
  const innerZip = zipSync(inner);
  const key = deriveKey(PASSPHRASE, fromBase64UrlNoPadding(archive.header.salt), archive.header.kdfParams);
  const nonce = sodium.randombytes_buf(24);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    innerZip,
    aad.archive(1, archive.header.salt),
    null,
    nonce,
    key,
  );
  const sealed = new Uint8Array(5 + 24 + ciphertext.length);
  sealed.set([0x59, 0x57, 0x47, 0x31, 0x01]);
  sealed.set(nonce, 5);
  sealed.set(ciphertext, 29);
  const outer = unzipSync(original.bytes);
  const sealedName = Object.keys(outer).find((name) => name.endsWith('.yearwego.data.encrypted'))!;
  outer[sealedName] = sealed;
  return { name: original.name, bytes: zipSync(outer) };
}

describe('the golden archive made by the app’s backup code', () => {
  let archive: UnsealedArchive;
  let backup: OpenedBackup;

  beforeAll(async () => {
    await ready();
    archive = await unsealArchive([fixture(GOLDEN)], PASSPHRASE);
    backup = await unlockBackup(archive, { loadSql });
  });

  it('passes every integrity check', () => {
    expect(backup.integrity.problems).toEqual([]);
    expect(backup.integrity.ok).toBe(true);
    expect(backup.info.appVersion).toBe('1.0.0');
  });

  it('lists where you’re headed, newest first, with reached and replaced', () => {
    expect(backup.aims).toHaveLength(2);
    const [current, earlier] = backup.aims;
    expect(current!.closedAt).toBeNull();
    expect(current!.entry.typed).toBe(false);
    expect(current!.entry.question).toBe('I want…');
    expect(current!.entry.text).toBe('I want to run a half marathon this spring and cross the finish line.');
    expect(earlier!.entry.text).toBe('I want to run a 5K without stopping.');
    expect(earlier!.reachedAt).not.toBeNull();
    expect(earlier!.closedAt).toBe(current!.createdAt);
  });

  it('rebuilds each day: intention, did you do it, and the answer', () => {
    expect(backup.days.map((day) => day.outcome)).toEqual(['waiting', 'no-answer', 'didnt', 'did-it']);
    const [today, unanswered, missed, done] = backup.days;

    expect(today!.intention!.text).toBe('Today, I’ll run four easy miles and stretch after.');
    expect(today!.intention!.typed).toBe(true);
    expect(today!.answer).toBeNull();

    expect(unanswered!.intention!.typed).toBe(false);
    expect(unanswered!.intention!.text).toBeNull();
    expect(unanswered!.intention!.textProblem).toBe('not-transcribed');
    expect(unanswered!.intention!.audioInBackup).toBe(true);

    expect(missed!.checkInQuestion).toBe('Did you do it?');
    expect(missed!.answer!.question).toBe('What got in the way?');
    expect(missed!.answer!.text).toContain('Work ran late');

    expect(done!.intention!.question).toBe('Today, I’ll…');
    expect(done!.intention!.text).toBe('Today, I’ll run three miles before work.');
    expect(done!.answer!.question).toBe('What are you proud of?');
    expect(done!.answer!.text).toBe('Ran the whole thing without stopping.');
  });

  it('decrypts a recording to playable ADTS audio', () => {
    const entry = backup.days[3]!.intention!;
    const result = backup.decryptAudio(entry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.audio.complete).toBe(true);
    expect(result.audio.bytes[0]).toBe(0xff);
    expect(result.audio.bytes[1]! & 0xf0).toBe(0xf0);
    expect(result.audio.durationMs).toBeGreaterThan(4000);
  });

  it('exports everything as one zip of audio, Markdown, and JSON', () => {
    const files = unzipSync(backup.exportAll());
    const names = Object.keys(files).sort();
    const done = backup.days[3]!;
    expect(names).toContain('logbook.md');
    expect(names).toContain('logbook.json');
    expect(names).toContain(`recordings/${localDate(done.createdAt)}-intention.aac`);
    expect(names).toContain(`recordings/${localDate(done.createdAt)}-proud.aac`);
    expect(names).toContain(`recordings/${localDate(backup.aims[0]!.createdAt)}-headed.aac`);
    expect(names.filter((name) => name.startsWith('recordings/'))).toHaveLength(4);

    const markdown = new TextDecoder().decode(files['logbook.md']);
    expect(markdown).toContain('## Where you’re headed');
    expect(markdown).toContain('> Ran the whole thing without stopping.');
    expect(markdown).toContain('**Did you do it?** Didn’t');

    const json = JSON.parse(new TextDecoder().decode(files['logbook.json']));
    expect(json.format).toBe('yearwego-logbook');
    expect(json.days).toHaveLength(4);
    expect(json.days[3].outcome).toBe('did-it');
    expect(json.days[3].intention.recording).toBe(`recordings/${localDate(done.createdAt)}-intention.aac`);
    expect(json.whereYoureHeaded[0].current).toBe(true);
  });

  it('accepts the two files of an archive something already unzipped', async () => {
    const outer = unzipSync(fixture(GOLDEN).bytes);
    const loose = Object.entries(outer).map(([name, bytes]) => ({ name, bytes }));
    const opened = await openBackup(loose, PASSPHRASE, { loadSql });
    expect(opened.days).toHaveLength(4);
    opened.close();
  });

  it('says plainly when the passphrase is wrong', async () => {
    await expectReaderError(unsealArchive([fixture(GOLDEN)], 'not-the-passphrase'), 'wrong-passphrase');
  });

  it('cannot tell a damaged sealed blob from a wrong passphrase, and says both', async () => {
    const outer = unzipSync(fixture(GOLDEN).bytes);
    const sealedName = Object.keys(outer).find((name) => name.endsWith('.encrypted'))!;
    outer[sealedName]![100] = outer[sealedName]![100]! ^ 0xff;
    await expectReaderError(
      unsealArchive([{ name: GOLDEN, bytes: zipSync(outer) }], PASSPHRASE),
      'wrong-passphrase',
    );
  });

  it('reports a tampered recording and refuses its audio, but still shows everything else', async () => {
    const target = backup.days[3]!.intention!.audioPath!;
    const tampered = resealWith(fixture(GOLDEN), archive, (inner) => {
      const bytes = inner[target]!.slice();
      bytes[40] = bytes[40]! ^ 0x01;
      inner[target] = bytes;
    });
    const opened = await openBackup([tampered], PASSPHRASE, { loadSql });
    expect(opened.integrity.ok).toBe(false);
    expect(opened.integrity.problems).toContainEqual({ kind: 'entry-checksum', path: target });
    expect(opened.days).toHaveLength(4);
    expect(opened.days[3]!.intention!.text).toBe('Today, I’ll run three miles before work.');
    expect(opened.decryptAudio(opened.days[3]!.intention!)).toEqual({ ok: false, reason: 'damaged' });
    expect(opened.decryptAudio(opened.days[3]!.answer!).ok).toBe(true);
    opened.close();
  });

  it('plays a truncated recording as far as it goes', async () => {
    const target = backup.days[3]!.answer!.audioPath!;
    const truncated = resealWith(fixture(GOLDEN), archive, (inner) => {
      inner[target] = inner[target]!.slice(0, inner[target]!.length - 30);
    });
    const opened = await openBackup([truncated], PASSPHRASE, { loadSql });
    expect(opened.integrity.problems).toContainEqual({ kind: 'entry-size', path: target });
    const result = opened.decryptAudio(opened.days[3]!.answer!);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.audio.complete).toBe(false);
      expect(result.audio.bytes.length).toBeGreaterThan(0);
    }
    opened.close();
  });

  it('refuses a file that is not a backup', async () => {
    const notBackup = { name: 'photos.zip', bytes: zipSync({ 'a.txt': new TextEncoder().encode('hi') }) };
    await expectReaderError(unsealArchive([notBackup], PASSPHRASE), 'not-a-backup');
    await expectReaderError(
      unsealArchive([{ name: 'x.zip', bytes: new Uint8Array([1, 2, 3]) }], PASSPHRASE),
      'not-a-backup',
    );
  });

  it('refuses a newer format without trying the passphrase', async () => {
    const outer = unzipSync(fixture(GOLDEN).bytes);
    const headerName = Object.keys(outer).find((name) => name.endsWith('.header.json'))!;
    const header = JSON.parse(new TextDecoder().decode(outer[headerName]));
    outer[headerName] = new TextEncoder().encode(JSON.stringify({ ...header, backupFormatVersion: 2 }));
    await expectReaderError(
      unsealArchive([{ name: GOLDEN, bytes: zipSync(outer) }], PASSPHRASE),
      'unsupported-version',
    );
  });
});

describe('an archive from before the milestones table', () => {
  let backup: OpenedBackup;

  beforeAll(async () => {
    backup = await openBackup([fixture(GOLDEN_NO_MILESTONES)], PASSPHRASE, { loadSql });
  });

  it('rebuilds where you’re headed from the aim sessions', () => {
    expect(backup.aims).toHaveLength(2);
    expect(backup.aims[0]!.closedAt).toBeNull();
    expect(backup.aims[1]!.reachedAt).not.toBeNull();
    expect(backup.aims[1]!.closedAt).toBe(backup.aims[0]!.createdAt);
    expect(backup.aims[1]!.entry.text).toBe('I want to run a 5K without stopping.');
  });

  it('reads an older monthly session as a plain entry with its question', () => {
    const monthly = backup.days.find((day) => day.flow === 'compass')!;
    expect(monthly.checkInQuestion).toBe('Are you closer to what matters to you?');
    expect(monthly.outcome).toBe('did-it');
    expect(monthly.intention!.question).toBe('What matters to you in the next 30 days?');
    expect(monthly.answer!.question).toBe('What moved you closer? Call out your wins.');
    expect(backup.days).toHaveLength(5);
  });
});

describe('an archive whose words are locked with an earlier passphrase', () => {
  it('opens the archive, then asks for the earlier passphrase', async () => {
    const archive = await unsealArchive([fixture(GOLDEN_SECOND_PASSPHRASE)], PASSPHRASE);
    await expectReaderError(unlockBackup(archive, { loadSql }), 'earlier-passphrase-needed');
    await expectReaderError(
      unlockBackup(archive, { loadSql, passphrase: 'WRONG' }),
      'earlier-passphrase-needed',
    );
    const backup = await unlockBackup(archive, { loadSql, passphrase: 'OLD-TEST' });
    expect(backup.days).toHaveLength(4);
    expect(backup.days[3]!.answer!.text).toBe('Ran the whole thing without stopping.');
    backup.close();
  });
});
