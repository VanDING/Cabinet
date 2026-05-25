import { cpSync, rmSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSrc = join(__dirname, '..', '..', 'server');
const workspaceRoot = join(__dirname, '..', '..', '..');
const pnpmStore = join(workspaceRoot, 'node_modules', '.pnpm');
const dest = join(__dirname, '..', 'src-tauri', 'resources', 'server-dist');

console.log('Copying server to resources...');
try {
  rmSync(dest, { recursive: true, force: true });
} catch {
  // On Windows the directory may be locked; fall back to clearing contents
  try {
    for (const entry of readdirSync(dest)) {
      const full = join(dest, entry);
      try { rmSync(full, { recursive: true, force: true }); } catch { /* ignore locked files */ }
    }
  } catch { /* dest may not exist */ }
}
mkdirSync(dest, { recursive: true });

// 1. Copy the esbuild bundle (CJS format)
const bundlePath = join(serverSrc, 'bundle', 'main.cjs');
if (!existsSync(bundlePath)) {
  console.error('ERROR: bundle/main.cjs not found. Run "pnpm --filter @cabinet/server bundle" first.');
  process.exit(1);
}

// Prepend bundler overrides so pino/thread-stream worker threads find their files
// inside node_modules instead of the flattened __dirname paths.
const bundleContent = readFileSync(bundlePath, 'utf-8');
const banner = `const { join: __join } = require('path'); const __dir = __dirname; globalThis.__bundlerPathsOverrides = { 'pino-worker': __join(__dir, 'node_modules', 'pino', 'lib', 'worker.js'), 'thread-stream-worker': __join(__dir, 'node_modules', 'thread-stream', 'lib', 'worker.js') };\n`;
writeFileSync(join(dest, 'main.cjs'), banner + bundleContent);
console.log('  bundle/main.cjs copied (with bundler overrides)');

// 2. Copy externalised packages and their transitive dependencies.
const serverRequire = createRequire(join(serverSrc, 'package.json'));
const destNm = join(dest, 'node_modules');
mkdirSync(destNm, { recursive: true });

const copied = new Set();

/** Derive the pnpm store directory name from a resolved entry path.
 *  e.g. ".../node_modules/.pnpm/better-sqlite3@11.7.0/node_modules/better-sqlite3/lib/index.js"
 *       → "better-sqlite3@11.7.0"
 *  Returns null for Node.js built-ins (which have no pnpm store entry).
 */
function storeDirFromResolved(entryPath) {
  if (!entryPath.includes('node_modules')) return null; // Node.js built-in
  const parts = entryPath.split(/[/\\]/);
  // Path pattern: .../node_modules/.pnpm/PACKAGE@VERSION/node_modules/PACKAGE/...
  const firstNm = parts.indexOf('node_modules');
  if (firstNm === -1) return null;
  const storeDirStart = firstNm + 2;
  const secondNm = parts.indexOf('node_modules', storeDirStart);
  if (secondNm === -1) return null;
  return parts.slice(storeDirStart, secondNm).join('/');
}

function copyPackage(packageName, resolvedEntry) {
  if (copied.has(packageName)) return;
  copied.add(packageName);

  const storeDir = storeDirFromResolved(resolvedEntry);
  if (!storeDir) {
    console.warn(`  ${packageName}: cannot derive store dir from ${resolvedEntry}`);
    return;
  }

  const pkgRoot = join(pnpmStore, storeDir, 'node_modules', packageName);
  if (!existsSync(pkgRoot)) {
    console.warn(`  ${packageName}: not found at ${pkgRoot}`);
    return;
  }

  const pkgDest = join(destNm, packageName);
  mkdirSync(pkgDest, { recursive: true });

  // package.json
  const pjPath = join(pkgRoot, 'package.json');
  cpSync(pjPath, join(pkgDest, 'package.json'));

  // Copy the entire package except node_modules (pnpm isolates deps in the store)
  for (const f of readdirSync(pkgRoot)) {
    if (f === 'node_modules' || f === 'package.json') continue;
    const srcPath = join(pkgRoot, f);
    const dstPath = join(pkgDest, f);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      cpSync(srcPath, dstPath, { recursive: true, dereference: true });
    } else {
      cpSync(srcPath, dstPath);
    }
  }

  // Recurse into dependencies, resolving from within this package
  let deps;
  try {
    deps = JSON.parse(readFileSync(pjPath, 'utf-8')).dependencies;
  } catch { /* ignore */ }
  if (deps) {
    const pkgRequire = createRequire(join(pkgRoot, 'noop.js'));
    for (const depName of Object.keys(deps)) {
      try {
        const depEntry = pkgRequire.resolve(depName);
        copyPackage(depName, depEntry);
      } catch {
        console.warn(`  ${depName} (dep of ${packageName}) not found, skipping`);
      }
    }
  }

  console.log(`  ${packageName} copied`);
}

// Seed with better-sqlite3 (the sole native module kept external by esbuild)
const bsql3Entry = serverRequire.resolve('better-sqlite3');
copyPackage('better-sqlite3', bsql3Entry);

// Copy pino, thread-stream and their deps (needed by pino worker threads)
const storagePkgPath = join(workspaceRoot, 'packages', 'storage', 'package.json');
const storageRequire = createRequire(storagePkgPath);

try {
  const pinoEntry = storageRequire.resolve('pino');
  copyPackage('pino', pinoEntry);
} catch (e) {
  console.warn('pino not found, skipping copy');
}

try {
  const tsEntry = storageRequire.resolve('thread-stream');
  copyPackage('thread-stream', tsEntry);
} catch (e) {
  console.warn('thread-stream not found, skipping copy');
}

// Copy pino-roll and pino-pretty (dynamically resolved by pino for worker-thread transport)
try {
  const storagePkgPath = join(workspaceRoot, 'packages', 'storage', 'package.json');
  const storageRequire = createRequire(storagePkgPath);
  const pinoRollEntry = storageRequire.resolve('pino-roll');
  copyPackage('pino-roll', pinoRollEntry);
} catch (e) {
  console.warn('pino-roll not found, skipping copy');
}

try {
  const storagePkgPath = join(workspaceRoot, 'packages', 'storage', 'package.json');
  const storageRequire = createRequire(storagePkgPath);
  const pinoPrettyEntry = storageRequire.resolve('pino-pretty');
  copyPackage('pino-pretty', pinoPrettyEntry);
} catch (e) {
  console.warn('pino-pretty not found, skipping copy');
}

// Also copy hnswlib-node (externalized by esbuild since v3.0.0)
try {
  const memoryPkgPath = join(workspaceRoot, 'packages', 'memory', 'package.json');
  const memoryRequire = createRequire(memoryPkgPath);
  const hnswEntry = memoryRequire.resolve('hnswlib-node');
  copyPackage('hnswlib-node', hnswEntry);
} catch (e) {
  console.warn('hnswlib-node not found, skipping native binary copy');
}

// hnswlib-node JS is bundled by esbuild, but bindings() searches from __dirname
// (which is server-dist/ when main.cjs runs). Copy .node to root build/Release.
try {
  const hnswlibBuild = join(dest, 'node_modules', 'hnswlib-node', 'build', 'Release', 'addon.node');
  const rootBuild = join(dest, 'build', 'Release', 'addon.node');
  if (existsSync(hnswlibBuild)) {
    mkdirSync(dirname(rootBuild), { recursive: true });
    cpSync(hnswlibBuild, rootBuild);
    console.log('  hnswlib-node native binary copied to server-dist root');
  }
} catch (e) {
  console.warn('hnswlib-node native binary root copy failed:', e.message);
}

console.log('Standalone server ready');
