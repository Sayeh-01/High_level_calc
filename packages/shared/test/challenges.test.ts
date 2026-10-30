import { describe, expect, it } from 'vitest';
import { assignParts, partBlocks, partRanges } from '../src/challenges';

describe('khatma split (B9 v2.8)', () => {
  it('30 parts across N members: contiguous blocks, sizes differ by at most one, all 30 covered once', () => {
    for (const n of [1, 2, 3, 4, 7, 10, 13, 29, 30]) {
      const sizes = partBlocks(30, n);
      expect(sizes).toHaveLength(n);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(30);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
    const members = ['amal', 'bassem', 'carla', 'dina'];
    const r1 = assignParts(30, members, 1);
    expect(r1).toHaveLength(30);
    expect(r1.map((x) => x.part)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    // 30 / 4 → 8, 8, 7, 7 in member order
    const count = (r: typeof r1, u: string) => r.filter((x) => x.userId === u).length;
    expect(members.map((u) => count(r1, u))).toEqual([8, 8, 7, 7]);
    expect(r1.filter((x) => x.userId === 'amal').map((x) => x.part)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('the next round rotates the blocks: nobody keeps their parts, and over N rounds everyone reads every part once', () => {
    const members = ['amal', 'bassem', 'carla', 'dina'];
    const r1 = assignParts(30, members, 1);
    const r2 = assignParts(30, members, 2);
    for (const u of members) {
      const a = r1.filter((x) => x.userId === u).map((x) => x.part);
      const b = r2.filter((x) => x.userId === u).map((x) => x.part);
      expect(a.some((p) => b.includes(p)), u).toBe(false);
    }
    expect(r2.filter((x) => x.userId === 'amal').map((x) => x.part)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    for (const u of members) {
      const all = [1, 2, 3, 4].flatMap((round) => assignParts(30, members, round).filter((x) => x.userId === u).map((x) => x.part));
      expect([...all].sort((a, b) => a - b), u).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    }
    // round N+1 is round 1 again
    expect(assignParts(30, members, 5)).toEqual(r1);
  });

  it('more members than parts: each part still has exactly one reader, and turns rotate', () => {
    const members = Array.from({ length: 35 }, (_, i) => `m${i}`);
    const r1 = assignParts(30, members, 1);
    expect(new Set(r1.map((x) => x.part)).size).toBe(30);
    expect(new Set(r1.map((x) => x.userId)).size).toBe(30);
    const r2 = assignParts(30, members, 2);
    expect(r2.map((x) => x.userId)).not.toEqual(r1.map((x) => x.userId));
  });

  it('refuses nonsense', () => {
    expect(() => assignParts(30, [], 1)).toThrow();
    expect(() => assignParts(0, ['a'], 1)).toThrow();
    expect(() => assignParts(30, ['a', 'a'], 1)).toThrow();
  });
});

describe('part ranges', () => {
  it('collapses runs', () => {
    expect(partRanges([3, 1, 2, 7, 9, 10])).toBe('1–3, 7, 9–10');
    expect(partRanges([16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30])).toBe('16–30');
    expect(partRanges([])).toBe('');
  });
});
