#!/usr/bin/env node
// OpenAgent SDK conformance runner (TypeScript / Node.js).
//
// Loads JSON test vectors from <vectors-dir>/**/*.json, runs each vector
// through the Node reference implementation, compares observed output to
// expected output, and emits a JUnit XML report plus a text summary.
//
// Usage:
//   node src/main.mjs <vectors-dir> [--junit out.xml] [--filter category[:name]]
//
// Exit code: 0 all pass, 1 any fail, 2 IO/parse error.

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { handleVector } from './handlers.mjs';
import { renderJUnit } from './report.mjs';

function parseArgs(argv) {
  if (argv.length < 3) {
    console.error(
      'usage: node src/main.mjs <vectors-dir> [--junit <path>] [--filter <category[:name]>]'
    );
    process.exit(2);
  }
  const out = { dir: argv[2], junit: null, filter: null };
  let i = 3;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--junit') {
      out.junit = argv[i + 1];
      i += 2;
    } else if (a === '--filter') {
      out.filter = argv[i + 1];
      i += 2;
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function loadVectorFiles(root, filter) {
  const files = [];
  const catFilter = filter ? filter.split(':')[0] : null;
  const nameFilter = filter && filter.includes(':') ? filter.split(':')[1] : null;
  for (const catEntry of readdirSync(root)) {
    const catPath = join(root, catEntry);
    if (!statSync(catPath).isDirectory()) continue;
    if (catFilter && catFilter !== catEntry) continue;
    for (const fileEntry of readdirSync(catPath)) {
      if (extname(fileEntry) !== '.json') continue;
      const filePath = join(catPath, fileEntry);
      let raw;
      try {
        raw = JSON.parse(readFileSync(filePath, 'utf8'));
      } catch (e) {
        throw new Error(`parse ${filePath}: ${e.message}`);
      }
      const name = raw.name || basename(fileEntry, '.json');
      let vectors = Array.isArray(raw.vectors) ? raw.vectors : [];
      if (nameFilter) {
        vectors = vectors.filter((v) => v.name && v.name.includes(nameFilter));
      }
      if (vectors.length === 0) continue;
      files.push({ category: catEntry, name, vectors, source: filePath });
    }
  }
  files.sort((a, b) =>
    a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category)
  );
  return files;
}

function classifyFile(v) {
  const op = (v.input && v.input.operation) || '';
  if (['sign_and_verify', 'verify_only', 'derive_public_key', 'sign_twice'].includes(op))
    return 'ed25519';
  if (['extract', 'expand', 'extract_and_expand', 'expand_two'].includes(op)) return 'hkdf';
  if (['hash_hex', 'hash_ascii', 'hash_seq'].includes(op)) return 'blake3';
  if (['encrypt_and_decrypt', 'decrypt_only'].includes(op)) return 'aes-gcm';
  if (op === 'canonicalize' || op === 'canonicalize_document') return 'jcs';
  if (op.startsWith('threshold_sign')) return 'frost-ed25519';
  return 'vector';
}

function main() {
  const args = parseArgs(process.argv);
  let files;
  try {
    files = loadVectorFiles(args.dir, args.filter);
  } catch (e) {
    console.error(`failed to load vectors from ${args.dir}: ${e.message}`);
    process.exit(2);
  }

  const results = [];
  const summary = { pass: 0, fail: 0, byCategory: {} };

  for (const file of files) {
    console.log(`\n[${file.category}] ${file.name} (${file.vectors.length} vectors)`);
    for (const vector of file.vectors) {
      const start = Date.now();
      let outcome;
      try {
        handleVector(file.category, vector);
        outcome = { ok: true };
        console.log(`  PASS  ${vector.name}`);
        summary.pass += 1;
      } catch (e) {
        outcome = { ok: false, message: e.message || String(e) };
        console.log(`  FAIL  ${vector.name}: ${outcome.message}`);
        summary.fail += 1;
      }
      const cat = summary.byCategory[file.category] || { pass: 0, fail: 0 };
      cat[outcome.ok ? 'pass' : 'fail'] += 1;
      summary.byCategory[file.category] = cat;
      results.push({
        category: file.category,
        fileName: classifyFile(vector),
        vectorName: vector.name,
        outcome,
        durationMs: Date.now() - start,
      });
    }
  }

  console.log('\n========= SUMMARY =========');
  for (const [cat, v] of Object.entries(summary.byCategory).sort()) {
    const total = v.pass + v.fail;
    console.log(`  ${cat.padEnd(12)} ${v.pass}/${total} passed`);
  }
  console.log(`  TOTAL        ${summary.pass}/${summary.pass + summary.fail} passed`);

  if (args.junit) {
    writeFileSync(args.junit, renderJUnit('conformance-ts', results));
    console.log(`  junit report: ${args.junit}`);
  }

  process.exit(summary.fail === 0 ? 0 : 1);
}

main();
