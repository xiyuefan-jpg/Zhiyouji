/**
 * "疑似抄袭本服其他作品" (PRD part 6 §4.5): the words of a team work — its text
 * and the speech-to-text of its video or audio — compared with the works of the
 * other teams on the same server. Copying is shown as a flag to the reviewer
 * and a message to the admins; nothing is decided automatically.
 *
 * Measure: the share of this work's 5-character pieces (after dropping spaces
 * and punctuation) that also appear in the other work. Chinese has no spaces,
 * so pieces of characters work better than words; 5 characters is long enough
 * that sharing a topic ("火焰山的温度") does not count, short enough that a
 * copied paragraph with a few words changed still does.
 */

export const SIMILARITY = {
  /** Characters in a piece. */
  n: 5,
  /** Works shorter than this (in pieces, about as many characters) are not compared. */
  minPieces: 40,
  /** Share of pieces found in the other work from which it is flagged. */
  flagAt: 0.5,
} as const;

export const PLAGIARISM_FLAG = "疑似抄袭本服其他作品";

/** Letters, digits and CJK characters only, lower case. */
export function normalizeForSimilarity(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function pieces(text: string, n: number = SIMILARITY.n): Set<string> {
  const s = [...normalizeForSimilarity(text)];
  const out = new Set<string>();
  for (let i = 0; i + n <= s.length; i++) out.add(s.slice(i, i + n).join(""));
  return out;
}

/** Share of `a`'s pieces that are also in `b` (0 when `a` is too short). */
export function containment(a: Set<string>, b: Set<string>): number {
  if (a.size < SIMILARITY.minPieces || b.size === 0) return 0;
  let shared = 0;
  for (const p of a) if (b.has(p)) shared++;
  return shared / a.size;
}

/** The other work that shares the most, when at or above the flag line. */
export function mostSimilar<T extends { id: string; words: string }>(mine: string, others: readonly T[]): { other: T; ratio: number } | null {
  const a = pieces(mine);
  if (a.size < SIMILARITY.minPieces) return null;
  let best: { other: T; ratio: number } | null = null;
  for (const o of others) {
    const r = containment(a, pieces(o.words));
    if (r >= SIMILARITY.flagAt && (!best || r > best.ratio)) best = { other: o, ratio: r };
  }
  return best;
}
