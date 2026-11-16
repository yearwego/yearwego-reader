import { describe, expect, it } from 'vitest';
import { normalizePassphrase } from '../src/core/crypto';

const WORDS = 'pointed-dares-giggling-class-paddle-glass-easiness-duller';

describe('normalizePassphrase', () => {
  it.each([
    ['exact words', WORDS],
    ['surrounding space and a line break', `  ${WORDS}\n`],
    ['a capitalised first word', `P${WORDS.slice(1)}`],
    ['spaces between words', WORDS.replaceAll('-', ' ')],
    ['long dashes', WORDS.replaceAll('-', '\u2014')],
    ['an invisible character', WORDS.replace('class', 'cl\u200Bass')],
    ['a full stop from the double-space shortcut', WORDS.replace('-class', '. class')],
  ])('reads %s as the generated words', (_, typed) => {
    expect(normalizePassphrase(typed)).toBe(WORDS);
  });

  it('never turns different words into the right ones', () => {
    expect(normalizePassphrase(WORDS.replace('duller', 'dull'))).not.toBe(WORDS);
  });
});
