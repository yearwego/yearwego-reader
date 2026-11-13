import {
  localDate,
  longDate,
  outcomeWords,
  ReaderError,
  timeOfDay,
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
import { icon, wordmark } from './icons';
import { loadSqlInBrowser } from './sql-browser';
import './styles.css';

const STEPS: { label: string; note: string }[] = [
  { label: 'Reading your backup', note: '' },
  { label: 'Unlocking your backup with your passphrase', note: 'This takes a few seconds.' },
  { label: 'Checking every file in your backup', note: '' },
  { label: 'Opening your Logbook', note: '' },
  { label: 'Unlocking your words and recordings', note: 'This takes a few seconds more.' },
];

const STEP_INDEX: Record<ProgressStep, number> = {
  reading: 0,
  'unlocking-backup': 1,
  checking: 2,
  'opening-database': 3,
  'unlocking-words': 4,
  'reading-words': 4,
  done: STEPS.length,
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

const top = document.getElementById('top')!;
const app = document.getElementById('app')!;
const footer = document.getElementById('footer')!;
const blobUrls: string[] = [];
let opened: OpenedBackup | null = null;
let stopPlayback: (() => void) | null = null;

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
  stopPlayback?.();
  stopPlayback = null;
  for (const url of blobUrls.splice(0)) URL.revokeObjectURL(url);
}

async function readFiles(list: FileList): Promise<ArchiveFile[]> {
  return Promise.all(
    [...list].map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })),
  );
}

function shortDate(ms: number): string {
  const date = new Date(ms);
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString('en-US', options);
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function errorLine(message: string): HTMLElement {
  const line = h('p', { class: 'form-error', role: 'alert' });
  setError(line, message);
  return line;
}

function setError(line: HTMLElement, message: string) {
  line.replaceChildren();
  if (message) line.append(icon('alert'), h('span', {}, message));
}

function renderTop(...right: Node[]) {
  top.replaceChildren(
    h('div', { class: 'brand' }, wordmark(), h('span', { class: 'brand-divider' }), h('span', { class: 'eyebrow' }, 'Reader')),
    ...right,
  );
}

function offlineNote(): HTMLElement {
  return h('p', { class: 'offline-note' }, icon('lock'), h('span', {}, 'Works offline. Nothing leaves this computer.'));
}

const footerText = h('p', {});

/** The page footer: a line about the page, the theme switch, and the licenses. Built once. */
function renderFooter() {
  const choices: { value: 'light' | 'dark' | 'system'; label: string; glyph: 'sun' | 'moon' | 'monitor' }[] = [
    { value: 'light', label: 'Light', glyph: 'sun' },
    { value: 'dark', label: 'Dark', glyph: 'moon' },
    { value: 'system', label: 'System', glyph: 'monitor' },
  ];
  const buttons = choices.map((choice) =>
    h('button', { type: 'button', 'aria-label': choice.label, 'aria-pressed': String(choice.value === 'system') }, icon(choice.glyph)),
  );
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => {
      const value = choices[index]!.value;
      if (value === 'system') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = value;
      buttons.forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
    });
  });

  const body = h(
    'div',
    { class: 'licenses-body', id: 'licenses', hidden: true },
    h(
      'p',
      {},
      'YearWeGo Reader and the libraries, fonts, and icons built into this page, each with its license. sql.js includes SQLite, which is in the public domain.',
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
  );
  const toggle = h(
    'button',
    { type: 'button', class: 'licenses-toggle', 'aria-expanded': 'false', 'aria-controls': 'licenses' },
    'Licenses',
    icon('chevronDown'),
  );
  toggle.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });

  footer.replaceChildren(
    h(
      'div',
      { class: 'footer-row' },
      footerText,
      h(
        'div',
        { class: 'footer-controls' },
        h('div', { class: 'theme-switch', role: 'group', 'aria-label': 'Theme' }, ...buttons),
        toggle,
      ),
    ),
    body,
  );
}

