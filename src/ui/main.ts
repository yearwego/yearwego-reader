import {
  localDate,
  longDate,
  outcomeWords,
  ReaderError,
  unlockBackup,
  unsealArchive,
  type Aim,
  type ArchiveFile,
  type Day,
  type Entry,
  type OpenedBackup,
  type ProgressStep,
  type UnsealedArchive,
} from '../core';
import licenses from 'virtual:licenses';
import { h, nextPaint } from './dom';
import { loadSqlInBrowser } from './sql-browser';
import './styles.css';

const COMPUTER_NOTE =
  'Use a computer. Your backup and both passphrase steps need more memory than most phones give a web page.';

const PROGRESS_TEXT: Record<ProgressStep, string> = {
  reading: 'Reading your backup…',
  'unlocking-backup': 'Unlocking your backup with your passphrase. This takes a few seconds…',
  checking: 'Checking every file in your backup…',
  'opening-database': 'Opening your Logbook…',
  'unlocking-words': 'Unlocking your words and recordings. This takes a few seconds more…',
  'reading-words': 'Reading your words…',
  done: '',
};

const PROBLEM_TEXT: Record<string, string> = {
  'manifest-missing': 'The list of files is missing.',
  'manifest-unreadable': 'The list of files can’t be read.',
  'manifest-hash': 'The list of files doesn’t match its own check.',
  'entry-missing': 'A file is missing:',
  'entry-size': 'A file is shorter or longer than it should be:',
  'entry-checksum': 'A file doesn’t match its check:',
  'entry-unlisted': 'A file isn’t on the list:',
};

const app = document.getElementById('app')!;
const blobUrls: string[] = [];
let opened: OpenedBackup | null = null;

function isProbablyPhone(): boolean {
  const userAgent = navigator.userAgent;
  if (/iPhone|iPod|Android.+Mobile|Windows Phone/i.test(userAgent)) return true;
  return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
}

function messageFor(error: unknown): string {
  if (error instanceof ReaderError) return error.message;
  return 'Something went wrong while opening this backup. Reload the page and try again.';
}

function clearBlobUrls() {
  for (const url of blobUrls.splice(0)) URL.revokeObjectURL(url);
}

async function readFiles(list: FileList): Promise<ArchiveFile[]> {
  return Promise.all(
    [...list].map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })),
  );
}

function renderStart() {
  clearBlobUrls();
  opened?.close();
  opened = null;
  document.title = 'YearWeGo Reader';

  const phone = isProbablyPhone();
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const error = h('p', { class: 'error', role: 'alert' });
  const fileInput = h('input', {
    type: 'file',
    id: 'backup-file',
    accept: '.zip,.json,.encrypted',
    multiple: true,
    required: true,
    'aria-describedby': 'backup-file-hint',
  });
  const passphraseInput = h('input', {
    type: 'password',
    id: 'passphrase',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    required: true,
    'aria-describedby': 'passphrase-hint',
  });
  const showToggle = h('input', { type: 'checkbox', id: 'show-passphrase' });
  showToggle.addEventListener('change', () => {
    passphraseInput.type = showToggle.checked ? 'text' : 'password';
  });
  const openButton = h('button', { type: 'submit' }, 'Open');

  const form = h(
    'form',
    { novalidate: true },
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'backup-file' }, 'Your backup file'),
      h('span', { class: 'hint', id: 'backup-file-hint' }, 'It ends in .yearwego.backup.zip.'),
      fileInput,
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'passphrase' }, 'Your passphrase'),
      h(
        'span',
        { class: 'hint', id: 'passphrase-hint' },
        'The words you saved when you made the backup, with the dashes between them.',
      ),
      passphraseInput,
      h('label', { class: 'show-passphrase', for: 'show-passphrase' }, showToggle, 'Show passphrase'),
    ),
    h('div', {}, openButton),
    status,
    error,
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    if (!fileInput.files || fileInput.files.length === 0) {
      error.textContent = 'Choose your backup file first.';
      fileInput.focus();
      return;
    }
    if (!passphraseInput.value) {
      error.textContent = 'Enter your passphrase.';
      passphraseInput.focus();
      return;
    }

    const controls = [fileInput, passphraseInput, showToggle, openButton];
    controls.forEach((control) => (control.disabled = true));
    const onProgress = async (step: ProgressStep) => {
      status.textContent = PROGRESS_TEXT[step];
      await nextPaint();
    };

    try {
      const files = await readFiles(fileInput.files);
      const archive = await unsealArchive(files, passphraseInput.value, onProgress);
      await unlockAndShow(archive, undefined, onProgress, form, status);
    } catch (caught) {
      status.textContent = '';
      error.textContent = messageFor(caught);
      if (caught instanceof ReaderError && caught.code === 'wrong-passphrase') passphraseInput.focus();
    } finally {
      controls.forEach((control) => (control.disabled = false));
    }
  });

  const note = h('p', { class: phone ? 'note prominent' : 'note', role: phone ? 'alert' : undefined }, COMPUTER_NOTE);

  app.replaceChildren(
    h('h1', {}, 'Open your YearWeGo backup'),
    h(
      'p',
      { class: 'lede' },
      'See your Logbook, play your recordings, and save everything as ordinary files. This page works offline, and your backup and passphrase stay on this computer.',
    ),
    note,
    form,
    h(
      'p',
      { class: 'footer' },
      'YearWeGo Reader. It only reads backups and never changes them.',
    ),
  );
}

