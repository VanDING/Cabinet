import { readFileSync, writeFileSync } from 'fs';

// Get list of files with .catch(() => { patterns
const files = readFileSync('scripts/empty-catch-files.txt', 'utf-8')
  .trim()
  .split('\n')
  .filter(Boolean);

let totalReplacements = 0;

for (const file of files) {
  let content = readFileSync(file, 'utf-8');
  const original = content;

  // Pattern 1: Single-line empty .catch(() => {})
  content = content.replace(
    /\.catch\(\(\)\s*=>\s*\{\s*\}\)/g,
    ".catch((err) => { console.warn('Operation failed', err); })",
  );

  // Pattern 2: Single-line with inline comment .catch(() => { /* ... */ })
  content = content.replace(
    /\.catch\(\(\)\s*=>\s*\{\s*\/\*[\s\S]*?\*\/\s*\}\)/g,
    ".catch((err) => { console.warn('Operation failed', err); })",
  );

  // Pattern 3: Multi-line empty bodies - find .catch(() => { ... })
  // We scan for the pattern and check if body is only whitespace/comments
  let idx = 0;
  while (true) {
    const matchStart = content.indexOf('.catch(() => {', idx);
    if (matchStart === -1) break;

    const bodyStart = matchStart + '.catch(() => {'.length;
    let depth = 1;
    let pos = bodyStart;
    let foundNonComment = false;

    while (pos < content.length && depth > 0) {
      const ch = content[pos];
      if (ch === '{') {
        depth++;
        pos++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) break;
        pos++;
      } else if (ch === '/' && content[pos + 1] === '*') {
        // Skip block comment
        pos += 2;
        while (pos < content.length && !(content[pos] === '*' && content[pos + 1] === '/')) {
          pos++;
        }
        pos += 2;
      } else if (ch === '/' && content[pos + 1] === '/') {
        // Skip line comment
        pos += 2;
        while (pos < content.length && content[pos] !== '\n') {
          pos++;
        }
        pos++;
      } else if (/\s/.test(ch)) {
        pos++;
      } else {
        foundNonComment = true;
        break;
      }
    }

    if (!foundNonComment && depth === 0) {
      const before = content.slice(0, matchStart);
      const after = content.slice(pos + 1);
      content = before + ".catch((err) => { console.warn('Operation failed', err); })" + after;
      totalReplacements++;
      idx = matchStart + ".catch((err) => { console.warn('Operation failed', err); })".length;
    } else {
      idx = bodyStart + 1;
    }
  }

  if (content !== original) {
    writeFileSync(file, content);
    console.log(`Updated: ${file}`);
  }
}

console.log(`Done. Total multi-line replacements: ${totalReplacements}`);
