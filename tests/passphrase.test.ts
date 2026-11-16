import { describe, expect, it } from 'vitest';
import { normalizePassphrase, passphraseCandidates } from '../src/core/crypto';

const WORDS = 'pointed-dares-giggling-class-paddle-glass-easiness-duller';

describe('passphraseCandidates', () => {
  it.each([
    ['surrounding space and a line break', `  ${WORDS}\n`],
    ['a capitalised first word', `P${WORDS.slice(1)}`],
    ['spaces between words', WORDS.replaceAll('-', ' ')],
    ['long dashes', WORDS.replaceAll('-', '—')],
    ['an invisible character', WORDS.replace('class', 'cl\u200Bass')],
    ['a full stop from the double-space shortcut', WORDS.replace('-class', '. class')],
  ])('tries the app’s form after %s', (_, typed) => {
    expect(passphraseCandidates(typed)).toEqual([typed, WORDS]);
  });

  it('tries the exact text first, so TEST still opens', () => {
    expect(passphraseCandidates('TEST')).toEqual(['TEST', 'test']);
  });

  it('tries once when the words are already in the app’s form', () => {
    expect(passphraseCandidates(WORDS)).toEqual([WORDS]);
  });

  it('never turns different words into the right ones', () => {
    expect(normalizePassphrase(WORDS.replace('duller', 'dull'))).not.toBe(WORDS);
  });
});
