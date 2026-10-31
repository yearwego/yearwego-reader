import { defineConfig, type Plugin } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { licenseComment, licenseNotices, packageNameOf } from './scripts/licenses.ts';
import { embeddedWasm, findWasmBase64, sqlWasm, wasmComment } from './scripts/wasm.ts';

// connect-src 'none' blocks fetch, XHR, beacons, and sockets. No CSP directive can stop a script
// navigating the tab, so the reader is also written never to navigate (README, How to audit).
// 'wasm-unsafe-eval' lets libsodium and SQLite compile their WebAssembly; nothing needs plain 'unsafe-eval'.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'yearwego-reader-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replace(
          '<meta charset="utf-8" />',
          `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
        ),
    },
  };
}

const SQL_WASM_MODULE = 'virtual:sql-wasm-base64';

/** SQLite’s WebAssembly as a base64 string inside the bundle, so the page never fetches it. */
function inlineSqlWasm(): Plugin {
  const resolvedId = `\0${SQL_WASM_MODULE}`;
  return {
    name: 'yearwego-reader-sql-wasm',
    resolveId: (id) => (id === SQL_WASM_MODULE ? resolvedId : null),
    load: (id) => {
      if (id !== resolvedId) return null;
      return `export default ${JSON.stringify(sqlWasm().bytes.toString('base64'))};`;
    },
  };
}

const LICENSES_MODULE = 'virtual:licenses';

/** Every bundled library's license text, in the page and in a leading comment; fails the build on any gap. */
function licenses(): Plugin {
  const resolvedId = `\0${LICENSES_MODULE}`;
  const notices = licenseNotices();
  const covered = new Set(notices.map((notice) => notice.packageName));
  return {
    name: 'yearwego-reader-licenses',
    resolveId: (id) => (id === LICENSES_MODULE ? resolvedId : null),
    load: (id) => {
      if (id !== resolvedId) return null;
      const texts = notices.map(({ title, version, license, text }) => ({ title, version, license, text }));
      return `export default ${JSON.stringify(texts)};`;
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace('<!doctype html>', `<!doctype html>\n${licenseComment(notices)}`),
    },
    renderChunk(_code, chunk) {
      const missing = new Set(
        chunk.moduleIds.map(packageNameOf).filter((name): name is string => name !== null && !covered.has(name)),
      );
      if (missing.size > 0) {
        this.error(`Bundled without a license notice: ${[...missing].join(', ')}. Add it to dependencies.`);
      }
      return null;
    },
  };
}

/** Lists each embedded WebAssembly module's source and SHA-256 in a leading comment; fails the build if the bundle differs. */
function wasmTable(): Plugin {
  const modules = embeddedWasm();
  return {
    name: 'yearwego-reader-wasm-table',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace('<!doctype html>', `<!doctype html>\n${wasmComment(modules)}`),
    },
    renderChunk(code) {
      const found = findWasmBase64(code).map((blob) => blob.sha256);
      const expected = modules.map((wasm) => wasm.sha256);
      if (found.length !== expected.length || !expected.every((hash) => found.includes(hash))) {
        this.error(`The bundle's WebAssembly (${found.join(', ')}) differs from the table (${expected.join(', ')}).`);
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [
    inlineSqlWasm(),
    licenses(),
    wasmTable(),
    contentSecurityPolicy(),
    viteSingleFile({ removeViteModuleLoader: true }),
  ],
  build: {
    target: 'es2022',
    // Unminified so a person can read the shipped code; the libraries' WebAssembly is checked by hash instead.
    minify: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    chunkSizeWarningLimit: 10_000,
    reportCompressedSize: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
  },
});
