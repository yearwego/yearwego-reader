export type ReaderErrorCode =
  | 'not-a-backup'
  | 'unsupported-version'
  | 'wrong-passphrase'
  | 'earlier-passphrase-needed'
  | 'no-key'
  | 'damaged'
  | 'out-of-memory';

const MESSAGES: Record<ReaderErrorCode, string> = {
  'not-a-backup':
    'This doesn’t look like a YearWeGo backup. Choose the file that ends in .yearwego.backup.zip.',
  'unsupported-version':
    'This backup was made by a newer version of YearWeGo than this reader understands. Look for a newer copy of the reader.',
  'wrong-passphrase':
    'That passphrase didn’t open this backup. Check each word and the dashes between them, then try again. If it’s right, the file may be damaged.',
  'earlier-passphrase-needed':
    'Your passphrase opened the backup, but your words are locked with a passphrase you used before it. Enter that earlier passphrase.',
  'no-key':
    'This backup opened, but it doesn’t carry the key to your words and recordings. They can only be read on the phone that made it.',
  damaged: 'Part of this backup is damaged and can’t be read.',
  'out-of-memory':
    'This computer ran out of memory for this page. Close other tabs and windows, then try again.',
};

export class ReaderError extends Error {
  readonly code: ReaderErrorCode;
  readonly detail: string | null;

  constructor(code: ReaderErrorCode, detail: string | null = null) {
    super(MESSAGES[code]);
    this.name = 'ReaderError';
    this.code = code;
    this.detail = detail;
  }
}

export function isOutOfMemory(error: unknown): boolean {
  if (error instanceof RangeError) return true;
  const text = String(error instanceof Error ? error.message : error);
  return /out of memory|Cannot enlarge memory|allocation failed|Aborted\(OOM\)/i.test(text);
}
