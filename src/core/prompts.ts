// The questions, from the app’s features/loops/content/prompts.ts (2026-10-29).

const QUESTION_BY_KEY: Record<string, string> = {
  'aim.want': 'I want…',
  'core.setGoal': 'Today, I’ll…',
  'core.setGoal.smallestStep': 'My smallest step today is…',
  'core.checkIn.celebrate': 'What are you proud of?',
  'core.checkIn.learn': 'What got in the way?',
  'compass.setGoal': 'What matters to you in the next 30 days?',
  'compass.refine': 'What matters most for the next 30 days?',
  'compass.checkIn.celebrate': 'What moved you closer? Call out your wins.',
  'compass.checkIn.learn': 'What got in the way, and what will you change?',
  'horizon.setGoal': 'What matters to you in the year ahead?',
  'horizon.reInvite': 'A new year. What matters to you now?',
  'horizon.reflect': 'What still matters to you, what fell away, and why?',
};

function fallbackKey(flow: string, recordingType: string): string | null {
  if (flow === 'aim') return recordingType === 'goal' ? 'aim.want' : null;
  if (flow === 'core' || flow === 'compass') {
    if (recordingType === 'goal') return `${flow}.setGoal`;
    if (recordingType === 'celebration') return `${flow}.checkIn.celebrate`;
    if (recordingType === 'fail_reason') return `${flow}.checkIn.learn`;
    return null;
  }
  if (flow === 'horizon') {
    if (recordingType === 'goal') return 'horizon.setGoal';
    if (recordingType === 'reflection') return 'horizon.reflect';
  }
  return null;
}

export function questionFor(
  promptKey: string | null,
  flow: string,
  recordingType: string,
): string | null {
  if (promptKey && QUESTION_BY_KEY[promptKey]) return QUESTION_BY_KEY[promptKey];
  const key = fallbackKey(flow, recordingType);
  return key ? (QUESTION_BY_KEY[key] ?? null) : null;
}

export function checkInQuestionFor(flow: string): string | null {
  if (flow === 'core') return 'Did you do it?';
  if (flow === 'compass') return 'Are you closer to what matters to you?';
  return null;
}
