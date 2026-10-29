import { aad, checksum, deriveKey, isSupportedKdf, open, passphraseCandidates, toHex, wipe } from './crypto';
import { asBytes, asString, type BackupDatabase } from './database';
import { isOutOfMemory, ReaderError } from './errors';

type KeyBackupRow = {
  id: string;
  cryptoKeyId: string;
  encryptedKey: Uint8Array;
  nonce: Uint8Array;
  kdfSalt: Uint8Array;
  kdfParamsJson: string;
};

function activeRootKeyId(db: BackupDatabase): string | null {
  if (!db.hasTable('crypto_keys')) return null;
  const hasVersion = db.columns('crypto_keys').has('version');
  const [row] = db.all(
    `SELECT id FROM crypto_keys WHERE type = 'key_encryption_key'
     ORDER BY ${hasVersion ? 'version DESC,' : ''} created_at DESC LIMIT 1`,
  );
  return asString(row?.id);
}

/** The manifest’s row first, then the active root key’s, then any other. */
function keyBackupRows(db: BackupDatabase, manifestRowId: string | null): KeyBackupRow[] {
  if (!db.hasTable('crypto_key_backups')) return [];
  const rows = db
    .all(
      'SELECT id, crypto_key_id, encrypted_key, nonce, kdf_salt, kdf_params_json FROM crypto_key_backups',
    )
    .flatMap((row): KeyBackupRow[] => {
      const id = asString(row.id);
      const cryptoKeyId = asString(row.crypto_key_id);
      const encryptedKey = asBytes(row.encrypted_key);
      const nonce = asBytes(row.nonce);
      const kdfSalt = asBytes(row.kdf_salt);
      const kdfParamsJson = asString(row.kdf_params_json);
      if (!id || !cryptoKeyId || !encryptedKey || !nonce || !kdfSalt || !kdfParamsJson) return [];
      return [{ id, cryptoKeyId, encryptedKey, nonce, kdfSalt, kdfParamsJson }];
    });
  const activeId = activeRootKeyId(db);
  const rank = (row: KeyBackupRow) => {
    if (row.id === manifestRowId) return 0;
    if (row.cryptoKeyId === activeId) return 1;
    return 2;
  };
  return rows.sort((a, b) => rank(a) - rank(b));
}

export function hasKeyBackup(db: BackupDatabase): boolean {
  return keyBackupRows(db, null).length > 0;
}

/** The second Argon2id run: the passphrase against the key row’s own salt. */
export function unlockRootKey(
  db: BackupDatabase,
  passphrase: string,
  manifestRowId: string | null,
): Uint8Array {
  const rows = keyBackupRows(db, manifestRowId);
  if (rows.length === 0) throw new ReaderError('no-key');

  for (const candidate of passphraseCandidates(passphrase)) {
    for (const row of rows) {
      let params: unknown;
      try {
        params = JSON.parse(row.kdfParamsJson);
      } catch {
        continue;
      }
      if (!isSupportedKdf(params)) continue;
      let backupKey: Uint8Array | null = null;
      try {
        backupKey = deriveKey(candidate, row.kdfSalt, params);
        const rootKey = open(backupKey, row.nonce, row.encryptedKey, aad.keyBackup(row.cryptoKeyId));
        if (rootKey) return rootKey;
      } catch (error) {
        if (isOutOfMemory(error)) throw new ReaderError('out-of-memory');
        throw error;
      } finally {
        wipe(backupKey);
      }
    }
  }
  throw new ReaderError('earlier-passphrase-needed');
}

export class KeyRing {
  private readonly rows = new Map<string, { encryptedKey: Uint8Array; nonce: Uint8Array; checksum: string | null }>();
  private readonly opened = new Map<string, Uint8Array | null>();
  private readonly rootKey: Uint8Array;

  constructor(db: BackupDatabase, rootKey: Uint8Array) {
    this.rootKey = rootKey;
    if (!db.hasTable('crypto_keys')) return;
    for (const row of db.all(
      "SELECT id, encrypted_key, nonce, checksum FROM crypto_keys WHERE type = 'data_encryption_key'",
    )) {
      const id = asString(row.id);
      const encryptedKey = asBytes(row.encrypted_key);
      const nonce = asBytes(row.nonce);
      const sum = asBytes(row.checksum);
      if (id && encryptedKey && nonce) {
        this.rows.set(id, { encryptedKey, nonce, checksum: sum ? toHex(sum) : null });
      }
    }
  }

  /** Null when the key is missing, does not open, or fails its checksum. */
  dataKey(cryptoKeyId: string): Uint8Array | null {
    if (this.opened.has(cryptoKeyId)) return this.opened.get(cryptoKeyId) ?? null;
    const row = this.rows.get(cryptoKeyId);
    let key: Uint8Array | null = null;
    if (row) {
      key = open(this.rootKey, row.nonce, row.encryptedKey, aad.dataKey(cryptoKeyId));
      if (key && row.checksum !== null && checksum(key) !== row.checksum) {
        wipe(key);
        key = null;
      }
    }
    this.opened.set(cryptoKeyId, key);
    return key;
  }

  wipe(): void {
    for (const key of this.opened.values()) wipe(key);
    this.opened.clear();
    wipe(this.rootKey);
  }
}
