import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { licenseNotices, packageNameOf } from '../scripts/licenses.ts';
import { CONTENT_SECURITY_POLICY } from '../vite.config.ts';

interface LockPackage {
  version: string;
  license?: string;
  dev?: boolean;
}

const notices = licenseNotices();
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, LockPackage> };
const runtimePackages = Object.entries(lock.packages)
  .filter(([path, entry]) => path.startsWith('node_modules/') && !entry.dev)
  .map(([path, entry]) => ({ name: path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length), ...entry }));
const built = readFileSync('dist/yearwego-reader.html', 'utf8');

describe('license notices', () => {
  it('cover the reader and every runtime dependency in the lockfile', () => {
    expect(runtimePackages.length).toBeGreaterThan(0);
    expect(notices[0]).toMatchObject({ title: 'YearWeGo Reader', license: 'MIT' });
    expect(notices[0]!.text).toContain('Copyright (c) 2026 YEARWEGO LLC');
    for (const dependency of runtimePackages) {
      const notice = notices.find((candidate) => candidate.packageName === dependency.name);
      expect(notice, dependency.name).toBeDefined();
      expect(notice).toMatchObject({ version: dependency.version, license: dependency.license });
      expect(notice!.text).toMatch(/copyright/i);
    }
  });

  it('are all in the built page, with the Content-Security-Policy unchanged', () => {
    for (const notice of notices) {
      expect(built, notice.title).toContain(`${notice.title} ${notice.version} (${notice.license})\n\n${notice.text}`);
    }
    expect(built).toContain(`<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`);
  });

  it('name the package a bundled module came from', () => {
    expect(packageNameOf('/repo/node_modules/fflate/esm/browser.js')).toBe('fflate');
    expect(packageNameOf('/repo/node_modules/a/node_modules/@scope/b/index.js')).toBe('@scope/b');
    expect(packageNameOf('C:\\repo\\node_modules\\sql.js\\dist\\sql-wasm.js')).toBe('sql.js');
    expect(packageNameOf('/repo/src/ui/main.ts')).toBeNull();
    expect(packageNameOf('\0virtual:licenses')).toBeNull();
  });
});
