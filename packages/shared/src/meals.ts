export interface Ingredient {
  name: string;
  qty?: number | null;
  unit?: string | null;
}

const UNIT_ALIASES: Record<string, string> = {
  g: 'g', gram: 'g', grams: 'g', gr: 'g', 'جم': 'g', 'جرام': 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', 'كيلو': 'kg',
  ml: 'ml', l: 'l', liter: 'l', litre: 'l', 'لتر': 'l',
  tbsp: 'tbsp', tablespoon: 'tbsp', 'ملعقة': 'tbsp', tsp: 'tsp', teaspoon: 'tsp',
  cup: 'cup', cups: 'cup', 'كوب': 'cup',
  pc: 'pcs', pcs: 'pcs', piece: 'pcs', pieces: 'pcs', 'حبة': 'pcs',
};

export const normalizeName = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
export const normalizeUnit = (u?: string | null) => {
  if (!u || !u.trim()) return null;
  const k = u.trim().toLocaleLowerCase().replace(/\.$/, '');
  return UNIT_ALIASES[k] ?? k;
};

/**
 * Meal plan → grocery list: the same ingredient in the same unit becomes one line with the quantities added.
 * Different units stay separate lines (500 g and 1 kg of rice are not silently converted).
 */
export function mergeIngredients(items: Ingredient[]): { name: string; qty: number | null; unit: string | null }[] {
  const out = new Map<string, { name: string; qty: number | null; unit: string | null }>();
  for (const it of items) {
    if (!it.name?.trim()) continue;
    const unit = normalizeUnit(it.unit);
    const key = `${normalizeName(it.name)}|${unit ?? ''}`;
    const prev = out.get(key);
    const qty = typeof it.qty === 'number' && Number.isFinite(it.qty) ? it.qty : null;
    if (!prev) out.set(key, { name: it.name.trim().replace(/\s+/g, ' '), qty, unit });
    else prev.qty = prev.qty === null && qty === null ? null : Math.round(((prev.qty ?? 0) + (qty ?? 0)) * 1000) / 1000;
  }
  return [...out.values()];
}

export function formatQty(qty: number | null, unit: string | null): string | null {
  if (qty === null && !unit) return null;
  return [qty ?? '', unit ?? ''].join(' ').trim() || null;
}

/** Reads "2 kg" / "3" back into a number + unit (for merging into an existing list line). */
export function parseQty(s: string | null | undefined): { qty: number | null; unit: string | null } {
  if (!s) return { qty: null, unit: null };
  const m = /^\s*(\d+(?:\.\d+)?)\s*(.*)$/.exec(s);
  if (!m) return { qty: null, unit: normalizeUnit(s) };
  return { qty: Number(m[1]), unit: normalizeUnit(m[2]) };
}
