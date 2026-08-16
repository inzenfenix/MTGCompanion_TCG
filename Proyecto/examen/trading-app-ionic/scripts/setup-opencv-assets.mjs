#!/usr/bin/env node
/**
 * ROADMAP.md I15 — self-hosts `@techstark/opencv-js`'s `dist/opencv.js`
 * (~13MB UMD-wrapped Emscripten build) as a plain static asset, loaded via
 * a classic `<script>` tag instead of `import('@techstark/opencv-js')`.
 *
 * Why: this package's CJS `module.exports` is itself a thenable (documented
 * in `vite.config.ts`'s Vitest workaround comment) — in the real
 * Rollup-bundled production build (not Vitest, which has its own separate
 * `deps.inline` fix), that shape breaks the dynamic `import()`'s own CJS
 * interop: `await import('@techstark/opencv-js')` throws `TypeError: Method
 * Promise.prototype.then called on incompatible receiver`, confirmed live
 * on a real Android device (permanently stuck "Loading vision..." — see
 * cardLocalizer.ts::getOpenCv()'s own comment for the downstream half of
 * this fix, which alone wasn't enough). Loading the same file as a classic
 * script (not an ES/CJS module at all) sidesteps this entire class of
 * bundler interop problem — this is also how OpenCV.js's own docs recommend
 * loading it in a plain web page.
 *
 * Run once after `npm install` (or after bumping `@techstark/opencv-js` —
 * the copied file must match the installed version): `npm run setup:opencv`.
 * Output is gitignored (`public/opencv.js`) — generated, not source, same
 * convention as `public/models/*.onnx` and E3c's `public/tesseract/`.
 * Idempotent: just overwrites, safe to re-run any time.
 */

import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'node_modules/@techstark/opencv-js/dist/opencv.js');
const DEST = join(ROOT, 'public/opencv.js');

if (!existsSync(SRC)) {
  throw new Error(`Expected file not found: ${SRC} — is @techstark/opencv-js installed? (npm install)`);
}
mkdirSync(dirname(DEST), { recursive: true });
copyFileSync(SRC, DEST);
console.log(`Copied ${SRC} -> ${DEST}`);
