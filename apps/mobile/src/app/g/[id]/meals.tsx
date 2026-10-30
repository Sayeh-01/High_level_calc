import { fromZoned, localDayKey } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Chip, Field, HScroll, Muted, Row, Section, Sheet, Txt, colors, styles, useSheet } from '@/components/ui';
import { del, get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

/** "500 g rice" / "2 onions" / "salt" → ingredient */
function parseLine(line: string) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|tbsp|tsp|cup|cups|pcs|جم|كيلو|لتر|كوب)?\s+(.+)$/i.exec(line);
  if (!m) return { name: line.trim() };
  return { name: m[3].trim(), qty: Number(m[1].replace(',', '.')), unit: m[2] ?? null };
}

export default function Meals() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const router = useRouter();
  const { run, pending } = useAct(id);
  const tz = g.group?.timezone ?? 'Africa/Cairo';
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => localDayKey(Date.now() + i * 86_400_000, tz)), [tz]);
  const q = useQuery({ queryKey: ['group', id, 'meals'], queryFn: () => get(`/groups/${id}/meals?from=${days[0]}&to=${days[6]}`) });
  const sheet = useSheet();
  const [form, setForm] = useState({ day: days[0], slot: 'dinner' as (typeof SLOTS)[number], title: '', ingredients: '' });
  const [result, setResult] = useState<any>(null);
  const color = g.group?.color ?? colors.primary;
  const dayLabel = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number);
    return fmt.date(new Date(fromZoned({ year: y, month: m, day: dd, hour: 12, minute: 0 }, tz)), tz);
  };
  return (
    <GroupScreen id={id} active="meals">
      {g.can('items.create') && <Button title={t('life.addMeal')} color={color} onPress={sheet.show} testID="new-meal" style={{ marginBottom: 12 }} />}
      {days.map((d) => {
        const list = (q.data ?? []).filter((m: any) => m.day === d);
        return (
          <Section key={d} title={dayLabel(d)}>
            <Card style={{ paddingVertical: 4 }}>
              {list.length === 0 && <Muted style={{ padding: 8 }}>—</Muted>}
              {list.map((m: any) => (
                <Row
                  key={m.id}
                  title={`${t(`life.slot_${m.slot}`)} · ${m.title}`}
                  subtitle={m.ingredients.map((i: any) => [i.qty, i.unit, i.name].filter((x) => x !== null && x !== undefined && x !== '').join(' ')).join(', ')}
                  right={g.can('items.create') ? <Button small kind="ghost" title="✕" onPress={() => run(() => del(`/groups/${id}/meals/${m.id}`))} /> : null}
                  testID={`meal-${m.id}`}
                />
              ))}
            </Card>
          </Section>
        );
      })}
      {g.has('lists') && g.can('lists.create') && (
        <Button
          kind="secondary"
          title={t('life.toList')}
          loading={pending}
          testID="meals-to-list"
          onPress={async () => setResult(await run(() => post(`/groups/${id}/meals/to-list`, { from: days[0], to: days[6] })))}
        />
      )}
      {result && (
        <Card style={{ marginTop: 12 }} testID="meals-to-list-result">
          <Txt>{t('life.toListDone', { added: result.added, updated: result.updated })}</Txt>
          <Button small kind="ghost" title={t('life.openList')} onPress={() => router.push(`/g/${id}/list/${result.listId}`)} testID="meals-open-list" />
        </Card>
      )}
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('life.addMeal')}>
        <HScroll>
          {days.map((d) => (
            <Chip key={d} label={dayLabel(d)} active={form.day === d} color={color} onPress={() => setForm({ ...form, day: d })} />
          ))}
        </HScroll>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 }}>
          {SLOTS.map((s) => (
            <Chip key={s} label={t(`life.slot_${s}`)} active={form.slot === s} color={color} onPress={() => setForm({ ...form, slot: s })} />
          ))}
        </View>
        <Field label={t('life.mealTitle')} value={form.title} onChangeText={(s) => setForm({ ...form, title: s })} testID="meal-title" />
        <Txt style={styles.label}>{t('life.ingredients')}</Txt>
        <Field value={form.ingredients} onChangeText={(s) => setForm({ ...form, ingredients: s })} multiline testID="meal-ingredients" />
        <Button
          title={t('common.save')}
          color={color}
          disabled={!form.title.trim()}
          testID="meal-save"
          onPress={async () => {
            const ingredients = form.ingredients.split('\n').map((l) => l.trim()).filter(Boolean).map(parseLine);
            await run(() => post(`/groups/${id}/meals`, { day: form.day, slot: form.slot, title: form.title.trim(), ingredients }));
            setForm({ ...form, title: '', ingredients: '' });
            sheet.hide();
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
