import { checksum, hash32 } from './crypto';
import type { ZipEntries } from './zip';

export type ManifestEntry = { path: string; type: string; size: number; checksum: string };

export type Manifest = {
  backup_id?: string;
  created_at?: string;
  app?: { version?: string | null; build_number?: string | null };
  database?: { filename?: string | null };
  backup_format_version?: number;
  entries: ManifestEntry[];
  encryption?: { crypto_key_backup_id?: string | null };
  device?: { platform?: string; model?: string | null; os_version?: string | null };
  metadata?: { schema_tag?: string | null; entry_count?: number; total_bytes?: number };
  manifest_hash?: string;
};

export type IntegrityProblem = {
  kind:
    | 'manifest-missing'
    | 'manifest-unreadable'
    | 'manifest-hash'
    | 'entry-missing'
    | 'entry-size'
    | 'entry-checksum'
    | 'entry-unlisted';
  path: string | null;
};

export type IntegrityReport = {
  ok: boolean;
  problems: IntegrityProblem[];
  /** Paths whose bytes do not match the manifest. */
  damagedPaths: Set<string>;
};

const MANIFEST_PATH = 'manifest.json';

export function verifyManifest(entries: ZipEntries): {
  manifest: Manifest | null;
  integrity: IntegrityReport;
} {
  const problems: IntegrityProblem[] = [];
  const damagedPaths = new Set<string>();
  const report = (): IntegrityReport => ({ ok: problems.length === 0, problems, damagedPaths });

  const manifestBytes = entries.get(MANIFEST_PATH);
  if (!manifestBytes) {
    problems.push({ kind: 'manifest-missing', path: MANIFEST_PATH });
    return { manifest: null, integrity: report() };
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest;
    if (!Array.isArray(manifest.entries)) throw new Error('No entries');
  } catch {
    problems.push({ kind: 'manifest-unreadable', path: MANIFEST_PATH });
    return { manifest: null, integrity: report() };
  }

  const { manifest_hash: recorded, ...unsigned } = manifest;
  const expected = hash32(new TextEncoder().encode(JSON.stringify(unsigned)));
  if (recorded !== expected) problems.push({ kind: 'manifest-hash', path: MANIFEST_PATH });

  const listed = new Set<string>();
  for (const entry of manifest.entries) {
    listed.add(entry.path);
    const bytes = entries.get(entry.path);
    if (!bytes) {
      problems.push({ kind: 'entry-missing', path: entry.path });
      damagedPaths.add(entry.path);
      continue;
    }
    if (bytes.length !== entry.size) {
      problems.push({ kind: 'entry-size', path: entry.path });
      damagedPaths.add(entry.path);
    } else if (checksum(bytes) !== entry.checksum) {
      problems.push({ kind: 'entry-checksum', path: entry.path });
      damagedPaths.add(entry.path);
    }
  }

  for (const path of entries.keys()) {
    if (path !== MANIFEST_PATH && !listed.has(path)) {
      problems.push({ kind: 'entry-unlisted', path });
    }
  }

  return { manifest, integrity: report() };
}
