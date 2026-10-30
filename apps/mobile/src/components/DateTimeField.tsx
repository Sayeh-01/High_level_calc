import { fromZoned, toZoned } from '@circle/shared';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFormat } from '@/lib/prefs';
import { Chip, Field, HScroll, styles } from './ui';

/** Cross-platform date + time picker without native modules: day chips for two weeks and an HH:MM field. */
export function DateTimeField({ value, onChange, tz, testID, allowNone }: { value: Date | null; onChange: (d: Date | null) => void; tz: string; testID?: string; allowNone?: boolean }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const days = useMemo(() => {
    const now = Date.now();
    return Array.from({ length: 14 }, (_, i) => {
      const z = toZoned(now + i * 86_400_000, tz);
      return { y: z.year, m: z.month, d: z.day, at: fromZoned({ year: z.year, month: z.month, day: z.day, hour: 12, minute: 0 }, tz) };
    });
  }, [tz]);
  const cur = value ? toZoned(value.getTime(), tz) : null;
  const hhmm = cur ? `${String(cur.hour).padStart(2, '0')}:${String(cur.minute).padStart(2, '0')}` : '';
  const set = (y: number, m: number, d: number, time: string) => {
    const [h, mi] = time.split(':').map((x) => Number(x));
    onChange(new Date(fromZoned({ year: y, month: m, day: d, hour: Number.isFinite(h) ? h : 20, minute: Number.isFinite(mi) ? mi : 0 }, tz)));
  };
  return (
    <View style={{ marginBottom: 12 }} testID={testID}>
      <Text style={styles.label}>{t('events.date')}</Text>
      <HScroll>
        {allowNone && <Chip label={t('common.none')} active={!value} onPress={() => onChange(null)} testID={testID ? `${testID}-none` : undefined} />}
        {days.map((d, i) => (
          <Chip
            key={i}
            label={fmt.date(new Date(d.at), tz)}
            active={!!cur && cur.year === d.y && cur.month === d.m && cur.day === d.d}
            onPress={() => set(d.y, d.m, d.d, hhmm || '20:00')}
            testID={testID ? `${testID}-day-${i}` : undefined}
          />
        ))}
      </HScroll>
      {value ? (
        <View style={{ marginTop: 10 }}>
          <Field
            label={t('events.time')}
            value={hhmm}
            onChangeText={(s) => {
              if (/^\d{1,2}:\d{2}$/.test(s) && cur) set(cur.year, cur.month, cur.day, s);
            }}
            placeholder="20:00"
            testID={testID ? `${testID}-time` : undefined}
            inputMode="numeric"
          />
        </View>
      ) : null}
    </View>
  );
}
