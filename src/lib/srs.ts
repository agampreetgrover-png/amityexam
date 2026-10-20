import { addDay } from "./dates";
import type { ISODay } from "./types";

interface SrsState {
  ease: number;
  interval: number;
  reps: number;
}

export const NEW_SRS: SrsState = { ease: 2.5, interval: 0, reps: 0 };

/**
 * SM-2. `grade` is 0–5 (0 = blackout, 3 = correct with effort, 5 = perfect).
 * Returns the new state and the next due day.
 */
export function review(state: SrsState, grade: number, on: ISODay): SrsState & { due: ISODay } {
  const g = Math.max(0, Math.min(5, Math.round(grade)));
  let { ease, interval, reps } = state;

  if (g < 3) {
    reps = 0;
    interval = 1;
  } else {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 6;
    else interval = Math.round(interval * ease);
  }

  ease = Math.max(1.3, ease + (0.1 - (5 - g) * (0.08 + (5 - g) * 0.02)));
  return { ease, interval, reps, due: addDay(on, interval) };
}
