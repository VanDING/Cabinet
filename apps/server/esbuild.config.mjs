import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'bundle/main.cjs',
  external: [
    'better-sqlite3',
    'hnswlib-node',
    'fsevents',
    'playwright',
    'playwright-core',
    'chromium-bidi',
  ],
  sourcemap: false,
  minify: false,
  treeShaking: true,
  logLevel: 'info',
});