/** A password field with a show or hide button inside it. */
function passphraseField(id: string, labelText: string, hintText: string) {
  const input = h('input', {
    type: 'password',
    id,
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    'aria-describedby': `${id}-hint`,
  });
  const show = h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Show passphrase', 'aria-pressed': 'false' }, icon('eye'));
  show.addEventListener('click', () => {
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    show.setAttribute('aria-pressed', String(visible));
    show.replaceChildren(icon(visible ? 'eyeOff' : 'eye'));
  });
  const field = h(
    'div',
    { class: 'field' },
    h('label', { class: 'field-label', for: id }, labelText),
    h('span', { class: 'hint', id: `${id}-hint` }, hintText),
    h('div', { class: 'input-wrap' }, input, show),
  );
  return { field, input, show };
}

function renderStart() {
  clearBlobUrls();
  opened?.close();
  opened = null;
  document.title = 'YearWeGo Reader';
  renderTop(offlineNote());
  footerText.textContent = 'YearWeGo Reader. It only reads backups and never changes them.';

  const phone = isProbablyPhone();

  // The real file input stays in the page for keyboards and screen readers; the labels open it.
  const fileInput = h('input', {
    type: 'file',
    id: 'backup-file',
    class: 'file-input visually-hidden',
    accept: '.zip,.json,.encrypted',
    multiple: true,
    'aria-describedby': 'backup-file-hint',
  });
  const dropzone = h(
    'div',
    { class: 'dropzone' },
    h('span', { class: 'dropzone-icon' }, icon('upload')),
    h('span', { class: 'dropzone-text' }, 'Drop your backup here, or'),
    h('label', { class: 'button compact outline choose', for: 'backup-file' }, 'Choose file'),
    h('span', { class: 'hint', id: 'backup-file-hint' }, 'It ends in ', h('span', { class: 'mono' }, '.yearwego.backup.zip'), '.'),
  );
  const fileName = h('span', { class: 'file-name' });
  const fileRow = h(
    'div',
    { class: 'file-row', hidden: true },
    icon('archive'),
    fileName,
    h('label', { class: 'text-button change', for: 'backup-file' }, 'Change'),
  );
  const showFiles = () => {
    const files = fileInput.files ? [...fileInput.files] : [];
    fileName.textContent = files.map((file) => file.name).join(', ');
    fileRow.hidden = files.length === 0;
    dropzone.hidden = files.length > 0;
  };
  fileInput.addEventListener('change', showFiles);

  const passphrase = passphraseField(
    'passphrase',
    'Your passphrase',
    'The words you saved when you made the backup, with the dashes between them.',
  );
  const openButton = h('button', { type: 'submit', class: 'button' }, 'Open');
  const error = errorLine('');

  const form = h(
    'form',
    { novalidate: true },
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'backup-file' }, 'Your backup file'), fileInput, dropzone, fileRow),
    passphrase.field,
    h('div', { class: 'field' }, openButton, error),
  );

  const panel = h('div', { class: 'panel' }, form);
  for (const target of [panel]) {
    target.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('dragging');
    });
    target.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
    target.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('dragging');
      if (!event.dataTransfer || event.dataTransfer.files.length === 0 || openButton.disabled) return;
      fileInput.files = event.dataTransfer.files;
      showFiles();
      passphrase.input.focus();
    });
  }

  const eyebrow = h('span', { class: 'eyebrow' }, 'Open a backup');
  const heading = h('h1', { class: 'display' }, 'Open your YearWeGo backup.');
  const lede = h(
    'p',
    { class: 'lede' },
    'See your Logbook, play your recordings, and save everything as ordinary files. This page works offline, and your backup and passphrase stay on this computer.',
  );
  const how = h(
    'ol',
    { class: 'how' },
    ...['Choose your backup file.', 'Type your passphrase.', 'Read, play, or save it all.'].map((text, index) =>
      h('li', {}, h('span', { 'aria-hidden': 'true' }, String(index + 1)), h('span', {}, text)),
    ),
  );
  const computerNote = phone
    ? null
    : h(
        'p',
        { class: 'computer-note' },
        icon('laptop'),
        h('span', {}, 'Use a computer. Your backup and both passphrase steps need more memory than most phones give a web page.'),
      );
  const intro = h('section', { class: 'intro' }, eyebrow, heading, lede, how, computerNote);

  const showOpening = () => {
    eyebrow.textContent = 'Opening';
    heading.textContent = 'Unlocking your backup.';
    lede.textContent = 'This takes a few seconds. Keep this tab open.';
    how.hidden = true;
  };
  const showForm = () => {
    eyebrow.textContent = 'Open a backup';
    heading.textContent = 'Open your YearWeGo backup.';
    lede.textContent =
      'See your Logbook, play your recordings, and save everything as ordinary files. This page works offline, and your backup and passphrase stay on this computer.';
    how.hidden = false;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError(error, '');
    passphrase.input.removeAttribute('aria-invalid');
    if (!fileInput.files || fileInput.files.length === 0) {
      setError(error, 'Choose your backup file first.');
      fileInput.focus();
      return;
    }
    if (!passphrase.input.value) {
      setError(error, 'Enter your passphrase.');
      passphrase.input.focus();
      return;
    }

    const progress = openingView(fileName.textContent ?? '');
    form.hidden = true;
    panel.append(progress.view);
    showOpening();

    try {
      const files = await readFiles(fileInput.files);
      const archive = await unsealArchive(files, passphrase.input.value, progress.onProgress);
      await unlockAndShow(archive, undefined, progress, panel);
    } catch (caught) {
      progress.view.remove();
      form.hidden = false;
      showForm();
      setError(error, messageFor(caught));
      if (caught instanceof ReaderError && caught.code === 'wrong-passphrase') {
        passphrase.input.setAttribute('aria-invalid', 'true');
        passphrase.input.focus();
      }
    }
  });

  const children: (Node | null)[] = [
    phone
      ? h(
          'div',
          { class: 'phone-note', role: 'alert' },
          icon('laptop'),
          h(
            'p',
            {},
            h('strong', {}, 'Use a computer.'),
            h('span', {}, 'Your backup and both passphrase steps need more memory than most phones give a web page.'),
          ),
        )
      : null,
    h('div', { class: 'start' }, intro, panel),
  ];
  app.replaceChildren(...children.filter((child): child is Node => child !== null));
}

