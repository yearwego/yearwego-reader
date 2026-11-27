import { describe, expect, it } from 'vitest';
import { questionFor } from '../src/core/prompts';

describe('questions (spec §10.4)', () => {
  it('names the question a person tapped to after “I did it”', () => {
    expect(questionFor('core.checkIn.celebrate.how', 'core', 'celebration')).toBe('How did you do it?');
    expect(questionFor('core.checkIn.celebrate.glad', 'core', 'celebration')).toBe('What are you glad you did?');
    expect(questionFor('core.checkIn.celebrate.learned', 'core', 'celebration')).toBe('What did you learn?');
    expect(questionFor('core.checkIn.celebrate.open', 'core', 'celebration')).toBe('How did it go?');
  });

  it('names a journey’s why, its set-aside reason, and the weekly look', () => {
    expect(questionFor('journey.why', 'aim', 'why')).toBe('Why does it matter to you?');
    expect(questionFor('journey.setAside', 'aim', 'set_aside')).toBe('Why are you setting it aside?');
    expect(questionFor('week.stoodOut', 'week', 'reflection')).toBe('What stood out about your week?');
    expect(questionFor('week.hardest', 'week', 'hardest_part')).toBe('What feels hardest to start?');
  });

  it('falls back from the flow and type when the key is missing', () => {
    expect(questionFor(null, 'core', 'celebration')).toBe('What are you proud of?');
    expect(questionFor(null, 'aim', 'goal')).toBe('I want…');
  });
});