async function unlockAndShow(
  archive: UnsealedArchive,
  earlierPassphrase: string | undefined,
  onProgress: (step: ProgressStep) => Promise<void>,
  form: HTMLFormElement,
  status: HTMLElement,
) {
  try {
    opened = await unlockBackup(archive, {
      loadSql: loadSqlInBrowser,
      passphrase: earlierPassphrase,
      onProgress,
    });
    renderLogbook(opened);
  } catch (caught) {
    if (caught instanceof ReaderError && caught.code === 'earlier-passphrase-needed') {
      status.textContent = '';
      renderEarlierPassphrase(archive, form, Boolean(earlierPassphrase));
      return;
    }
    throw caught;
  }
}

function renderEarlierPassphrase(archive: UnsealedArchive, form: HTMLFormElement, triedOnce: boolean) {
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const error = h(
    'p',
    { class: 'error', role: 'alert' },
    triedOnce ? 'That earlier passphrase didn’t unlock your words either. Try another.' : '',
  );
  const input = h('input', {
    type: 'password',
    id: 'earlier-passphrase',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    'aria-describedby': 'earlier-hint',
  });
  const button = h('button', { type: 'submit' }, 'Unlock');
  const earlierForm = h(
    'form',
    { novalidate: true },
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'earlier-passphrase' }, 'Your earlier passphrase'),
      h(
        'span',
        { class: 'hint', id: 'earlier-hint' },
        new ReaderError('earlier-passphrase-needed').message,
      ),
      input,
    ),
    h('div', {}, button),
    status,
    error,
  );
  earlierForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!input.value) {
      error.textContent = 'Enter your earlier passphrase.';
      input.focus();
      return;
    }
    input.disabled = true;
    button.disabled = true;
    error.textContent = '';
    try {
      await unlockAndShow(
        archive,
        input.value,
        async (step) => {
          status.textContent = PROGRESS_TEXT[step];
          await nextPaint();
        },
        earlierForm,
        status,
      );
    } catch (caught) {
      status.textContent = '';
      error.textContent = messageFor(caught);
    } finally {
      input.disabled = false;
      button.disabled = false;
    }
  });
  form.replaceWith(earlierForm);
  input.focus();
}

function playerFor(backup: OpenedBackup, entry: Entry, label: string): HTMLElement | null {
  if (!entry.audioPath) return null;
  const container = h('div', { class: 'player' });
  if (!entry.audioInBackup) {
    container.append(h('p', { class: 'meta' }, 'This recording isn’t in the backup.'));
    return container;
  }
  const button = h('button', { type: 'button', class: 'secondary', 'aria-label': `Play ${label}` }, 'Play');
  button.addEventListener('click', () => {
    const result = backup.decryptAudio(entry);
    if (!result.ok) {
      container.replaceChildren(h('p', { class: 'meta' }, 'This recording is damaged and can’t be played.'));
      return;
    }
    const url = URL.createObjectURL(new Blob([result.audio.bytes as BlobPart], { type: result.audio.mimeType }));
    blobUrls.push(url);
    const audio = h('audio', { controls: true, src: url, 'aria-label': label });
    container.replaceChildren(audio);
    if (!result.audio.complete) {
      container.append(h('p', { class: 'meta' }, 'This recording was cut short. Here’s everything that was saved.'));
    }
    void audio.play().catch(() => {});
    audio.focus();
  });
  container.append(button);
  return container;
}

function entryBlock(backup: OpenedBackup, entry: Entry, dateLabel: string): HTMLElement {
  const question = entry.question ?? 'Entry';
  let words: HTMLElement;
  if (entry.text) {
    words = h('p', { class: 'words' }, entry.text);
  } else if (entry.textProblem === 'unreadable') {
    words = h('p', { class: 'words missing' }, 'These words couldn’t be read.');
  } else {
    words = h('p', { class: 'words missing' }, 'Not transcribed. Play the recording to hear it.');
  }
  return h(
    'div',
    { class: 'entry' },
    h('p', { class: 'question' }, question),
    words,
    playerFor(backup, entry, `${question} ${dateLabel}`),
  );
}