type Progress = { view: HTMLElement; onProgress: (step: ProgressStep) => Promise<void> };

/** The file, the steps of opening it with the current one marked, and the disabled button. */
function openingView(names: string): Progress {
  const items = STEPS.map((step, index) => {
    const mark = h('span', { class: 'progress-mark' }, h('span', { 'aria-hidden': 'true' }, String(index + 1)));
    const note = h('span', { class: 'progress-note', hidden: true }, step.note);
    const item = h('li', {}, mark, h('span', { class: 'progress-text' }, h('span', {}, step.label), note));
    return { item, mark, note, step, index };
  });
  const announcer = h('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  const view = h(
    'div',
    { class: 'panel-steps' },
    h('div', { class: 'file-row locked' }, icon('archive'), h('span', { class: 'file-name' }, names)),
    h('ol', { class: 'progress' }, ...items.map(({ item }) => item)),
    announcer,
    h('button', { type: 'button', class: 'button', disabled: true }, 'Opening…'),
  );
  const onProgress = async (step: ProgressStep) => {
    const at = STEP_INDEX[step];
    for (const { item, mark, note, index } of items) {
      item.classList.toggle('done', index < at);
      item.classList.toggle('current', index === at);
      note.hidden = index !== at || !note.textContent;
      if (index < at) mark.replaceChildren(icon('check'));
      else if (index === at) mark.replaceChildren(icon('spinner'));
      else mark.replaceChildren(h('span', { 'aria-hidden': 'true' }, String(index + 1)));
    }
    const current = STEPS[at];
    if (current) announcer.textContent = `${current.label}…`;
    await nextPaint();
  };
  return { view, onProgress };
}

