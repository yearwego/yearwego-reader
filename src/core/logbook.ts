import { aad, open, sealedParts, splitPacked, unpadText } from './crypto';
import { asBytes, asNumber, asString, type BackupDatabase, type Row } from './database';
import type { KeyRing } from './keys';
import { checkInQuestionFor, questionFor } from './prompts';

export type EntryKind = 'intention' | 'answer' | 'aim';

export type Entry = {
  recordingId: string;
  kind: EntryKind;
  recordingType: string;
  question: string | null;
  createdAt: number;
  typed: boolean;
  text: string | null;
  /** Why there are no words: never transcribed, or the words did not decrypt. */
  textProblem: 'not-transcribed' | 'unreadable' | null;
  /** Inner-zip path of the encrypted audio, for a spoken entry. */
  audioPath: string | null;
  audioInBackup: boolean;
  durationMs: number | null;
  cryptoKeyId: string;
};

export type Outcome = 'did-it' | 'didnt' | 'waiting' | 'no-answer';

export type Day = {
  sessionId: string;
  flow: string;
  createdAt: number;
  checkAt: number | null;
  outcome: Outcome;
  /** “Did you do it?”, or the older monthly question; null where there was no yes or no. */
  checkInQuestion: string | null;
  intention: Entry | null;
  answer: Entry | null;
};

export type Aim = {
  id: string;
  createdAt: number;
  reachedAt: number | null;
  closedAt: number | null;
  /** The journey it belongs to, from 2026-11-20; null before journeys. */
  journeyName: string | null;
  entry: Entry;
};

const DAY_FLOWS = new Set(['core', 'compass', 'horizon']);
const ANSWER_TYPES = new Set(['celebration', 'fail_reason', 'reflection']);

