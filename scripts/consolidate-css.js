import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import CleanCSS from 'clean-css';

// A source-maintenance operation, not an extra production build step.
// Dry run by default. Writes are allowed only if the normal production
// optimizer emits exactly the same stylesheet before and after cleanup.
const stylesheet = new URL('../frontend/css/app.css', import.meta.url);
const original = await readFile(stylesheet, 'utf8');
const productionOptions = { level: 2, sourceMap: false };
const sourceOptions = {
  level: {
    1: { all: false },
    2: {
      all: false,
      removeDuplicateRules: true,
      removeDuplicateMediaBlocks: true,
      removeDuplicateFontRules: true,
      reduceNonAdjacentRules: true,
      mergeAdjacentRules: true,
      overrideProperties: true,
      removeEmpty: true,
      // clean-css 5 does not recognize every modern font shorthand (for
      // example numeric weights such as 650). Preserve those source values.
      skipProperties: ['font']
    }
  },
  format: 'beautify'
};

function optimize(source, options) {
  const result = new CleanCSS(options).minify(source);
  assert.equal(result.errors.length, 0, result.errors.join('\n'));
  return result;
}

const before = optimize(original, productionOptions);
const cleaned = optimize(original, sourceOptions);
const header = `/* ACE application styles.
 * Redundant declarations have been consolidated with production-output verification.
 * Rule order, selector specificity, !important, and conditional overrides matter.
 * Repeated selectors across breakpoints, themes, and interaction states are intentional.
 * Keep this file readable; scripts/build-frontend.js handles deployment minification.
 */\n`;
const candidate = header + cleaned.styles.replace(/\r\n/g, '\n') + '\n';
const after = optimize(candidate, productionOptions);
assert.equal(after.styles, before.styles,
  'Cleanup changed the production stylesheet. No source files were written.');

const digest = createHash('sha256').update(after.styles).digest('hex');
console.log(JSON.stringify({
  productionCssIdentical: true,
  productionSha256: digest,
  sourceBytesBefore: Buffer.byteLength(original),
  sourceBytesAfter: Buffer.byteLength(candidate),
  blocksBefore: (original.match(/\{/g) || []).length,
  blocksAfter: (candidate.match(/\{/g) || []).length,
  productionBytes: Buffer.byteLength(after.styles)
}, null, 2));

if (process.argv.includes('--write')) {
  await writeFile(stylesheet, candidate);
  console.log(`Consolidated ${fileURLToPath(stylesheet)}`);
} else {
  console.log('Dry run only. Pass --write to apply the verified cleanup.');
}
