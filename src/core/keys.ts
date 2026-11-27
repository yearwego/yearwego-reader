import {
  aad,
  checksum,
  deriveKey,
  isSupportedKdf,
  normalizePassphrase,
  open,
  sealedParts,
  toHex,
  wipe,
  type PackedParts,
} from './crypto';
import { asBytes, asString, type BackupDatabase } from './database';
import { isOutOfMemory, ReaderError } from './errors';

type KeyBackupRow = {
  id: string;
  cryptoKeyId: string;
  sealedRootKey: PackedParts;
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
      `SELECT b.id, b.crypto_key_id, b.encrypted_key, ${db.column('crypto_key_backups', 'b', 'nonce', 'nonce')},
              b.kdf_salt, b.kdf_params_json
       FROM crypto_key_backups b`,
    )
    .flatMap((row): KeyBackupRow[] => {
      const id = asString(row.id);
      const cryptoKeyId = asString(row.crypto_key_id);
      const sealedRootKey = sealedParts(asBytes(row.encrypted_key), asBytes(row.nonce));
      const kdfSalt = asBytes(row.kdf_salt);
      const kdfParamsJson = asString(row.kdf_params_json);
      if (!id || !cryptoKeyId || !sealedRootKey || !kdfSalt || !kdfParamsJson) return [];
      return [{ id, cryptoKeyId, sealedRootKey, kdfSalt, kdfParamsJson }];
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

  const normalized = normalizePassphrase(passphrase);
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
      backupKey = deriveKey(normalized, row.kdfSalt, params);
      const rootKey = open(
        backupKey,
        row.sealedRootKey.nonce,
        row.sealedRootKey.ciphertext,
        aad.keyBackup(row.cryptoKeyId),
      );
      if (rootKey) return rootKey;
    } catch (error) {
      if (isOutOfMemory(error)) throw new ReaderError('out-of-memory');
      throw error;
    } finally {
      wipe(backupKey);
    }
  }
  throw new ReaderError('earlier-passphrase-needed');
}

export class KeyRing {
  private readonly rows = new Map<string, { sealedKey: PackedParts; checksum: string | null }>();
  private readonly opened = new Map<string, Uint8Array | null>();
  private readonly rootKey: Uint8Array;

  constructor(db: BackupDatabase, rootKey: Uint8Array) {
    this.rootKey = rootKey;
    if (!db.hasTable('crypto_keys')) return;
    for (const row of db.all(
      `SELECT k.id, k.encrypted_key, ${db.column('crypto_keys', 'k', 'nonce', 'nonce')}, k.checksum
       FROM crypto_keys k WHERE k.type = 'data_encryption_key'`,
    )) {
      const id = asString(row.id);
      const sealedKey = sealedParts(asBytes(row.encrypted_key), asBytes(row.nonce));
      const sum = asBytes(row.checksum);
      if (id && sealedKey) {
        this.rows.set(id, { sealedKey, checksum: sum ? toHex(sum) : null });
      }
    }
  }

  /** Null when the key is missing, does not open, or fails its checksum. */
  dataKey(cryptoKeyId: string): Uint8Array | null {
    if (this.opened.has(cryptoKeyId)) return this.opened.get(cryptoKeyId) ?? null;
    const row = this.rows.get(cryptoKeyId);
    let key: Uint8Array | null = null;
    if (row) {
      key = open(this.rootKey, row.sealedKey.nonce, row.sealedKey.ciphertext, aad.dataKey(cryptoKeyId));
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
