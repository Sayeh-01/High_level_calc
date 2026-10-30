import { toWesternDigits } from './money';
import { fromZoned, toZoned } from './time';

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
  'الأحد': 0, 'الاحد': 0, 'الإثنين': 1, 'الاثنين': 1, 'الثلاثاء': 2, 'الأربعاء': 3, 'الاربعاء': 3, 'الخميس': 4, 'الجمعة': 5, 'السبت': 6,
};

/**
 * Rule-based quick capture (v1.0): pulls a day ("today", "tomorrow", a weekday, Arabic too) and a time ("9pm", "21:00",
 * "9 م") out of one sentence and returns the rest as the title. AI parsing replaces this from v1.4.
 */
export function parseQuickCapture(input: string, now: Date, tz: string): { title: string; when: Date | null } {
  let text = ` ${toWesternDigits(input)} `;
  let dayOffset: number | null = null;
  let hour: number | null = null;
  let minute = 0;
  const take = (re: RegExp) => {
    const m = re.exec(text);
    if (m) text = text.replace(m[0], ' ');
    return m;
  };
  if (take(/\s(today|النهارده|اليوم)\s/i)) dayOffset = 0;
  else if (take(/\s(tomorrow|بكرة|بكره|غدا|غدًا)\s/i)) dayOffset = 1;
  else {
    const m = take(new RegExp(`\\s(?:on\\s|يوم\\s)?(${Object.keys(WEEKDAYS).join('|')})\\s`, 'i'));
    if (m) {
      const target = WEEKDAYS[m[1].toLowerCase()] ?? WEEKDAYS[m[1]];
      const today = toZoned(now.getTime(), tz).weekday;
      dayOffset = (target - today + 7) % 7 || 7;
    }
  }
  const t = take(/\s(?:at\s|الساعة\s)?(\d{1,2})(?::(\d{2}))?\s?(am|pm|ص|م)?\s/i);
  if (t && (t[2] || t[3])) {
    hour = Number(t[1]);
    minute = t[2] ? Number(t[2]) : 0;
    const ap = t[3]?.toLowerCase();
    if ((ap === 'pm' || ap === 'م') && hour < 12) hour += 12;
    if ((ap === 'am' || ap === 'ص') && hour === 12) hour = 0;
  } else if (t) {
    text = text.replace(/\s+/, ` ${t[0].trim()} `); // a bare number is part of the title
  }
  const title = text.replace(/\s+/g, ' ').trim();
  if (dayOffset === null && hour === null) return { title, when: null };
  const base = toZoned(now.getTime() + (dayOffset ?? 0) * 86_400_000, tz);
  const when = new Date(fromZoned({ year: base.year, month: base.month, day: base.day, hour: hour ?? 20, minute }, tz));
  return { title, when };
}