async function unlockAndShow(
  archive: UnsealedArchive,
  earlierPassphrase: string | undefined,
  progress: Progress,
  panel: HTMLElement,
) {
  try {
    opened = await unlockBackup(archive, {
      loadSql: loadSqlInBrowser,
      passphrase: earlierPassphrase,
      onProgress: progress.onProgress,
    });
    renderLogbook(opened);
  } catch (caught) {
    if (caught instanceof ReaderError && caught.code === 'earlier-passphrase-needed') {
      askForEarlierPassphrase(archive, progress, panel, Boolean(earlierPassphrase));
      return;
    }
    throw caught;
  }
}

function askForEarlierPassphrase(archive: UnsealedArchive, progress: Progress, panel: HTMLElement, triedOnce: boolean) {
  const passphrase = passphraseField(
    'earlier-passphrase',
    'Your earlier passphrase',
    new ReaderError('earlier-passphrase-needed').message,
  );
  const button = h('button', { type: 'submit', class: 'button' }, 'Unlock');
  const error = errorLine(triedOnce ? 'That earlier passphrase didn’t unlock your words either. Try another.' : '');
  const form = h('form', { novalidate: true }, passphrase.field, h('div', { class: 'field' }, button, error));
  progress.view.hidden = true;
  panel.append(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!passphrase.input.value) {
      setError(error, 'Enter your earlier passphrase.');
      passphrase.input.focus();
      return;
    }
    const value = passphrase.input.value;
    form.remove();
    progress.view.hidden = false;
    try {
      await unlockAndShow(archive, value, progress, panel);
    } catch (caught) {
      progress.view.hidden = true;
      panel.append(form);
      setError(error, messageFor(caught));
      passphrase.input.focus();
    }
  });
  passphrase.input.focus();
}

