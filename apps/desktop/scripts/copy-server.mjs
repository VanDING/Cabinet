import { cpSync, rmSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSrc = join(__dirname, '..', '..', 'server');
const workspaceRoot = join(__dirname, '..', '..', '..');
const pnpmStore = join(workspaceRoot, 'node_modules', '.pnpm');
const dest = join(__dirname, '..', 'src-tauri', 'resources', 'server-dist');

console.log('Copying server to resources...');
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

// 1. Copy the esbuild bundle (CJS format)
const bundlePath = join(serverSrc, 'bundle', 'main.cjs');
if (!existsSync(bundlePath)) {
  console.error('ERROR: bundle/main.cjs not found. Run "pnpm --filter @cabinet/server bundle" first.');
  process.exit(1);
}
cpSync(bundlePath, join(dest, 'main.cjs'));
console.log('  bundle/main.cjs copied');

// 2. Copy externalised packages and their transitive dependencies.
const serverRequire = createRequire(join(serverSrc, 'package.json'));
const destNm = join(dest, 'node_modules');
mkdirSync(destNm, { recursive: true });

const copied = new Set();

/** Derive the pnpm store directory name from a resolved entry path.
 *  e.g. ".../node_modules/.pnpm/better-sqlite3@11.7.0/node_modules/better-sqlite3/lib/index.js"
 *       → "better-sqlite3@11.7.0"
 */
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

  // Copy common subdirectories (only those that exist)
  for (const sub of ['lib', 'dist', 'build', 'src']) {
    const s = join(pkgRoot, sub);
    if (existsSync(s)) {
      cpSync(s, join(pkgDest, sub), { recursive: true, dereference: true });
    }
  }

  // Copy root-level JS/MJS/CJS files
  for (const f of readdirSync(pkgRoot)) {
    if (/\.(m?js|cjs)$/.test(f)) {
      cpSync(join(pkgRoot, f), join(pkgDest, f));
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

console.log('Standalone server ready');
