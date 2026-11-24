import test from 'node:test';
import assert from 'node:assert/strict';
import { isCleanAsciiNumber, sanitizeForClipboard } from './sanitize';

test('sanitizeForClipboard strips BiDi controls, currency symbols, commas, and percent signs', () => {
  const dirtyPrice = '\u2066$94,280.5\u2069\u200E\u200B';
  const clean = sanitizeForClipboard(dirtyPrice);
  assert.equal(clean, '94280.5');
  assert.equal(isCleanAsciiNumber(clean), true);
});

test('sanitizeForClipboard converts Persian/Arabic digits to pure ASCII Latin digits', () => {
  const persianPrice = '۲,۶۸۴.۵۰%';
  const clean = sanitizeForClipboard(persianPrice);
  assert.equal(clean, '2684.50');
  assert.equal(isCleanAsciiNumber(clean), true);
});

test('sanitizeForClipboard formats numeric input cleanly to requested decimals', () => {
  const clean = sanitizeForClipboard(31.425, 3);
  assert.equal(clean, '31.425');
  assert.equal(isCleanAsciiNumber(clean), true);
});
