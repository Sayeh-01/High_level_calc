import { describe, expect, it } from 'vitest';
import { signatureInput, validateAnswers, type FormField } from '../src/forms';

const fields: FormField[] = [
  { id: 'name', label: 'Child name', type: 'text', required: true },
  { id: 'trip', label: 'May attend the trip', type: 'yes_no', required: true },
  { id: 'size', label: 'T-shirt', type: 'choice', options: ['S', 'M', 'L'], required: false },
  { id: 'age', label: 'Age', type: 'number', required: false },
];

describe('form answers', () => {
  it('accepts valid answers and drops unknown fields', () => {
    expect(validateAnswers(fields, { name: 'Lina', trip: true, size: 'M', age: 9, extra: 'x' })).toEqual({ ok: true, answers: { name: 'Lina', trip: true, size: 'M', age: 9 } });
  });
  it('reports missing required answers and wrong types', () => {
    const r = validateAnswers(fields, { name: '  ', trip: 'yes', size: 'XL', age: 'nine' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['age', 'name', 'size', 'trip']);
  });
});

describe('signature (B9 v2.8)', () => {
  it('a drawn path in the pad’s coordinates is accepted; anything else is refused', () => {
    expect(signatureInput.safeParse({ path: 'M10 20L30 40L50 45M60 20L70 30', width: 300, height: 120, name: 'Amal Hassan' }).success).toBe(true);
    for (const path of ['', 'M10 20', '<script>', 'M10 20L30 40 Z onload=x', 'M-5 20L30 40', 'M10 20L999 40']) {
      expect(signatureInput.safeParse({ path, width: 300, height: 120, name: 'A' }).success, path).toBe(false);
    }
    expect(signatureInput.safeParse({ path: 'M10 20L30 40', width: 300, height: 120, name: '' }).success).toBe(false);
  });
});
