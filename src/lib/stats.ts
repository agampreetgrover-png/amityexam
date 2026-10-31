import type { Topic } from "./types";

// Order checked with a colour-blind palette validator: neighbouring slots stay distinct; teal has enough chroma to read.
export const SUBJECT_COLORS = ["#3b5bdb", "#2b8a3e", "#7048e8", "#018ca1", "#e8590c", "#c2255c", "#5c940d", "#d6336c"];

/** Studied counts half, revised counts full. */
export function coverage(topics: Topic[]): number {
  if (!topics.length) return 0;
  const pts = topics.reduce((a, t) => a + (t.status === "revised" ? 1 : t.status === "studied" ? 0.5 : 0), 0);
  return Math.round((pts / topics.length) * 100);
}

/** A topic is weak if confidence is low or its recent quiz average is under 60%. */
export function isWeak(confidence: number, quizAvg?: number) {
  return confidence <= 2 || (quizAvg != null && quizAvg < 60);
}
