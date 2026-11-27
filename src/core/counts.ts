import { aad, open, sealedParts, unpad, wipe } from './crypto';
import { asBytes, asNumber, asString, type BackupDatabase } from './database';
import type { KeyRing } from './keys';

export type CountKind = 'add' | 'check';
export type CountFormat = 'number' | 'time' | 'weight' | 'distance' | 'money' | 'percent';

export type CountEntry = {
  /** The local day, `YYYY-MM-DD`. */
  day: string;
  /** In the base unit (spec §10.6). */
  value: number;
  /** Entered at a check-in rather than by hand. */
  fromCheckIn: boolean;
};

/** One count on one milestone (spec §10.6), worked out the way the app shows it. */
export type Count = {
  /** Null when it doesn't open. */
  name: string | null;
  kind: CountKind;
  format: CountFormat;
  unit: string | null;
  unitLabel: string | null;
  goal: number | null;
  baseline: number | null;
  baselineDay: string | null;
  /** The entries that count toward this milestone, oldest first. */
  entries: CountEntry[];
  /** Add it: the baseline plus every entry. Check it: the latest reading, or the baseline. */
  total: number | null;
  /** Check it: the baseline, or the first reading. */
  start: number | null;
  /** Some of its values didn't open. */
  unreadable: boolean;
};

export type CountMilestone = { id: string; createdAt: number; reachedAt: number | null };

const FORMATS = new Set<CountFormat>(['number', 'time', 'weight', 'distance', 'money', 'percent']);

