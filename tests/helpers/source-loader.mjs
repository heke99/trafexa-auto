import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const packageRequire = createRequire(new URL('../../package.json', import.meta.url));
const swc = packageRequire('next/dist/build/swc');

/** Evaluate actual TS/TSX modules in a private module graph; mocks never affect other tests. */
export async function createSourceLoader(stubs = {}) {
  await swc.loadBindings();
  const modules = new Map();
  const overrides = { 'server-only': {}, ...stubs };
  function sourcePath(request, parent = root) {
    const base = request.startsWith('@/') ? resolve(root, 'src', request.slice(2)) : resolve(parent, request);
    const candidates = extname(base) ? [base] : ['.ts', '.tsx', '.mjs', '.js'].map((extension) => base + extension);
    const filename = candidates.find(existsSync);
    if (!filename) throw new Error(`Source module not found: ${request}`);
    return filename;
  }
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const compiled = swc.transformSync(readFileSync(filename, 'utf8'), {
      filename,
      jsc: { parser: { syntax: 'typescript', tsx: filename.endsWith('.tsx') }, transform: { react: { runtime: 'automatic' } } },
      module: { type: 'commonjs' },
    });
    const localRequire = (request) => {
      if (Object.hasOwn(overrides, request)) return overrides[request];
      if (request.startsWith('@/') || request.startsWith('.')) return load(sourcePath(request, dirname(filename)));
      return packageRequire(request);
    };
    new Function('require', 'exports', 'module', '__filename', '__dirname', compiled.code)(localRequire, module.exports, module, filename, dirname(filename));
    return module.exports;
  }
  return { load: (request) => load(sourcePath(request)) };
}

/** Use React's real server cache in a private React instance with request-local dispatcher state. */
export function createRequestReact(requestStorage) {
  const reactDirectory = dirname(packageRequire.resolve('react/package.json'));
  const filename = resolve(reactDirectory, 'cjs/react.react-server.production.js');
  const module = { exports: {} };
  new Function('require', 'exports', 'module', readFileSync(filename, 'utf8'))(packageRequire, module.exports, module);
  const react = module.exports;
  const internals = react.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  Object.defineProperty(internals, 'A', {
    get() {
      const request = requestStorage.getStore();
      if (!request) return null;
      return { getCacheForType(factory) {
        if (!request.reactCache.has(factory)) request.reactCache.set(factory, factory());
        return request.reactCache.get(factory);
      } };
    },
  });
  return { ...packageRequire('react'), cache: react.cache };
}
