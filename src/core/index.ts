import { unsealArchive, type ArchiveFile, type ProgressCallback, type UnsealedArchive } from './archive';
import { decryptRecordingFile, type AudioResult, type DecryptedAudio } from './audio';
import { BackupDatabase, type SqlLoader } from './database';
import { ReaderError } from './errors';
import { buildExport } from './export';
import { KeyRing, unlockRootKey } from './keys';
import { LogbookBuilder, type Aim, type Day, type Entry } from './logbook';
import type { IntegrityReport } from './manifest';

export { decryptChunkedRecording, decryptRecordingFile } from './audio';
export type { AudioResult, DecryptedAudio } from './audio';
export { unsealArchive } from './archive';
export type { ArchiveFile, ProgressCallback, ProgressStep, UnsealedArchive } from './archive';
export type { SqlLoader } from './database';
export { ReaderError } from './errors';
export type { ReaderErrorCode } from './errors';
export { localDate, longDate, outcomeWords, timeOfDay } from './export';
export type { Aim, Day, Entry, Outcome } from './logbook';
export type { IntegrityProblem, IntegrityReport } from './manifest';

export type BackupInfo = {
  createdAt: string | null;
  appVersion: string | null;
  device: string | null;
};

export type OpenedBackup = {
  info: BackupInfo;
  integrity: IntegrityReport;
  aims: Aim[];
  days: Day[];
  decryptAudio: (entry: Entry) => AudioResult;
  exportAll: () => Uint8Array;
  close: () => void;
};

/** Second step: open the database and unlock the words. `passphrase` defaults to the one that
 *  opened the archive; pass an earlier one when this throws `earlier-passphrase-needed`. */
export async function unlockBackup(
  archive: UnsealedArchive,
  {
    loadSql,
    passphrase = archive.passphrase,
    onProgress = () => {},
  }: { loadSql: SqlLoader; passphrase?: string; onProgress?: ProgressCallback },
): Promise<OpenedBackup> {
  await onProgress('opening-database');
  const databasePath =
    archive.manifest?.database?.filename ??
    [...archive.entries.keys()].find((path) => path.endsWith('.yearwego.backup.db')) ??
    null;
  const databaseBytes = databasePath ? archive.entries.get(databasePath) : undefined;
  if (!databaseBytes) throw new ReaderError('damaged', 'The backup has no database.');
  const db = await BackupDatabase.open(loadSql, databaseBytes);

  await onProgress('unlocking-words');
  let rootKey: Uint8Array;
  try {
    rootKey = unlockRootKey(db, passphrase, archive.manifest?.encryption?.crypto_key_backup_id ?? null);
  } catch (error) {
    db.close();
    throw error;
  }

  await onProgress('reading-words');
  const keys = new KeyRing(db, rootKey);
  const builder = new LogbookBuilder(db, keys, archive.entries);
  const aims = builder.aims();
  const days = builder.days();

  const decryptAudio = (entry: Entry): AudioResult => {
    if (!entry.audioPath) return { ok: false, reason: 'not-ours' };
    const bytes = archive.entries.get(entry.audioPath);
    const key = keys.dataKey(entry.cryptoKeyId);
    if (!bytes || !key) return { ok: false, reason: 'damaged' };
    return decryptRecordingFile({
      bytes,
      key,
      recordingId: entry.recordingId,
      cryptoKeyId: entry.cryptoKeyId,
    });
  };

  const info: BackupInfo = {
    createdAt: archive.manifest?.created_at ?? null,
    appVersion: archive.manifest?.app?.version ?? null,
    device: archive.manifest?.device?.model ?? null,
  };

  await onProgress('done');
  return {
    info,
    integrity: archive.integrity,
    aims,
    days,
    decryptAudio,
    exportAll: () =>
      buildExport({
        backupCreatedAt: info.createdAt,
        appVersion: info.appVersion,
        aims,
        days,
        problems: archive.integrity.problems,
        decryptAudio: (entry): DecryptedAudio | null => {
          const result = decryptAudio(entry);
          return result.ok ? result.audio : null;
        },
      }),
    close: () => {
      keys.wipe();
      db.close();
    },
  };
}

/** Both steps with one passphrase. */
export async function openBackup(
  files: ArchiveFile[],
  passphrase: string,
  options: { loadSql: SqlLoader; onProgress?: ProgressCallback },
): Promise<OpenedBackup> {
  const archive = await unsealArchive(files, passphrase, options.onProgress);
  return unlockBackup(archive, options);
}
