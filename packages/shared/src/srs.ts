/** SM-2 spaced repetition (SuperMemo 2). Grades: 0–2 = forgot, 3 = hard, 4 = good, 5 = easy. */
export interface CardState {
  ease: number;
  interval: number; // days
  reps: number;
}

export const NEW_CARD: CardState = { ease: 2.5, interval: 0, reps: 0 };

export function review(state: CardState, grade: number): CardState {
  if (!Number.isInteger(grade) || grade < 0 || grade > 5) throw new Error('grade must be 0–5');
  if (grade < 3) return { ease: Math.max(1.3, state.ease - 0.2), interval: 1, reps: 0 };
  const ease = Math.max(1.3, state.ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
  const reps = state.reps + 1;
  const interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(state.interval * ease);
  return { ease: Math.round(ease * 1000) / 1000, interval, reps };
}
