// One-shot codemod: rename the Prisma-shaped client API to Mongo-native names.
//
//   import prisma            -> import db
//   prisma.<model>.findUnique/findFirst -> .findOne
//   prisma.<model>.findMany  -> .find
//   prisma.$transaction      -> db.transaction
//   prisma.$disconnect/$connect -> db.disconnect/connect
//   orderBy: / take:         -> sort: / limit:
//
// Deliberately does NOT touch `where:`, `data:`, `include:`, `select:` or `skip:`.
// `data:` in particular collides with the API response envelope in lib/envelope.js
// (`{ data: rows }`), so a blind rename would corrupt every response body.
//
// lib/db.js is skipped — it is rewritten by hand as the native Mongo layer.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_DIRS = ['lib', 'app', 'scripts'];
const SKIP = new Set(['lib/db.js', 'scripts/codemod-prisma-to-db.mjs']);

const REPLACEMENTS = [
  [/import\s*\{\s*prisma\s*\}\s*from/g, 'import { db } from'],
  [/import\s+prisma\s+from/g, 'import db from'],
  [/\bprisma\./g, 'db.'],
  [/\.findUnique\(/g, '.findOne('],
  [/\.findFirst\(/g, '.findOne('],
  [/\.findMany\(/g, '.find('],
  [/\$transaction\(/g, 'transaction('],
  [/\$disconnect/g, 'disconnect'],
  [/\$connect/g, 'connect'],
  [/\borderBy:/g, 'sort:'],
  [/\btake:/g, 'limit:'],
];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === 'screenshots') continue;
      out.push(...walk(p));
    } else if (/\.(js|mjs|cjs)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

let changed = 0;
for (const dir of TARGET_DIRS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (SKIP.has(rel)) continue;

    const before = fs.readFileSync(file, 'utf8');
    let after = before;
    for (const [re, to] of REPLACEMENTS) after = after.replace(re, to);

    if (after !== before) {
      fs.writeFileSync(file, after);
      changed++;
      console.log('  rewrote', rel);
    }
  }
}

console.log(`\n${changed} file(s) rewritten`);
