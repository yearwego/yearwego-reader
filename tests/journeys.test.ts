import { zipSync, unzipSync } from 'fflate';
import sodium from 'libsodium-wrappers-sumo';
import { beforeAll, describe, expect, it } from 'vitest';
import { openBackup, unsealArchive, type ArchiveFile, type UnsealedArchive } from '../src/core';
import { aad, deriveKey, fromBase64UrlNoPadding, ready } from '../src/core/crypto';
import { fixture, GOLDEN, loadSql } from './helpers';

const PASSPHRASE = 'test';

/** The golden backup with its database changed, sealed the way the app seals it. */
async function withDatabase(archive: UnsealedArchive, change: (run: (sql: string) => void) => void) {
  const SQL = await loadSql();
  const inner: Record<string, Uint8Array> = Object.fromEntries(archive.entries);
  const dbPath = Object.keys(inner).find((path) => path.endsWith('.yearwego.backup.db'))!;
  const db = new SQL.Database(inner[dbPath]);
  change((sql) => db.run(sql));
  inner[dbPath] = db.export();
  db.close();

  const key = deriveKey(PASSPHRASE, fromBase64UrlNoPadding(archive.header.salt), archive.header.kdfParams);
  const nonce = sodium.randombytes_buf(24);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    zipSync(inner),
    aad.archive(1, archive.header.salt),
    null,
    nonce,
    key,
  );
  const sealed = new Uint8Array(5 + 24 + ciphertext.length);
  sealed.set([0x59, 0x57, 0x47, 0x31, 0x01]);
  sealed.set(nonce, 5);
  sealed.set(ciphertext, 29);
  const original = fixture(GOLDEN);
  const outer = unzipSync(original.bytes);
  const sealedName = Object.keys(outer).find((name) => name.endsWith('.yearwego.data.encrypted'))!;
  outer[sealedName] = sealed;
  return { name: original.name, bytes: zipSync(outer) } satisfies ArchiveFile;
}

// The tables and columns the app’s 2026-11-20 journeys migration adds.
const JOURNEYS_SCHEMA = [
  'ALTER TABLE milestones ADD COLUMN focused_at integer',
  'ALTER TABLE milestones ADD COLUMN target_date integer',
  `CREATE TABLE journeys (id text PRIMARY KEY, created_at integer, updated_at integer, name text NOT NULL,
     why_recording_id text, cover_scene text, set_aside_at integer, set_aside_recording_id text)`,
  `CREATE TABLE journey_milestones (journey_id text NOT NULL, milestone_id text NOT NULL,
     created_at integer)`,
];

describe('a backup from the journeys build', () => {
  let archive: UnsealedArchive;

  beforeAll(async () => {
    await ready();
    archive = await unsealArchive([fixture(GOLDEN)], PASSPHRASE);
  });

  /** Both golden milestones open, each in its own journey, the older one focused last. */
  const twoJourneys = (run: (sql: string) => void) => {
    for (const statement of JOURNEYS_SCHEMA) run(statement);
    run('UPDATE milestones SET reached_at = NULL, closed_at = NULL');
    run(`INSERT INTO journeys (id, name) VALUES ('j-health', 'Health'), ('j-run', 'Running')`);
    run(`INSERT INTO journey_milestones (journey_id, milestone_id)
         SELECT 'j-health', id FROM milestones ORDER BY created_at DESC LIMIT 1`);
    run(`INSERT INTO journey_milestones (journey_id, milestone_id)
         SELECT 'j-run', id FROM milestones ORDER BY created_at ASC LIMIT 1`);
    run(`UPDATE milestones SET focused_at = (SELECT MAX(created_at) FROM milestones) + 1000
         WHERE id = (SELECT id FROM milestones ORDER BY created_at ASC LIMIT 1)`);
  };

  it('names each milestone’s journey, and puts the focused milestone first', async () => {
    const opened = await openBackup([await withDatabase(archive, twoJourneys)], PASSPHRASE, {
      loadSql,
    });
    expect(opened.aims.map((aim) => [aim.journeyName, aim.entry.text])).toEqual([
      ['Running', 'I want to run a 5K without stopping.'],
      ['Health', 'I want to run a half marathon this spring and cross the finish line.'],
    ]);
    opened.close();
  });

  it('skips a focused milestone whose journey is set aside', async () => {
    const file = await withDatabase(archive, (run) => {
      twoJourneys(run);
      run(`UPDATE journeys SET set_aside_at = 1 WHERE id = 'j-run'`);
    });
    const opened = await openBackup([file], PASSPHRASE, { loadSql });
    expect(opened.aims[0]!.journeyName).toBe('Health');
    opened.close();
  });

  it('leaves a backup from before journeys as it was', async () => {
    const opened = await openBackup([fixture(GOLDEN)], PASSPHRASE, { loadSql });
    expect(opened.aims.map((aim) => aim.journeyName)).toEqual([null, null]);
    expect(opened.aims[0]!.entry.text).toBe(
      'I want to run a half marathon this spring and cross the finish line.',
    );
    opened.close();
  });
});