function aimCard(backup: OpenedBackup, aim: Aim): HTMLElement {
  const details: string[] = [`Set ${longDate(aim.createdAt)}`];
  if (aim.reachedAt) details.push(`you got there ${longDate(aim.reachedAt)}`);
  return h(
    'article',
    { class: aim.closedAt === null ? 'card current' : 'card' },
    entryBlock(backup, aim.entry, longDate(aim.createdAt)),
    h('p', { class: 'meta' }, `${details.join('; ')}.`),
  );
}

function dayCard(backup: OpenedBackup, day: Day): HTMLElement {
  const date = longDate(day.createdAt);
  const outcome = day.checkInQuestion
    ? h(
        'p',
        { class: day.outcome === 'did-it' || day.outcome === 'didnt' ? 'outcome' : 'outcome muted' },
        h('span', { class: 'visually-hidden' }, `${day.checkInQuestion} `),
        outcomeWords(day.outcome),
      )
    : null;
  return h(
    'article',
    { class: 'card', 'aria-label': date },
    h('h3', {}, date),
    day.intention && entryBlock(backup, day.intention, date),
    outcome,
    day.answer && entryBlock(backup, day.answer, date),
  );
}

function problemsNotice(backup: OpenedBackup): HTMLElement | null {
  if (backup.integrity.ok) return null;
  return h(
    'div',
    { class: 'problems', role: 'note' },
    h(
      'p',
      {},
      'Some of this backup didn’t pass its checks. Everything that could be opened is shown below.',
    ),
    h(
      'ul',
      {},
      ...backup.integrity.problems.map((problem) =>
        h('li', {}, `${PROBLEM_TEXT[problem.kind] ?? problem.kind} ${problem.path ?? ''}`.trim()),
      ),
    ),
  );
}

function renderLogbook(backup: OpenedBackup) {
  document.title = 'Your Logbook · YearWeGo Reader';
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const downloadButton = h('button', { type: 'button' }, 'Download everything');
  downloadButton.addEventListener('click', async () => {
    downloadButton.disabled = true;
    status.textContent = 'Putting your recordings and words into one file…';
    await nextPaint();
    try {
      const zip = backup.exportAll();
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
      const stamp = backup.info.createdAt ? localDate(Date.parse(backup.info.createdAt)) : localDate(Date.now());
      const link = h('a', { href: url, download: `yearwego-logbook-${stamp}.zip` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      status.textContent = `Saved yearwego-logbook-${stamp}.zip to your downloads.`;
    } catch {
      status.textContent = 'That file couldn’t be made. Close other tabs and try again.';
    } finally {
      downloadButton.disabled = false;
    }
  });
  const anotherButton = h('button', { type: 'button', class: 'secondary' }, 'Open another backup');
  anotherButton.addEventListener('click', renderStart);

  const made = backup.info.createdAt ? Date.parse(backup.info.createdAt) : Number.NaN;
  const [current, ...earlier] = backup.aims;

  const heading = h('h1', { tabindex: '-1' }, 'Your Logbook');
  const children: (Node | null)[] = [
    heading,
    Number.isNaN(made) ? null : h('p', { class: 'lede' }, `From a backup made ${longDate(made)}.`),
    h(
      'p',
      {},
      'Download everything saves one zip file with every recording as an .aac audio file, every day in words (logbook.md), and the same in JSON (logbook.json).',
    ),
    h('div', { class: 'actions' }, downloadButton, anotherButton),
    status,
    problemsNotice(backup),
    h('h2', {}, 'Where you’re headed'),
    current ? aimCard(backup, current) : h('p', { class: 'meta' }, 'Nothing saved here.'),
    earlier.length > 0 ? h('h3', {}, 'Earlier') : null,
    ...earlier.map((aim) => aimCard(backup, aim)),
    h('h2', {}, 'Days'),
    backup.days.length === 0 ? h('p', { class: 'meta' }, 'No days in this backup.') : null,
    ...backup.days.map((day) => dayCard(backup, day)),
    h('p', { class: 'footer' }, 'Everything here stays on this computer. Close this page when you’re done.'),
  ];
  app.replaceChildren(...children.filter((child): child is Node => child !== null));
  heading.focus();
}

function licensesFooter(): HTMLElement {
  return h(
    'footer',
    { class: 'licenses' },
    h(
      'details',
      {},
      h('summary', {}, 'Licenses'),
      h(
        'p',
        {},
        'YearWeGo Reader and the libraries built into this page, each with its license. sql.js includes SQLite, which is in the public domain.',
      ),
      ...licenses.map((notice) =>
        h(
          'section',
          {},
          h('h3', {}, `${notice.title} ${notice.version}`),
          h('p', { class: 'meta' }, notice.license),
          h('pre', {}, notice.text),
        ),
      ),
    ),
  );
}

app.after(licensesFooter());
renderStart();
