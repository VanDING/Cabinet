import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSrc = join(__dirname, '..', '..', 'server');
const dest = join(__dirname, '..', 'src-tauri', 'resources', 'server-dist');

console.log('Copying server to resources...');
rmSync(dest, { recursive: true, force: true });

// Copy compiled JS files (dist/)
cpSync(join(serverSrc, 'dist'), dest, { recursive: true });
console.log('  dist/ copied');

// Copy node_modules, following all pnpm symlinks to get real files
const srcNm = join(serverSrc, 'node_modules');
const destNm = join(dest, 'node_modules');
if (existsSync(srcNm)) {
  cpSync(srcNm, destNm, { recursive: true, dereference: true });
  console.log('  node_modules/ copied (dereferenced)');
}

console.log('Standalone server ready');
