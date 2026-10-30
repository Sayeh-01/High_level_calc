import { parseMajorToMinor } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Empty, Field, Muted, Row, Segmented, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useConfig, useGroup } from '@/lib/hooks';
import { PaySheet, type PayTarget } from '@/components/PaySheet';
import { useFormat } from '@/lib/prefs';

const STATUS_COLOR: Record<string, string> = { paid: colors.good, reported: colors.warn, unpaid: colors.danger };

export default function Dues() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'dues'], queryFn: () => get(`/groups/${id}/dues`) });
  const sheet = useSheet();
  const [form, setForm] = useState({ title: '', amount: '', period: 'monthly' as 'monthly' | 'once', dueDay: '1' });
  const color = g.group?.color ?? colors.primary;
  const cur = g.group?.currency ?? 'EGP';
  const me = g.me?.userId;
  const config = useConfig();
  const [pay, setPay] = useState<{ target: PayTarget; amount: number; payee: string } | null>(null);
  return (
    <GroupScreen id={id} active="dues">
      {g.can('approve') && <Button title={t('money.addDue')} color={color} onPress={sheet.show} testID="new-due" style={{ marginBottom: 12 }} />}
      {q.data?.length === 0 && <Empty title={t('group.nothingYet')} />}
      {q.data?.map((d: any) => (
        <Card key={d.id} accent={color} testID={`due-${d.id}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Txt style={{ fontSize: 17, fontWeight: '700', flex: 1 }}>{`🧾 ${d.title}`}</Txt>
            <Txt style={{ fontWeight: '700' }}>{fmt.money(d.amountMinor, cur)}</Txt>
          </View>
          <Muted testID={`due-collected-${d.id}`}>{`${d.period === 'monthly' ? t('money.monthly') : t('money.once')} · ${t('money.collected', { amount: fmt.money(d.collected, cur) })}`}</Muted>
          {d.board.map((ch: any) => (
            <Row
              key={ch.id}
              title={ch.payerKey === me ? t('common.you') : g.memberName(ch.payerKey)}
              subtitle={t(`money.${ch.status}`)}
              testID={`charge-${ch.payerKey === me ? 'me' : ch.payerKey}`}
              right={
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: STATUS_COLOR[ch.status] }} />
                  {ch.status === 'unpaid' && ch.payerKey === me && config.data?.payments && d.createdBy !== me && (
                    <Button small color={color} title={t('pay.online')} testID={`due-pay-${d.id}`} onPress={() => setPay({ target: { purpose: 'due', targetId: ch.id }, amount: ch.amountMinor, payee: g.memberName(d.createdBy) })} />
                  )}
                  {ch.status === 'unpaid' && ch.payerKey === me && (
                    <Button small kind="secondary" title={t('money.iPaid')} testID={`due-report-${d.id}`} onPress={() => run(() => post(`/groups/${id}/dues/${d.id}/charges/${ch.id}/report`))} />
                  )}
                  {ch.status !== 'paid' && g.can('approve') && (
                    <Button small color={color} title={t('money.confirmPaid')} testID={`due-confirm-${ch.payerKey}`} onPress={() => run(() => post(`/groups/${id}/dues/${d.id}/charges/${ch.id}/confirm`))} />
                  )}
                </View>
              }
            />
          ))}
        </Card>
      ))}
      <PaySheet groupId={id} target={pay?.target ?? null} amount={pay?.amount ?? 0} currency={cur} payeeName={pay?.payee ?? ''} color={color} onClose={() => setPay(null)} />
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('money.addDue')} testID="due-sheet">
        <Field label={t('money.dueTitle')} value={form.title} onChangeText={(s) => setForm({ ...form, title: s })} testID="due-title" />
        <Field label={`${t('money.perMember')} (${cur})`} value={form.amount} onChangeText={(s) => setForm({ ...form, amount: s })} inputMode="decimal" testID="due-amount" />
        <Segmented<'monthly' | 'once'> value={form.period} onChange={(p) => setForm({ ...form, period: p })} options={[{ value: 'monthly', label: t('money.monthly') }, { value: 'once', label: t('money.once') }]} />
        {form.period === 'monthly' && <Field label={t('money.dueDay')} value={form.dueDay} onChangeText={(s) => setForm({ ...form, dueDay: s })} inputMode="numeric" />}
        <Button
          title={t('common.save')}
          color={color}
          loading={pending}
          disabled={!form.title.trim() || !parseMajorToMinor(form.amount)}
          testID="due-save"
          onPress={async () => {
            const day = Math.min(28, Math.max(1, Number(form.dueDay) || 1));
            await run(() => post(`/groups/${id}/dues`, { title: form.title.trim(), amount: parseMajorToMinor(form.amount), period: form.period, dueDay: day }));
            setForm({ ...form, title: '', amount: '' });
            sheet.hide();
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