function localDay(ms: number): string {
  const at = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

function openText(key: Uint8Array | null, packed: Uint8Array | null, aadText: string): string | null {
  if (!key) return null;
  // Counts arrived after nonce packing, so their values are always packed.
  const parts = sealedParts(packed, null);
  if (!parts) return null;
  const padded = open(key, parts.nonce, parts.ciphertext, aadText);
  if (!padded) return null;
  const plaintext = unpad(padded);
  const text = plaintext ? new TextDecoder().decode(plaintext) : null;
  wipe(padded);
  return text;
}

function openNumber(key: Uint8Array | null, packed: Uint8Array | null, aadText: string): number | null {
  const text = openText(key, packed, aadText);
  if (text === null || text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Every milestone's counts, by milestone id. Empty for an archive from before counts. */
export function readCounts(
  db: BackupDatabase,
  keys: KeyRing,
  milestones: readonly CountMilestone[],
  now = Date.now(),
): Map<string, Count[]> {
  const result = new Map<string, Count[]>();
  if (!db.hasTable('measures') || !db.hasTable('milestone_measures') || !db.hasTable('measure_entries')) {
    return result;
  }
  const entriesByMeasure = new Map<string, { day: string; createdAt: number; value: number | null; fromCheckIn: boolean }[]>();
  const keyOf = new Map<string, string>();
  for (const row of db.all('SELECT id, crypto_key_id FROM measures')) {
    const id = asString(row.id);
    const keyId = asString(row.crypto_key_id);
    if (id && keyId) keyOf.set(id, keyId);
  }
  for (const row of db.all(
    'SELECT id, measure_id, encrypted_value, day, session_id, created_at FROM measure_entries ORDER BY day, created_at, id',
  )) {
    const id = asString(row.id) ?? '';
    const measureId = asString(row.measure_id) ?? '';
    const key = keys.dataKey(keyOf.get(measureId) ?? '');
    const list = entriesByMeasure.get(measureId) ?? [];
    list.push({
      day: asString(row.day) ?? '',
      createdAt: asNumber(row.created_at) ?? 0,
      value: openNumber(key, asBytes(row.encrypted_value), aad.measureEntryValue(id)),
      fromCheckIn: asString(row.session_id) !== null,
    });
    entriesByMeasure.set(measureId, list);
  }

  const byId = new Map(milestones.map((milestone) => [milestone.id, milestone]));
  for (const row of db.all(
    `SELECT mm.id AS id, mm.milestone_id AS milestone_id, mm.measure_id AS measure_id,
            mm.aggregation AS aggregation, mm.encrypted_target_total AS encrypted_target_total,
            mm.encrypted_baseline AS encrypted_baseline, mm.baseline_day AS baseline_day,
            m.encrypted_name AS encrypted_name, m.format AS format, m.unit AS unit,
            m.encrypted_unit_label AS encrypted_unit_label, m.crypto_key_id AS crypto_key_id
     FROM milestone_measures mm JOIN measures m ON m.id = mm.measure_id
     ORDER BY mm.position IS NULL, mm.position, mm.created_at, mm.id`,
  )) {
    const milestone = byId.get(asString(row.milestone_id) ?? '');
    if (!milestone) continue;
    const id = asString(row.id) ?? '';
    const measureId = asString(row.measure_id) ?? '';
    const key = keys.dataKey(asString(row.crypto_key_id) ?? '');
    const name = openText(key, asBytes(row.encrypted_name), aad.measureName(measureId));
    const labelBytes = asBytes(row.encrypted_unit_label);
    const unitLabel = labelBytes ? openText(key, labelBytes, aad.measureUnitLabel(measureId)) : null;
    const targetBytes = asBytes(row.encrypted_target_total);
    const goal = targetBytes ? openNumber(key, targetBytes, aad.milestoneMeasureTarget(id)) : null;
    const baselineBytes = asBytes(row.encrypted_baseline);
    const baseline = baselineBytes ? openNumber(key, baselineBytes, aad.milestoneMeasureBaseline(id)) : null;
    const baselineDay = baseline === null ? null : asString(row.baseline_day);
    const from = baselineDay ?? localDay(milestone.createdAt);
    const to = localDay(milestone.reachedAt ?? now);
    const all = entriesByMeasure.get(measureId) ?? [];
    const inWindow = all.filter((entry) => entry.day >= from && entry.day <= to);
    const entries = inWindow.flatMap((entry): CountEntry[] =>
      entry.value === null ? [] : [{ day: entry.day, value: entry.value, fromCheckIn: entry.fromCheckIn }],
    );
    const kind: CountKind = asString(row.aggregation) === 'latest' ? 'check' : 'add';
    const format = (asString(row.format) ?? 'number') as CountFormat;
    let total: number | null;
    let start: number | null = null;
    if (kind === 'add') {
      total = (baseline ?? 0) + entries.reduce((sum, entry) => sum + entry.value, 0);
    } else {
      start = baseline ?? entries[0]?.value ?? null;
      total = entries.at(-1)?.value ?? baseline;
    }
    const list = result.get(milestone.id) ?? [];
    list.push({
      name,
      kind,
      format: FORMATS.has(format) ? format : 'number',
      unit: asString(row.unit),
      unitLabel,
      goal,
      baseline,
      baselineDay,
      entries,
      total,
      start,
      unreadable:
        name === null ||
        (labelBytes !== null && unitLabel === null) ||
        (targetBytes !== null && goal === null) ||
        (baselineBytes !== null && baseline === null) ||
        inWindow.some((entry) => entry.value === null),
    });
    result.set(milestone.id, list);
  }
  return result;
}

const GRAMS_PER: Record<string, number> = { lb: 453.59237, kg: 1000 };
const MILLIMETERS_PER: Record<string, number> = {
  mi: 1_609_344,
  km: 1_000_000,
  m: 1000,
  ft: 304.8,
  in: 25.4,
  cm: 10,
};

function grouped(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function duration(ms: number, kind: CountKind): string {
  if (kind === 'add') {
    const minutes = Math.round(ms / 60_000);
    const hours = Math.floor(minutes / 60);
    if (hours === 0) return `${minutes}m`;
    return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
  }
  const seconds = Math.round(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const rest = String(seconds % 60).padStart(2, '0');
  if (hours === 0) return `${Math.floor(seconds / 60)}:${rest}`;
  return `${hours}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${rest}`;
}

/** A value as the app shows it, with its unit. */
export function countValue(count: Pick<Count, 'format' | 'unit' | 'unitLabel' | 'kind'>, value: number): string {
  switch (count.format) {
    case 'time':
      return duration(value, count.kind);
    case 'weight':
      return `${grouped(value / (GRAMS_PER[count.unit ?? ''] ?? 1))} ${count.unit ?? 'g'}`;
    case 'distance':
      return `${grouped(value / (MILLIMETERS_PER[count.unit ?? ''] ?? 1))} ${count.unit ?? 'mm'}`;
    case 'money':
      try {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: count.unit ?? 'USD',
          minimumFractionDigits: Number.isInteger(value / 100) ? 0 : 2,
        }).format(value / 100);
      } catch {
        return `${grouped(value / 100)} ${count.unit ?? ''}`.trim();
      }
    case 'percent':
      return `${grouped(value * 100)}%`;
    default:
      return count.unitLabel ? `${grouped(value)} ${count.unitLabel}` : grouped(value);
  }
}

/** One line for a count: “Books · 26 so far · goal 24”, “Mile time · 9:48 latest · started 11:22 ·
 *  goal 7:30”. */
export function countLine(count: Count): string {
  const parts = [count.name ?? 'A count that couldn’t be read'];
  if (count.kind === 'add') {
    parts.push(`${countValue(count, count.total ?? 0)} so far`);
  } else {
    parts.push(count.total === null ? 'no reading yet' : `${countValue(count, count.total)} latest`);
    if (count.start !== null) parts.push(`started ${countValue(count, count.start)}`);
  }
  if (count.goal !== null) parts.push(`goal ${countValue(count, count.goal)}`);
  return parts.join(' · ');
}
