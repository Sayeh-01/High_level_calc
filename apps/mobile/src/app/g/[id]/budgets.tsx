import { parseMajorToMinor } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Empty, Field, Muted, Segmented, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { del, get, post } from '@/lib/api';
import { confirmAsk, useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function Budgets() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'budgets'], queryFn: () => get(`/groups/${id}/budgets`) });
  const sheet = useSheet();
  const [form, setForm] = useState({ category: '*', amount: '', period: 'month' as 'month' | 'total' });
  const color = g.group?.color ?? colors.primary;
  const cur = g.group?.currency ?? 'EGP';
  return (
    <GroupScreen id={id} active="budgets">
      {g.can('group.settings') && <Button title={t('money.addBudget')} color={color} onPress={sheet.show} testID="new-budget" style={{ marginBottom: 12 }} />}
      {q.data?.length === 0 && <Empty title={t('group.nothingYet')} />}
      {q.data?.map((b: any) => {
        const pct = Math.min(100, b.percent);
        const barColor = b.percent >= 100 ? colors.danger : b.percent >= 80 ? colors.warn : colors.good;
        return (
          <Card key={b.id} testID={`budget-${b.id}`}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Txt style={{ fontSize: 16, fontWeight: '700', flex: 1 }}>{b.category === '*' ? t('money.everything') : b.category}</Txt>
              <Txt style={{ fontWeight: '700', color: barColor }} testID={`budget-pct-${b.id}`}>{fmt.number(b.percent)}%</Txt>
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, marginVertical: 8, overflow: 'hidden' }}>
              <View style={{ width: `${pct}%`, height: 8, backgroundColor: barColor }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Muted style={{ flex: 1 }}>{`${t('money.spentOf', { spent: fmt.money(b.spent, cur), limit: fmt.money(b.amountMinor, cur) })} · ${b.period === 'month' ? t('money.perMonth') : t('money.whole')}`}</Muted>
              {g.can('group.settings') && (
                <Button small kind="secondary" title={t('common.delete')} onPress={async () => (await confirmAsk(t('common.delete'))) && run(() => del(`/groups/${id}/budgets/${b.id}`))} />
              )}
            </View>
          </Card>
        );
      })}
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('money.addBudget')} testID="budget-sheet">
        <Field label={t('money.budgetCategory')} value={form.category} onChangeText={(s) => setForm({ ...form, category: s })} testID="budget-category" />
        <Field label={`${t('money.limit')} (${cur})`} value={form.amount} onChangeText={(s) => setForm({ ...form, amount: s })} inputMode="decimal" testID="budget-amount" />
        <Segmented<'month' | 'total'> value={form.period} onChange={(p) => setForm({ ...form, period: p })} options={[{ value: 'month', label: t('money.perMonth') }, { value: 'total', label: t('money.whole') }]} />
        <Button
          title={t('common.save')}
          color={color}
          loading={pending}
          disabled={!form.category.trim() || !parseMajorToMinor(form.amount)}
          testID="budget-save"
          onPress={async () => {
            await run(() => post(`/groups/${id}/budgets`, { category: form.category.trim(), amount: parseMajorToMinor(form.amount), period: form.period }));
            setForm({ category: '*', amount: '', period: form.period });
            sheet.hide();
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
