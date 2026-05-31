#!/usr/bin/env node
/**
 * Enlarge the Cabinet icon content by 2.5x and regenerate all platform icons.
 *
 * Usage:
 *   node scripts/enlarge-icon.mjs
 *
 * Requires: sharp (will auto-install via npx if missing)
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, '..', 'src-tauri', 'icons');
const SOURCE_PNG = join(ICONS_DIR, 'icon.png');

// ── Ensure sharp is available ───────────────────────────────────
let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.log('sharp not found, installing in temp directory...');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const tmpDir = mkdtempSync(join(tmpdir(), 'cabinet-icon-'));
  writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'tmp', version: '1.0.0' }));
  execSync('npm install sharp@0.33', { stdio: 'inherit', cwd: tmpDir });
  const sharpPath = pathToFileURL(join(tmpDir, 'node_modules', 'sharp', 'lib', 'index.js')).href;
  const sharpModule = await import(sharpPath);
  sharp = sharpModule.default ?? sharpModule;
}

// ── Step 1: analyze source icon to find content bounds ──────────
async function findContentBounds(path) {
  const { data, info } = await sharp(path)
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let found = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      // Treat near-black or transparent as background
      if (a > 10 && (r > 20 || g > 20 || b > 20)) {
        found = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!found) throw new Error('No non-black content found in icon.png');

  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// ── Step 2: create enlarged source (512x512) ────────────────────
async function createEnlargedSource() {
  console.log('Analyzing current icon.png...');
  const bounds = await findContentBounds(SOURCE_PNG);
  console.log(`Content bounds: x=${bounds.minX}, y=${bounds.minY}, w=${bounds.width}, h=${bounds.height}`);

  const CANVAS = 512;
  // Target 80% fill in the limiting dimension so content is prominent but doesn't overflow
  const SCALE = Math.min(
    (CANVAS * 0.8) / bounds.width,
    (CANVAS * 0.8) / bounds.height,
  );

  // Crop to content, resize with nearest neighbor (keep crisp edges), center on black canvas
  const cropped = sharp(SOURCE_PNG).extract({
    left: bounds.minX,
    top: bounds.minY,
    width: bounds.width,
    height: bounds.height,
  });

  const resized = await cropped
    .resize({
      width: Math.round(bounds.width * SCALE),
      height: Math.round(bounds.height * SCALE),
      kernel: sharp.kernel.nearest,
    })
    .toBuffer();

  const resizedMeta = await sharp(resized).metadata();

  await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite([{
      input: resized,
      left: Math.round((CANVAS - resizedMeta.width) / 2),
      top: Math.round((CANVAS - resizedMeta.height) / 2),
    }])
    .png()
    .toFile(SOURCE_PNG);

  console.log(`Enlarged icon saved to ${SOURCE_PNG} (content scaled ${SCALE}x)`);
  return { width: resizedMeta.width, height: resizedMeta.height };
}

// ── Step 3: generate all required PNG sizes ─────────────────────
async function generatePngs() {
  const sizes = [
    { file: '32x32.png', size: 32 },
    { file: '64x64.png', size: 64 },
    { file: '128x128.png', size: 128 },
    { file: '128x128@2x.png', size: 256 },
  ];

  for (const { file, size } of sizes) {
    const out = join(ICONS_DIR, file);
    await sharp(SOURCE_PNG)
      .resize(size, size, { kernel: sharp.kernel.lanczos3 })
      .png()
      .toFile(out);
    console.log(`  ${file}`);
  }
}

// ── Step 4: generate Windows tile logos ─────────────────────────
async function generateWindowsLogos() {
  const logos = [
    { file: 'Square30x30Logo.png', size: 30 },
    { file: 'Square44x44Logo.png', size: 44 },
    { file: 'Square71x71Logo.png', size: 71 },
    { file: 'Square89x89Logo.png', size: 89 },
    { file: 'Square107x107Logo.png', size: 107 },
    { file: 'Square142x142Logo.png', size: 142 },
    { file: 'Square150x150Logo.png', size: 150 },
    { file: 'Square284x284Logo.png', size: 284 },
    { file: 'Square310x310Logo.png', size: 310 },
    { file: 'StoreLogo.png', size: 50 },
  ];

  for (const { file, size } of logos) {
    const out = join(ICONS_DIR, file);
    await sharp(SOURCE_PNG)
      .resize(size, size, { kernel: sharp.kernel.lanczos3 })
      .png()
      .toFile(out);
    console.log(`  ${file}`);
  }
}

// ── Step 5: generate iOS icons ──────────────────────────────────
async function generateIosIcons() {
  const iosDir = join(ICONS_DIR, 'ios');
  const icons = [
    { file: 'AppIcon-20x20@1x.png', size: 20 },
    { file: 'AppIcon-20x20@2x.png', size: 40 },
    { file: 'AppIcon-20x20@2x-1.png', size: 40 },
    { file: 'AppIcon-20x20@3x.png', size: 60 },
    { file: 'AppIcon-29x29@1x.png', size: 29 },
    { file: 'AppIcon-29x29@2x.png', size: 58 },
    { file: 'AppIcon-29x29@2x-1.png', size: 58 },
    { file: 'AppIcon-29x29@3x.png', size: 87 },
    { file: 'AppIcon-40x40@1x.png', size: 40 },
    { file: 'AppIcon-40x40@2x.png', size: 80 },
    { file: 'AppIcon-40x40@2x-1.png', size: 80 },
    { file: 'AppIcon-40x40@3x.png', size: 120 },
    { file: 'AppIcon-60x60@2x.png', size: 120 },
    { file: 'AppIcon-60x60@3x.png', size: 180 },
    { file: 'AppIcon-76x76@1x.png', size: 76 },
    { file: 'AppIcon-76x76@2x.png', size: 152 },
    { file: 'AppIcon-83.5x83.5@2x.png', size: 167 },
    { file: 'AppIcon-512@2x.png', size: 1024 },
  ];

  for (const { file, size } of icons) {
    const out = join(iosDir, file);
    await sharp(SOURCE_PNG)
      .resize(size, size, { kernel: sharp.kernel.lanczos3 })
      .png()
      .toFile(out);
    console.log(`  ios/${file}`);
  }
}

// ── Step 6: generate Android icons ──────────────────────────────
async function generateAndroidIcons() {
  const androidDir = join(ICONS_DIR, 'android');
  const icons = [
    { dir: 'mipmap-mdpi', size: 48 },
    { dir: 'mipmap-hdpi', size: 72 },
    { dir: 'mipmap-xhdpi', size: 96 },
    { dir: 'mipmap-xxhdpi', size: 144 },
    { dir: 'mipmap-xxxhdpi', size: 192 },
  ];

  for (const { dir, size } of icons) {
    const baseDir = join(androidDir, dir);
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      const out = join(baseDir, name);
      await sharp(SOURCE_PNG)
        .resize(size, size, { kernel: sharp.kernel.lanczos3 })
        .png()
        .toFile(out);
      console.log(`  android/${dir}/${name}`);
    }
  }
}

// ── Step 7: generate ICO (multi-resolution) ─────────────────────
async function generateIco() {
  // sharp can't write ICO directly, but we can use a small npm package
  let toIcoModule;
  try {
    toIcoModule = await import('to-ico');
  } catch {
    console.log('to-ico not found, installing...');
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const tmpDir = mkdtempSync(join(tmpdir(), 'cabinet-icon-'));
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'tmp', version: '1.0.0' }));
    execSync('npm install to-ico@1', { stdio: 'inherit', cwd: tmpDir });
    toIcoModule = await import(pathToFileURL(join(tmpDir, 'node_modules', 'to-ico', 'index.js')).href);
  }
  const toIco = toIcoModule.default ?? toIcoModule;

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const buffers = await Promise.all(
    sizes.map((s) =>
      sharp(SOURCE_PNG)
        .resize(s, s, { kernel: sharp.kernel.lanczos3 })
        .png()
        .toBuffer(),
    ),
  );

  const icoBuffer = await toIco(buffers);
  const out = join(ICONS_DIR, 'icon.ico');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(out, icoBuffer);
  console.log(`  icon.ico (${sizes.join(', ')}px)`);
}

// ── Step 8: generate ICNS (macOS) ───────────────────────────────
async function generateIcns() {
  // ICNS is a proprietary Apple format; we need png2icons or the tauri icon CLI.
  // Try png2icons first, otherwise warn the user.
  try {
    execSync('npx png2icons --version', { stdio: 'ignore' });
  } catch {
    console.log('  icon.icns — png2icons not available, installing...');
    try {
      const { mkdtempSync, writeFileSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const tmpDir = mkdtempSync(join(tmpdir(), 'cabinet-icon-'));
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'tmp', version: '1.0.0' }));
      execSync('npm install png2icons@2', { stdio: 'inherit', cwd: tmpDir });
    } catch {
      console.warn('  Could not install png2icons. Please run:');
      console.warn('    cd apps/desktop && pnpm tauri icon src-tauri/icons/icon.png');
      return;
    }
  }

  try {
    execSync(
      `npx png2icons "${SOURCE_PNG}" "${join(ICONS_DIR, 'icon')}" -icns`,
      { stdio: 'inherit' },
    );
    console.log('  icon.icns');
  } catch (e) {
    console.warn('  ICNS generation failed:', e.message);
    console.warn('  Fallback: cd apps/desktop && pnpm tauri icon src-tauri/icons/icon.png');
  }
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(SOURCE_PNG)) {
    console.error(`Source icon not found: ${SOURCE_PNG}`);
    process.exit(1);
  }

  console.log('=== Cabinet Icon Enlarger ===\n');

  await createEnlargedSource();

  console.log('\nRegenerating PNG sizes...');
  await generatePngs();

  console.log('\nRegenerating Windows tile logos...');
  await generateWindowsLogos();

  console.log('\nRegenerating iOS icons...');
  await generateIosIcons();

  console.log('\nRegenerating Android icons...');
  await generateAndroidIcons();

  console.log('\nRegenerating ICO...');
  try {
    await generateIco();
  } catch (e) {
    console.warn('  ICO generation failed:', e.message);
  }

  console.log('\nRegenerating ICNS...');
  try {
    await generateIcns();
  } catch (e) {
    console.warn('  ICNS generation failed:', e.message);
  }

  console.log('\n✅ Done!');
  console.log('\nTip: For best ICNS quality, run:');
  console.log('  cd apps/desktop && pnpm tauri icon src-tauri/icons/icon.png');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
