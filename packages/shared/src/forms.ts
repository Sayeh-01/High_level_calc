import { z } from 'zod';

// Forms & sign-offs (A7): custom fields, answers checked on the server, and a signature drawn on the phone.

export type FieldType = 'text' | 'number' | 'choice' | 'yes_no' | 'date';
export interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
}

export const formField = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  label: z.string().trim().min(1).max(120),
  type: z.enum(['text', 'number', 'choice', 'yes_no', 'date']),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(60)).min(2).max(20).optional(),
});

export type Answers = Record<string, string | number | boolean>;

export function validateAnswers(fields: FormField[], input: Record<string, unknown>): { ok: true; answers: Answers } | { ok: false; errors: Record<string, string> } {
  const answers: Answers = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = input[f.id];
    const empty = v === undefined || v === null || (typeof v === 'string' && !v.trim());
    if (empty) {
      if (f.required) errors[f.id] = 'required';
      continue;
    }
    if (f.type === 'text' && typeof v === 'string' && v.length <= 2000) answers[f.id] = v.trim();
    else if (f.type === 'number' && typeof v === 'number' && Number.isFinite(v)) answers[f.id] = v;
    else if (f.type === 'yes_no' && typeof v === 'boolean') answers[f.id] = v;
    else if (f.type === 'choice' && typeof v === 'string' && f.options?.includes(v)) answers[f.id] = v;
    else if (f.type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) answers[f.id] = v;
    else errors[f.id] = 'invalid';
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, answers };
}

/** Strokes as "M x y L x y …" in whole pixels of the pad. Only that grammar, so it can be drawn anywhere safely. */
const PATH = /^(M\d{1,4} \d{1,4}(L\d{1,4} \d{1,4})+)+$/;
export const signatureInput = z
  .object({
    path: z.string().max(20000).regex(PATH),
    width: z.number().int().min(50).max(2000),
    height: z.number().int().min(30).max(1000),
    /** the signer's typed full name, shown under the drawing */
    name: z.string().trim().min(1).max(80),
  })
  .refine((s) => {
    const nums = (s.path.match(/\d+/g) ?? []).map(Number);
    return nums.length > 0 && nums.every((v, i) => (i % 2 === 0 ? v <= s.width : v <= s.height));
  }, 'outside the pad');
export type Signature = z.infer<typeof signatureInput>;

/** Parses a stored path into strokes of points (for drawing it again). */
export function parseSignaturePath(path: string): [number, number][][] {
  return path
    .split('M')
    .filter(Boolean)
    .map((stroke) => stroke.split('L').map((pt) => pt.trim().split(' ').map(Number) as [number, number]));
}
