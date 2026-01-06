#!/usr/bin/env node
// generate-exports.mjs
// ──────────────────────────────────────────────────────────────────────────────
// Purpose
//   • Produce exported-functions.txt       ──► consumed by em++ -sEXPORTED_FUNCTIONS
//   • Produce exported-runtime-methods.txt ──► consumed by em++ -sEXPORTED_RUNTIME_METHODS
//   • Produce runtime-methods.ts           ──► handy, typed wrapper for TS
//   
// Strategy (Automated Header Parsing):
//   Instead of maintaining a static list, we parse qpdf-c.h to automatically
//   discover all "qpdf_*" functions. This ensures full API coverage for future
//   needs without manual maintenance, while avoiding the complexity of Clang AST.
// ──────────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ———————————————————————————————————————————————————————————————————
// 1. Config
// ———————————————————————————————————————————————————————————————————

const manualCFunctions = [
  'malloc',
  'free',
  'main',
  // Emscripten/libc functions needed by QPDF utilities
  'getenv',
  'setenv',
  'unsetenv',
  // Custom streaming write functions (not in qpdf-c.h header but in qpdf-c.cc)
  'qpdf_init_write_stream',
  'qpdf_write_begin',
  'qpdf_write_continue',
  'qpdf_get_write_progress'
];

/**
 * Emscripten Runtime Methods to export. (These don't change often)
 */
const runtimeMethods = [
  'ccall',
  'cwrap',
  'setValue',
  'getValue',
  'addFunction',
  'removeFunction',
  'stringToUTF8',
  'UTF8ToString',
  'lengthBytesUTF8',
  'FS',
  'NODEFS',
  'WORKERFS',
  'ENV',
  'callMain'
];

/**
 * Incoming Module Attributes (JS API)
 * Defines properties the Module object can accept during initialization.
 */
const incomingMethods = [
  'noInitialRun',
  'noFSInit',
  'locateFile',
  'preRun'
];

// ———————————————————————————————————————————————————————————————————
// 2. Setup Output
// ———————————————————————————————————————————————————————————————————
// 2. Setup Output & Args
// ———————————————————————————————————————————————————————————————————
const selfDir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outDir = resolve(args[0] ?? selfDir);

let includeDir = resolve(selfDir, '../../qpdf/include/qpdf'); // Default local path

// Parse --qpdf-include argument
const includeArgIndex = args.indexOf('--qpdf-include');
if (includeArgIndex !== -1 && args[includeArgIndex + 1]) {
  includeDir = resolve(process.cwd(), args[includeArgIndex + 1]);
}

console.log(`Output Directory: ${outDir}`);
console.log(`Include Directory: ${includeDir}`);

mkdirSync(outDir, { recursive: true });

// ———————————————————————————————————————————————————————————————————
// 3. Automated Parsing of qpdf-c.h
// ———————————————————————————————————————————————————————————————————
const headerPath = resolve(includeDir, 'qpdf-c.h');
console.log(`Parsing header: ${headerPath}`);

let headerContent = '';
try {
  headerContent = readFileSync(headerPath, 'utf8');
} catch (e) {
  console.error(`❌ Failed to read header file at ${headerPath}`);
  console.error('Make sure git submodules are initialized and you are running from the correct directory.');
  process.exit(1);
}

// Strip comments (C-style /* ... */ and C++-style // ...) to handle Doxygen blocks
const contentWithoutComments = headerContent
  .replace(/\/\*[\s\S]*?\*\//g, '') // Strip /* ... */
  .replace(/\/\/.*$/gm, '');         // Strip // ...

// Regex to find functions declared with QPDF_DLL and starting with qpdf_
// matches patterns like: QPDF_DLL QPDF_ERROR_CODE qpdf_init(...)
// Now robust against newlines and spacing because comments are gone.
// Updated to handle multi-word return types (e.g. "enum qpdf_result_e", "unsigned long")
const funcRegex = /QPDF_DLL\s+[\w\s\*]+\s+(qpdf_\w+)\s*\(/g;
const foundFunctions = [];
let match;

while ((match = funcRegex.exec(contentWithoutComments)) !== null) {
  foundFunctions.push(match[1]);
}

// Filter out internal/reserved functions if any (optional)
// Also filter out C++ specific helpers (qpdf_c_wrap, qpdf_c_get_qpdf) which have C++ linkage
const exportedFunctions = [
  ...manualCFunctions,
  ...foundFunctions.filter(f =>
    !f.includes('_reserved') &&
    !['qpdf_c_wrap', 'qpdf_c_get_qpdf'].includes(f)
  )
];

console.log(`🔍 Discovered ${foundFunctions.length} QPDF functions from header.`);
console.log(`   (Plus ${manualCFunctions.length} manual exports: ${manualCFunctions.join(', ')})`);

// ———————————————————————————————————————————————————————————————————
// 4. Generate exported-functions.txt
// ———————————————————————————————————————————————————————————————————
// Emscripten expects C functions to be prefixed with '_'
const functionsContent = `[${exportedFunctions.map(f => `"_` + f + `"`).join(',')}]`;

writeFileSync(
  resolve(outDir, 'exported-functions.txt'),
  functionsContent,
  'utf8'
);

// ———————————————————————————————————————————————————————————————————
// 5. Generate exported-runtime-methods.txt
// ———————————————————————————————————————————————————————————————————
const runtimeContent = `[${runtimeMethods.map(m => `"${m}"`).join(',')}]`;

writeFileSync(
  resolve(outDir, 'exported-runtime-methods.txt'),
  runtimeContent,
  'utf8'
);

// ———————————————————————————————————————————————————————————————————
// 6. Generate exported-incoming-methods.txt
// ———————————————————————————————————————————————————————————————————
const incomingContent = `[${incomingMethods.map(m => `"${m}"`).join(',')}]`;

writeFileSync(
  resolve(outDir, 'exported-incoming-methods.txt'),
  incomingContent,
  'utf8'
);

// ———————————————————————————————————————————————————————————————————
// 7. Generate runtime-methods.ts (TypeScript Definition)
// ———————————————————————————————————————————————————————————————————
const tsContent = `/* AUTO-GENERATED - DO NOT EDIT BY HAND */
/* Generated by build/generate-exports.mjs */
/// <reference types="emscripten" />

export const allExportedFunctions = [
${exportedFunctions.map(f => `  "${f}"`).join(',\n')}
] as const;

export const allRuntimeMethods = [
${runtimeMethods.map(m => `  "${m}"`).join(',\n')}
] as const;
`;

writeFileSync(
  resolve(outDir, 'runtime-methods.ts'),
  tsContent,
  'utf8'
);

console.log(`✅ Generated WASM export configs in ${outDir}`);