/** A play button with the recording's length; it decrypts and opens a player only when pressed. */
function playerFor(backup: OpenedBackup, entry: Entry, label: string): HTMLElement | null {
  if (!entry.audioPath) return null;
  const container = h('div', {});
  if (!entry.audioInBackup) {
    container.append(h('p', { class: 'meta' }, 'This recording isn’t in the backup.'));
    return container;
  }
  const length = entry.durationMs ? clock(entry.durationMs / 1000) : '';

  const showChip = () => {
    const button = h(
      'button',
      { type: 'button', 'aria-label': length ? `Play ${label}, ${length}` : `Play ${label}` },
      h('span', { class: 'play-chip-circle' }, icon('play')),
    );
    button.addEventListener('click', () => openPlayer());
    container.replaceChildren(h('div', { class: 'play-chip' }, button, length ? h('span', { class: 'duration' }, length) : null));
    return button;
  };

  const openPlayer = () => {
    const result = backup.decryptAudio(entry);
    if (!result.ok) {
      container.replaceChildren(h('p', { class: 'meta' }, 'This recording is damaged and can’t be played.'));
      return;
    }
    stopPlayback?.();
    const url = URL.createObjectURL(new Blob([result.audio.bytes as BlobPart], { type: result.audio.mimeType }));
    blobUrls.push(url);
    const audio = h('audio', { src: url, preload: 'auto' });
    const toggle = h('button', { type: 'button', class: 'player-toggle', 'aria-label': `Pause ${label}` }, icon('pause'));
    const scrubber = h('input', {
      type: 'range',
      class: 'scrubber',
      min: '0',
      max: entry.durationMs ? String(entry.durationMs / 1000) : '0',
      step: '0.1',
      value: '0',
      'aria-label': `Position in ${label}`,
    });
    const time = h('span', { class: 'player-time' }, `0:00 / ${length || '0:00'}`);
    const close = h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close the player' }, icon('close'));

    const total = () => (Number.isFinite(audio.duration) ? audio.duration : (entry.durationMs ?? 0) / 1000);
    const paint = () => {
      const end = total();
      scrubber.max = String(end);
      scrubber.value = String(audio.currentTime);
      scrubber.style.setProperty('--progress', end > 0 ? `${(audio.currentTime / end) * 100}%` : '0%');
      time.textContent = `${clock(audio.currentTime)} / ${clock(end)}`;
    };
    const showPlaying = (playing: boolean) => {
      toggle.replaceChildren(icon(playing ? 'pause' : 'play'));
      toggle.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${label}`);
    };

    audio.addEventListener('timeupdate', paint);
    audio.addEventListener('loadedmetadata', paint);
    audio.addEventListener('play', () => showPlaying(true));
    audio.addEventListener('pause', () => showPlaying(false));
    audio.addEventListener('ended', () => showPlaying(false));
    toggle.addEventListener('click', () => {
      if (audio.paused) void audio.play().catch(() => {});
      else audio.pause();
    });
    scrubber.addEventListener('input', () => {
      audio.currentTime = Number(scrubber.value);
      paint();
    });

    const stop = () => {
      audio.pause();
      if (stopPlayback === stop) stopPlayback = null;
    };
    close.addEventListener('click', () => {
      stop();
      showChip().focus();
    });
    stopPlayback = stop;

    container.replaceChildren(h('div', { class: 'player' }, toggle, scrubber, time, close), audio);
    if (!result.audio.complete) {
      container.append(h('p', { class: 'meta' }, 'This recording was cut short. Here’s everything that was saved.'));
    }
    void audio.play().catch(() => showPlaying(false));
    toggle.focus();
  };

  showChip();
  return container;
}

function wordsFor(entry: Entry, className = 'words'): HTMLElement {
  if (entry.text) return h('p', { class: className }, entry.text);
  if (entry.textProblem === 'unreadable') return h('p', { class: 'missing' }, 'These words couldn’t be read.');
  return h('p', { class: 'missing' }, 'Not transcribed. Play the recording to hear it.');
}

function currentAimCard(backup: OpenedBackup, aim: Aim | undefined): HTMLElement {
  const label = h('h2', { class: 'aim-label', id: 'aim-label' }, icon('navigation'), 'Where you’re headed');
  if (!aim) {
    return h('article', { class: 'aim-card', 'aria-labelledby': 'aim-label' }, label, h('p', { class: 'missing' }, 'Nothing saved here.'));
  }
  return h(
    'article',
    { class: 'aim-card', 'aria-labelledby': 'aim-label' },
    label,
    wordsFor(aim.entry),
    playerFor(backup, aim.entry, `where you’re headed, set ${longDate(aim.createdAt)}`),
  );
}

function earlierAimCard(backup: OpenedBackup, aim: Aim): HTMLElement {
  return h(
    'article',
    { class: 'entry-card' },
    h('p', { class: 'caption' }, `Where you were headed · ${shortDate(aim.createdAt)}`),
    wordsFor(aim.entry),
    playerFor(backup, aim.entry, `where you were headed, set ${longDate(aim.createdAt)}`),
    aim.reachedAt ? h('p', { class: 'reached' }, `Reached ${shortDate(aim.reachedAt)}`) : null,
  );
}

function followUpCaption(entry: Entry): string {
  if (entry.recordingType === 'celebration') return 'What you’re proud of';
  if (entry.recordingType === 'fail_reason') return 'What got in the way';
  return (entry.question ?? 'Answer').replace(/\?$/, '');
}

function railRow(node: HTMLElement, card: HTMLElement, links: { prev: boolean; next: boolean }): HTMLElement {
  const rail = h('div', { class: 'rail', 'aria-hidden': 'true' }, node);
  rail.classList.toggle('has-prev', links.prev);
  rail.classList.toggle('has-next', links.next);
  const row = h('div', { class: 'rail-row' }, rail, card);
  row.classList.toggle('has-next', links.next);
  return row;
}

function dayCard(backup: OpenedBackup, day: Day): HTMLElement {
  const date = longDate(day.createdAt);
  const answered = day.outcome === 'did-it' || day.outcome === 'didnt';
  const rows: HTMLElement[] = [];

  if (day.intention) {
    const openLine = answered ? null : h('p', { class: 'open-line' }, outcomeWords(day.outcome));
    rows.push(
      railRow(
        h('span', { class: 'node-ring' }),
        h(
          'div',
          { class: 'entry-card' },
          h('p', { class: 'caption' }, `Intention · ${timeOfDay(day.intention.createdAt)}`),
          wordsFor(day.intention),
          playerFor(backup, day.intention, `intention, ${date}`),
          openLine,
        ),
        { prev: false, next: answered },
      ),
    );
  }

  if (answered) {
    const outcome = h('span', { class: 'visually-hidden' }, `${day.checkInQuestion ?? 'Did you do it?'} ${outcomeWords(day.outcome)}. `);
    const caption = day.answer
      ? h('p', { class: 'caption' }, outcome, `${followUpCaption(day.answer)} · ${timeOfDay(day.answer.createdAt)}`)
      : h('p', { class: 'caption' }, outcome, outcomeWords(day.outcome));
    rows.push(
      railRow(
        h('span', { class: 'node-glyph' }, icon(day.outcome === 'did-it' ? 'check' : 'sprout')),
        h(
          'div',
          { class: 'entry-card' },
          caption,
          day.answer ? wordsFor(day.answer) : null,
          day.answer ? playerFor(backup, day.answer, `answer, ${date}`) : null,
        ),
        { prev: day.intention !== null, next: false },
      ),
    );
  }

  return h('article', { class: 'day', 'aria-label': date }, h('h3', { class: 'day-label' }, date), h('div', {}, ...rows));
}

function problemsNotice(backup: OpenedBackup): HTMLElement | null {
  if (backup.integrity.ok) return null;
  return h(
    'div',
    { class: 'problems', role: 'note' },
    icon('warning'),
    h(
      'div',
      {},
      h('p', {}, 'Some of this backup didn’t pass its checks. Everything that could be opened is shown below.'),
      h(
        'ul',
        {},
        ...backup.integrity.problems.map((problem) =>
          h('li', {}, `${PROBLEM_TEXT[problem.kind] ?? problem.kind} ${problem.path ?? ''}`.trim()),
        ),
      ),
    ),
  );
}

function renderLogbook(backup: OpenedBackup) {
  document.title = 'Your Logbook · YearWeGo Reader';
  footerText.textContent = 'Everything here stays on this computer. Close this page when you’re done.';
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });

  const downloadButton = h('button', { type: 'button', class: 'button compact' }, icon('download'), 'Download everything');
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
  const anotherButton = h('button', { type: 'button', class: 'button compact outline' }, 'Open another backup');
  anotherButton.addEventListener('click', renderStart);
  renderTop(h('div', { class: 'topbar-actions' }, anotherButton, downloadButton));

  const made = backup.info.createdAt ? Date.parse(backup.info.createdAt) : Number.NaN;
  const [current, ...earlier] = backup.aims;
  const heading = h('h1', { class: 'display', tabindex: '-1' }, 'Your Logbook');

  const head = h(
    'section',
    { class: 'logbook-head' },
    Number.isNaN(made) ? null : h('p', { class: 'eyebrow' }, `Backup made ${longDate(made)}`),
    heading,
    h(
      'p',
      { class: 'lede' },
      'Download everything saves one zip file with every recording as an .aac audio file, every day in words (logbook.md), and the same in JSON (logbook.json).',
    ),
    status,
    problemsNotice(backup),
  );

  const aims = h(
    'aside',
    { class: 'aims' },
    currentAimCard(backup, current),
    earlier.length > 0 ? h('h2', { class: 'earlier-label' }, 'Earlier') : null,
    ...earlier.map((aim) => earlierAimCard(backup, aim)),
  );
  const days = h(
    'section',
    { 'aria-labelledby': 'days-title' },
    h('h2', { class: 'section-title', id: 'days-title' }, 'Days'),
    backup.days.length === 0 ? h('p', { class: 'meta' }, 'No days in this backup.') : null,
    ...backup.days.map((day) => dayCard(backup, day)),
  );

  app.replaceChildren(head, h('div', { class: 'columns' }, aims, days));
  heading.focus();
}

renderFooter();
renderStart();
