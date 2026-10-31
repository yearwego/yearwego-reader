import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LicenseNotice {
  /** The npm package name, or the reader's own package name. */
  packageName: string;
  title: string;
  version: string;
  license: string;
  text: string;
}

interface PackageJson {
  name: string;
  version: string;
  license?: string;
  dependencies?: Record<string, string>;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOTICE_FILES: [RegExp, number][] = [
  [/^(licen[cs]e|copying)(\.(md|txt))?$/i, 0],
  [/^notice(\.(md|txt))?$/i, 1],
  [/^authors(\.(md|txt))?$/i, 2],
];

function readPackageJson(directory: string): PackageJson {
  return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as PackageJson;
}

function noticeRank(file: string): number | undefined {
  return NOTICE_FILES.find(([pattern]) => pattern.test(file))?.[1];
}

/** The package's own LICENSE file, plus any NOTICE or AUTHORS file the license points to. */
function noticeText(directory: string, name: string): string {
  const files = readdirSync(directory)
    .filter((file) => noticeRank(file) !== undefined)
    .sort((a, b) => noticeRank(a)! - noticeRank(b)! || a.localeCompare(b));
  if (!files.some((file) => noticeRank(file) === 0)) {
    throw new Error(`${name} has no LICENSE file in ${directory}, so its notice can't be bundled.`);
  }
  return files.map((file) => readFileSync(join(directory, file), 'utf8').trim()).join('\n\n');
}

export function packageDirectory(name: string, from: string = ROOT): string {
  for (let directory = from; ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (directory === ROOT || directory === dirname(directory)) break;
  }
  throw new Error(`${name} is a runtime dependency but isn't installed. Run npm ci.`);
}

/** The reader's license and those of every runtime dependency, read from the installed files. */
export function licenseNotices(): LicenseNotice[] {
  const reader = readPackageJson(ROOT);
  const dependencies = new Map<string, LicenseNotice>();
  const queue = Object.keys(reader.dependencies ?? {}).map((name) => ({ name, from: ROOT }));
  for (let next = queue.shift(); next; next = queue.shift()) {
    if (dependencies.has(next.name)) continue;
    const directory = packageDirectory(next.name, next.from);
    const manifest = readPackageJson(directory);
    dependencies.set(next.name, {
      packageName: manifest.name,
      title: manifest.name,
      version: manifest.version,
      license: manifest.license ?? 'see license text',
      text: noticeText(directory, manifest.name),
    });
    queue.push(...Object.keys(manifest.dependencies ?? {}).map((name) => ({ name, from: directory })));
  }

  return [
    {
      packageName: reader.name,
      title: 'YearWeGo Reader',
      version: reader.version,
      license: reader.license ?? 'see license text',
      text: noticeText(ROOT, reader.name),
    },
    ...[...dependencies.values()].sort((a, b) => a.packageName.localeCompare(b.packageName)),
  ];
}

/** The npm package a bundled module came from, or null for the reader's own and virtual modules. */
export function packageNameOf(moduleId: string): string | null {
  const path = moduleId.replace(/\\/g, '/');
  const marker = '/node_modules/';
  const index = path.lastIndexOf(marker);
  if (index === -1) return null;
  const segments = path.slice(index + marker.length).split('/');
  const scoped = segments[0]?.startsWith('@');
  return (scoped ? segments.slice(0, 2) : segments.slice(0, 1)).join('/');
}

/** An HTML comment carrying every notice, for anyone reading the page's source. */
export function licenseComment(notices: LicenseNotice[]): string {
  const blocks = notices.map((notice) => {
    if (/<!--|-->|--!>/.test(notice.text)) {
      throw new Error(`${notice.title}'s license text can't sit inside an HTML comment.`);
    }
    return `${notice.title} ${notice.version} (${notice.license})\n\n${notice.text}`;
  });
  const intro =
    'Licenses: YearWeGo Reader and every library bundled into this file. The same texts are under Licenses at the foot of the page.';
  return `<!--\n${intro}\n\n${blocks.join('\n\n========================================\n\n')}\n-->`;
}
