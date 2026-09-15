/**
 * pi-reasoning - shared test helpers
 *
 * The extension renders every emoji-labelled string through one formatter:
 * `emoji + two spaces + text`. Tests assert that shape directly instead of
 * comparing against hard-coded literals, so a regression in the separator is
 * caught no matter which surface produced the string.
 */

import assert from "node:assert/strict";
import { SINGLE_SPACE_LEVELS } from "../lib/_levels.ts";

/** A leading emoji, single code point or ZWJ sequence. */
const LEADING_EMOJI = /^(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/u;

/**
 * Number of spaces between the leading emoji and the text that follows.
 * Throws when the string does not start with an emoji.
 */
export function spacesAfterEmoji(label) {
  const match = label.match(LEADING_EMOJI);
  assert.ok(match, `expected a leading emoji in ${JSON.stringify(label)}`);
  return label.slice(match[0].length).match(/^ */)[0].length;
}

/** Assert the canonical `emoji + exactly two spaces + text` shape (non-level strings). */
export function assertCanonicalLabel(label) {
  assert.equal(
    spacesAfterEmoji(label),
    2,
    `expected two spaces after the emoji in ${JSON.stringify(label)}`,
  );
}

/**
 * Assert the canonical `emoji + level` shape with the per-level separator:
 * one space for `off`/`minimal`/`low`/`medium`/`max`, two for `high`/`xhigh`
 * (see `SINGLE_SPACE_LEVELS`, the single source of truth).
 */
export function assertLevelLabel(label, level) {
  const expected = SINGLE_SPACE_LEVELS.has(level) ? 1 : 2;
  assert.equal(
    spacesAfterEmoji(label),
    expected,
    `expected ${expected} space(s) after the emoji in ${JSON.stringify(label)}`,
  );
  assert.ok(label.endsWith(level), `expected label to end with ${level}: ${JSON.stringify(label)}`);
}
