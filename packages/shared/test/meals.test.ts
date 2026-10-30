import { describe, expect, it } from 'vitest';
import { mergeIngredients, parseQty } from '../src/meals';
import { parseQuickCapture } from '../src/capture';
import { toZoned } from '../src/time';

describe('meal plan → groceries (B9 v1.4)', () => {
  it('merges the same ingredient and unit, keeps different units apart', () => {
    const merged = mergeIngredients([
      { name: 'Rice', qty: 500, unit: 'g' },
      { name: ' rice ', qty: 250, unit: 'grams' },
      { name: 'Rice', qty: 1, unit: 'kg' },
      { name: 'Tomatoes', qty: 3, unit: null },
      { name: 'tomatoes', qty: 2 },
      { name: 'Salt' },
      { name: 'salt', unit: null },
      { name: 'بصل', qty: 1, unit: 'كيلو' },
      { name: 'بصل', qty: 0.5, unit: 'kg' },
    ]);
    expect(merged).toEqual([
      { name: 'Rice', qty: 750, unit: 'g' },
      { name: 'Rice', qty: 1, unit: 'kg' },
      { name: 'Tomatoes', qty: 5, unit: null },
      { name: 'Salt', qty: null, unit: null },
      { name: 'بصل', qty: 1.5, unit: 'kg' },
    ]);
  });
  it('reads list quantities back', () => {
    expect(parseQty('2 kg')).toEqual({ qty: 2, unit: 'kg' });
    expect(parseQty('3')).toEqual({ qty: 3, unit: null });
    expect(parseQty(null)).toEqual({ qty: null, unit: null });
  });
});

describe('rule-based quick capture', () => {
  const now = new Date('2026-11-02T08:00:00Z'); // Monday
  it('pulls out the day and time, keeps the rest as the title', () => {
    const r = parseQuickCapture('Pay internet Friday 9pm', now, 'Africa/Cairo');
    expect(r.title).toBe('Pay internet');
    const z = toZoned(r.when!.getTime(), 'Africa/Cairo');
    expect([z.weekday, z.hour]).toEqual([5, 21]);
  });
  it('understands Arabic', () => {
    const r = parseQuickCapture('ادفع النت بكرة الساعة ٩ م', now, 'Africa/Cairo');
    expect(r.title).toBe('ادفع النت');
    const z = toZoned(r.when!.getTime(), 'Africa/Cairo');
    expect([z.day, z.hour]).toEqual([3, 21]);
  });
  it('no date → no time', () => {
    expect(parseQuickCapture('Buy milk', now, 'Africa/Cairo')).toEqual({ title: 'Buy milk', when: null });
  });
});
