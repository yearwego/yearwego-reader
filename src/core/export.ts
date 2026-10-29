import type { DecryptedAudio } from './audio';
import type { Aim, Day, Entry, Outcome } from './logbook';
import type { IntegrityProblem } from './manifest';
import { writeZip } from './zip';

export type ExportSource = {
  backupCreatedAt: string | null;
  appVersion: string | null;
  aims: Aim[];
  days: Day[];
  problems: IntegrityProblem[];
  decryptAudio: (entry: Entry) => DecryptedAudio | null;
};

const OUTCOME_WORDS: Record<Outcome, string> = {
  'did-it': 'Did it',
  didnt: 'Didn’t',
  waiting: 'Not answered yet',
  'no-answer': 'No answer',
};

const pad = (value: number) => String(value).padStart(2, '0');

export function localDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function longDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function timeOfDay(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function outcomeWords(outcome: Outcome): string {
  return OUTCOME_WORDS[outcome];
}

function slugFor(entry: Entry): string {
  if (entry.kind === 'aim') return 'headed';
  if (entry.kind === 'intention') return 'intention';
  if (entry.recordingType === 'celebration') return 'proud';
  if (entry.recordingType === 'fail_reason') return 'in-the-way';
  return 'reflection';
}

type FilePlan = Map<string, string>;

/** `recordings/<yyyy-mm-dd>-<kind>.<ext>`, numbered when a date repeats. */
function planFileNames(aims: Aim[], days: Day[]): FilePlan {
  const plan: FilePlan = new Map();
  const used = new Set<string>();
  const ordered: { entry: Entry; dayMs: number }[] = [];
  for (const aim of [...aims].reverse()) ordered.push({ entry: aim.entry, dayMs: aim.createdAt });
  for (const day of [...days].reverse()) {
    if (day.intention) ordered.push({ entry: day.intention, dayMs: day.createdAt });
    if (day.answer) ordered.push({ entry: day.answer, dayMs: day.createdAt });
  }
  for (const { entry, dayMs } of ordered) {
    if (!entry.audioPath) continue;
    const base = `recordings/${localDate(dayMs)}-${slugFor(entry)}`;
    let name = base;
    for (let count = 2; used.has(name); count += 1) name = `${base}-${count}`;
    used.add(name);
    plan.set(entry.recordingId, name);
  }
  return plan;
}

function quoteLines(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

function entryMarkdown(entry: Entry, recordingFile: string | null): string {
  const lines: string[] = [];
  const heading = entry.question ?? 'Entry';
  lines.push(`**${heading}**${entry.typed ? ' (typed)' : ''}`);
  if (entry.text) {
    lines.push('', quoteLines(entry.text));
  } else if (entry.textProblem === 'unreadable') {
    lines.push('', '_The words for this entry couldn’t be read._');
  } else if (!entry.typed) {
    lines.push('', '_Not transcribed. The recording has the words._');
  }
  if (recordingFile) {
    lines.push('', `Recording: [${recordingFile}](${recordingFile})`);
  } else if (!entry.typed) {
    lines.push('', '_The recording couldn’t be opened._');
  }
  return lines.join('\n');
}

export function buildExport(source: ExportSource): Uint8Array {
  const plan = planFileNames(source.aims, source.days);
  const files: { path: string; data: Uint8Array; compress: boolean }[] = [];
  const written = new Map<string, string>();

  const allEntries = [
    ...source.aims.map((aim) => aim.entry),
    ...source.days.flatMap((day) => [day.intention, day.answer].filter((entry): entry is Entry => !!entry)),
  ];
  for (const entry of allEntries) {
    const base = plan.get(entry.recordingId);
    if (!base) continue;
    const audio = source.decryptAudio(entry);
    if (!audio || audio.bytes.length === 0) continue;
    const path = `${base}.${audio.extension}`;
    files.push({ path, data: audio.bytes, compress: false });
    written.set(entry.recordingId, path);
  }

  const markdown = buildMarkdown(source, written);
  const json = buildJson(source, written);
  files.unshift(
    { path: 'logbook.md', data: new TextEncoder().encode(markdown), compress: true },
    { path: 'logbook.json', data: new TextEncoder().encode(json), compress: true },
  );
  return writeZip(files);
}

export function buildMarkdown(source: ExportSource, written: Map<string, string>): string {
  const out: string[] = ['# Your YearWeGo Logbook', ''];
  if (source.backupCreatedAt) {
    const made = Date.parse(source.backupCreatedAt);
    if (!Number.isNaN(made)) out.push(`From a backup made ${longDate(made)}.`, '');
  }

  out.push('## Where you’re headed', '');
  if (source.aims.length === 0) out.push('_Nothing saved here._', '');
  for (const aim of source.aims) {
    const status: string[] = [`Set ${longDate(aim.createdAt)}`];
    if (aim.reachedAt) status.push(`you got there ${longDate(aim.reachedAt)}`);
    if (aim.closedAt) status.push(`replaced ${longDate(aim.closedAt)}`);
    out.push(`### ${aim.closedAt ? 'Earlier' : 'Now'}`, '', `${status.join('; ')}.`, '');
    out.push(entryMarkdown(aim.entry, written.get(aim.entry.recordingId) ?? null), '');
  }

  out.push('## Days', '');
  if (source.days.length === 0) out.push('_No days in this backup._', '');
  for (const day of source.days) {
    out.push(`### ${longDate(day.createdAt)}`, '');
    if (day.intention) {
      out.push(entryMarkdown(day.intention, written.get(day.intention.recordingId) ?? null), '');
    }
    if (day.checkInQuestion) out.push(`**${day.checkInQuestion}** ${outcomeWords(day.outcome)}`, '');
    if (day.answer) out.push(entryMarkdown(day.answer, written.get(day.answer.recordingId) ?? null), '');
  }

  if (source.problems.length > 0) {
    out.push('## Problems found in the backup', '');
    for (const problem of source.problems) out.push(`- ${problem.kind}: ${problem.path ?? ''}`);
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

function entryJson(entry: Entry | null, written: Map<string, string>) {
  if (!entry) return null;
  return {
    question: entry.question,
    text: entry.text,
    typed: entry.typed,
    recordedAt: new Date(entry.createdAt).toISOString(),
    recording: written.get(entry.recordingId) ?? null,
    durationMs: entry.durationMs,
    textProblem: entry.textProblem,
  };
}

export function buildJson(source: ExportSource, written: Map<string, string>): string {
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  return `${JSON.stringify(
    {
      format: 'yearwego-logbook',
      version: 1,
      backup: { createdAt: source.backupCreatedAt, appVersion: source.appVersion },
      whereYoureHeaded: source.aims.map((aim) => ({
        current: aim.closedAt === null,
        setAt: iso(aim.createdAt),
        reachedAt: iso(aim.reachedAt),
        replacedAt: iso(aim.closedAt),
        entry: entryJson(aim.entry, written),
      })),
      days: source.days.map((day) => ({
        date: localDate(day.createdAt),
        startedAt: iso(day.createdAt),
        checkInDueAt: iso(day.checkAt),
        kind: day.flow === 'core' ? 'day' : day.flow,
        checkInQuestion: day.checkInQuestion,
        outcome: day.checkInQuestion ? day.outcome : null,
        intention: entryJson(day.intention, written),
        answer: entryJson(day.answer, written),
      })),
      problems: source.problems,
    },
    null,
    2,
  )}\n`;
}
