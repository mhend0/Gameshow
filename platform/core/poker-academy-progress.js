// Where the Academy's record is kept.
//
// Deliberately the only file on the Academy's side of the fence that touches
// the store. `store.js` opens a BroadcastChannel at import time, which keeps
// Node's event loop alive and makes anything importing it — at any depth —
// impossible to run under `node --test`. Everything worth testing (the
// curriculum, the drill generators, the scoring, the achievement rules) lives
// in poker-academy.js and stays clear of this.
//
// So this file is thin on purpose. It loads, it saves, and it delegates every
// decision to `applyAttempt`.

import { Value } from "./store.js";
import { emptyProgress, normaliseProgress, applyAttempt } from "./poker-academy.js";

export const academyProgress = new Value("pokerAcademy", null);

/** @returns {import("./poker-academy.js").Progress} */
export function loadProgress() {
  return normaliseProgress(academyProgress.get());
}

/**
 * Record one finished run at a lesson.
 * @see applyAttempt for what actually decides any of this.
 */
export function recordAttempt(lessonKey, score, outOf) {
  const result = applyAttempt(loadProgress(), lessonKey, score, outOf);
  academyProgress.set(result.progress);
  return result;
}

/** Wipe the record. Offered in the UI, because a trainer you can't restart is a nag. */
export function resetProgress() {
  const fresh = emptyProgress();
  academyProgress.set(fresh);
  return fresh;
}
