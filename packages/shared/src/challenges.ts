// Challenges (A7): split a shared goal into parts (a khatma's 30 juz', a book's chapters) or track a daily target.

/** Sizes of n contiguous blocks covering `total` parts; sizes differ by at most one (bigger blocks first). */
export function partBlocks(total: number, n: number): number[] {
  if (!Number.isInteger(total) || total < 1) throw new Error('total must be a positive integer');
  if (!Number.isInteger(n) || n < 1) throw new Error('need at least one member');
  const base = Math.floor(total / n);
  const extra = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Who reads which part in a round. Round 1: member i takes block i. Each next round moves every member one block on, so
 * nobody repeats their parts and over N rounds everyone covers every part exactly once (A6 Faith: "automatic reassignment
 * for the next round").
 */
export function assignParts(total: number, memberIds: string[], round: number): { part: number; userId: string }[] {
  if (new Set(memberIds).size !== memberIds.length) throw new Error('each member once');
  const sizes = partBlocks(total, memberIds.length);
  const starts = sizes.map((_, b) => sizes.slice(0, b).reduce((s, x) => s + x, 0));
  const n = memberIds.length;
  const out: { part: number; userId: string }[] = [];
  memberIds.forEach((userId, i) => {
    const b = (((i + round - 1) % n) + n) % n;
    for (let k = 0; k < sizes[b]; k++) out.push({ part: starts[b] + k + 1, userId });
  });
  return out.sort((a, b) => a.part - b.part);
}

/** [1,2,3,7,9,10] → "1–3, 7, 9–10" */
export function partRanges(parts: number[]): string {
  const sorted = [...parts].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j;
  }
  return runs.join(', ');
}