function recordingFileName(src: string): string | null {
  const path = src.split('?')[0]?.split('#')[0] ?? src;
  const last = path.split('/').pop();
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function entrySelect(db: BackupDatabase, withTranscripts: boolean): string {
  const columns = [
    db.columns('sessions').has('flow') ? "COALESCE(s.flow, 'core') AS flow" : "'core' AS flow",
    'r.id AS recording_id',
    'r.recording_type_id AS recording_type',
    'r.created_at AS recording_created_at',
    'r.src AS src',
    db.column('recordings', 'r', 'duration_ms', 'duration_ms'),
    'r.crypto_key_id AS crypto_key_id',
    db.column('recordings', 'r', 'prompt_key', 'prompt_key'),
  ];
  if (withTranscripts) {
    columns.push(
      't.id AS transcript_id',
      't.encrypted_text AS encrypted_text',
      db.column('transcripts', 't', 'text_nonce', 'text_nonce'),
    );
  } else {
    columns.push('NULL AS transcript_id', 'NULL AS encrypted_text', 'NULL AS text_nonce');
  }
  return columns.join(', ');
}

/** A journey's name, plain before 2026-11-27 and sealed since (spec §8.2, §10.5). */
function journeySelect(db: BackupDatabase): string | null {
  const columns = db.columns('journeys');
  if (!db.columns('journey_milestones').has('milestone_id')) return null;
  if (columns.has('encrypted_name')) {
    return `NULL AS journey_name, j.id AS journey_id, j.crypto_key_id AS journey_key_id,
            j.encrypted_name AS encrypted_journey_name, j.set_aside_at AS set_aside_at`;
  }
  if (columns.has('name')) {
    return `j.name AS journey_name, NULL AS journey_id, NULL AS journey_key_id,
            NULL AS encrypted_journey_name, j.set_aside_at AS set_aside_at`;
  }
  return null;
}

export class LogbookBuilder {
  private readonly db: BackupDatabase;
  private readonly keys: KeyRing;
  private readonly entries: Map<string, Uint8Array>;
  private readonly withTranscripts: boolean;

  constructor(db: BackupDatabase, keys: KeyRing, innerEntries: Map<string, Uint8Array>) {
    this.db = db;
    this.keys = keys;
    this.entries = innerEntries;
    this.withTranscripts = db.hasTable('transcripts');
  }

  private transcriptJoin(): string {
    return this.withTranscripts ? 'LEFT JOIN transcripts t ON t.recording_id = r.id' : '';
  }

  private entryFrom(row: Row, kind: EntryKind): Entry {
    const recordingId = asString(row.recording_id) ?? '';
    const cryptoKeyId = asString(row.crypto_key_id) ?? '';
    const src = asString(row.src);
    const fileName = src ? recordingFileName(src) : null;
    const audioPath = fileName ? `recordings/${fileName}` : null;
    const recordingType = asString(row.recording_type) ?? '';
    const flow = asString(row.flow) ?? 'core';

    let text: string | null = null;
    let textProblem: Entry['textProblem'] = 'not-transcribed';
    const transcriptId = asString(row.transcript_id);
    const encryptedText = asBytes(row.encrypted_text);
    if (transcriptId && encryptedText) {
      const sealed = sealedParts(encryptedText, asBytes(row.text_nonce));
      const key = this.keys.dataKey(cryptoKeyId);
      const plaintext =
        key && sealed ? open(key, sealed.nonce, sealed.ciphertext, aad.transcript(transcriptId)) : null;
      if (plaintext) {
        text = new TextDecoder().decode(plaintext);
        textProblem = null;
      } else {
        textProblem = 'unreadable';
      }
    }

    return {
      recordingId,
      kind,
      recordingType,
      question: questionFor(asString(row.prompt_key), flow, recordingType),
      createdAt: asNumber(row.recording_created_at) ?? 0,
      typed: src === null,
      text,
      textProblem,
      audioPath,
      audioInBackup: audioPath !== null && this.entries.has(audioPath),
      durationMs: asNumber(row.duration_ms),
      cryptoKeyId,
    };
  }

  days(): Day[] {
    const sessionColumns = this.db.columns('sessions');
    const optional = (column: string) =>
      sessionColumns.has(column) ? `s.${column} AS ${column}` : `NULL AS ${column}`;
    const rows = this.db.all(
      `SELECT s.id AS session_id, s.created_at AS session_created_at, s.status_id AS session_status,
              ${optional('check_at')}, ${optional('did_goal')}, ${entrySelect(this.db, this.withTranscripts)}
       FROM sessions s
       JOIN recordings r ON r.session_id = s.id AND r.status_id = 'done'
         AND r.recording_type_id IN ('goal', 'celebration', 'fail_reason', 'reflection')
       ${this.transcriptJoin()}
       WHERE s.status_id != 'pending'
       ORDER BY s.created_at DESC, s.id DESC, r.created_at DESC`,
    );

    const days: Day[] = [];
    let current: Day | null = null;
    for (const row of rows) {
      const flow = asString(row.flow) ?? 'core';
      if (!DAY_FLOWS.has(flow)) continue;
      const sessionId = asString(row.session_id) ?? '';
      if (!current || current.sessionId !== sessionId) {
        current = {
          sessionId,
          flow,
          createdAt: asNumber(row.session_created_at) ?? 0,
          checkAt: asNumber(row.check_at),
          outcome: outcomeFor(asNumber(row.did_goal), asString(row.session_status)),
          checkInQuestion: checkInQuestionFor(flow),
          intention: null,
          answer: null,
        };
        days.push(current);
      }
      const recordingType = asString(row.recording_type) ?? '';
      if (recordingType === 'goal') {
        current.intention ??= this.entryFrom(row, 'intention');
      } else if (ANSWER_TYPES.has(recordingType)) {
        current.answer ??= this.entryFrom(row, 'answer');
      }
    }
    return days;
  }

  aims(): Aim[] {
    const milestoneColumns = this.db.columns('milestones');
    const hasCurrentMilestones =
      milestoneColumns.has('recording_id') &&
      milestoneColumns.has('closed_at') &&
      !milestoneColumns.has('session_id');
    return hasCurrentMilestones ? this.aimsFromMilestones() : this.aimsFromSessions();
  }

  /** Text in the sealed column was never sealed and reads as it is. Null when it won't open. */
  private journeyNameFrom(row: Row): string | null {
    const plain = row.journey_name ?? row.encrypted_journey_name;
    if (typeof plain === 'string') return plain;
    const blob = asBytes(row.encrypted_journey_name);
    const journeyId = asString(row.journey_id);
    const keyId = asString(row.journey_key_id);
    if (!blob || !journeyId || !keyId) return null;
    const split = splitPacked(blob);
    const key = this.keys.dataKey(keyId);
    if (!split.ok || !key) return null;
    const padded = open(key, split.parts.nonce, split.parts.ciphertext, aad.journeyName(journeyId));
    return padded ? unpadText(padded) : null;
  }

  private aimsFromMilestones(): Aim[] {
    const journeyColumns = journeySelect(this.db);
    const hasJourneys = journeyColumns !== null;
    const journeyJoin = hasJourneys
      ? `LEFT JOIN journey_milestones jm ON jm.milestone_id = m.id
         LEFT JOIN journeys j ON j.id = jm.journey_id`
      : '';
    const rows = this.db.all(
      `SELECT m.id AS milestone_id, m.created_at AS milestone_created_at, m.reached_at AS reached_at,
              m.closed_at AS closed_at, ${this.db.column('milestones', 'm', 'focused_at', 'focused_at')},
              ${journeyColumns ?? 'NULL AS set_aside_at'}, ${entrySelect(this.db, this.withTranscripts)}
       FROM milestones m
       JOIN recordings r ON r.id = m.recording_id
       JOIN sessions s ON s.id = r.session_id
       ${journeyJoin}
       ${this.transcriptJoin()}
       ORDER BY m.created_at DESC, m.id DESC`,
    );
    const aims = rows.map((row) => ({
      id: asString(row.milestone_id) ?? '',
      createdAt: asNumber(row.milestone_created_at) ?? 0,
      reachedAt: asNumber(row.reached_at),
      closedAt: asNumber(row.closed_at),
      journeyName: this.journeyNameFrom(row),
      focusedAt: asNumber(row.focused_at),
      setAside: asNumber(row.set_aside_at) !== null,
      entry: this.entryFrom(row, 'aim'),
    }));
    if (!hasJourneys) return aims.map(({ focusedAt: _f, setAside: _s, ...aim }) => aim);
    // From 2026-11-20 many are open; the current one is the unreached milestone focused last.
    const open = aims.filter((aim) => aim.reachedAt === null && !aim.setAside);
    const current = [...open].sort(
      (a, b) => (b.focusedAt ?? b.createdAt) - (a.focusedAt ?? a.createdAt),
    )[0];
    const ordered = current ? [current, ...aims.filter((aim) => aim !== current)] : aims;
    return ordered.map(({ focusedAt: _f, setAside: _s, ...aim }) => aim);
  }

  /** Before the milestones table: the same rule the 2026-10-29 backfill migration used. */
  private aimsFromSessions(): Aim[] {
    const sessionColumns = this.db.columns('sessions');
    if (!sessionColumns.has('flow')) return [];
    const optional = (column: string) =>
      sessionColumns.has(column) ? `s.${column} AS ${column}` : `NULL AS ${column}`;
    const rows = this.db.all(
      `SELECT s.id AS session_id, ${optional('did_goal')}, ${optional('confirmed_at')},
              ${entrySelect(this.db, this.withTranscripts)}
       FROM sessions s
       JOIN recordings r ON r.session_id = s.id AND r.status_id = 'done' AND r.recording_type_id = 'goal'
       ${this.transcriptJoin()}
       WHERE s.flow = 'aim' AND s.status_id = 'done'
       ORDER BY r.created_at DESC, r.id DESC`,
    );

    const aims: Aim[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const sessionId = asString(row.session_id) ?? '';
      if (seen.has(sessionId)) continue;
      seen.add(sessionId);
      const entry = this.entryFrom(row, 'aim');
      const newer = aims[aims.length - 1];
      aims.push({
        id: sessionId,
        createdAt: entry.createdAt,
        reachedAt: asNumber(row.did_goal) === 1 ? asNumber(row.confirmed_at) : null,
        closedAt: newer ? newer.createdAt : null,
        journeyName: null,
        entry,
      });
    }
    return aims;
  }
}

function outcomeFor(didGoal: number | null, status: string | null): Outcome {
  if (didGoal === 1) return 'did-it';
  if (didGoal === 0) return 'didnt';
  if (status === 'active') return 'waiting';
  return 'no-answer';
}
