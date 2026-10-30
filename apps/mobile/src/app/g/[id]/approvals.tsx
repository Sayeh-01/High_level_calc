import { parseMajorToMinor } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Field, Muted, Row, Section, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

const STATUS_COLOR: Record<string, string> = { pending: colors.warn, approved: colors.good, rejected: colors.danger };

export default function Approvals() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'approvals'], queryFn: () => get(`/groups/${id}/spend-requests`) });
  const sheet = useSheet();
  const color = g.group?.color ?? colors.primary;
  const cur = g.group?.currency ?? 'EGP';
  const me = g.me?.userId;
  const [form, setForm] = useState({ title: '', amount: '', category: '' });
  return (
    <GroupScreen id={id} active="approvals">
      <Button title={t('ops.newRequest')} color={color} onPress={sheet.show} testID="new-request" style={{ marginBottom: 8 }} />
      {q.data && g.can('approve') && <Muted style={{ marginBottom: 8 }} testID="my-limit">{q.data.myLimit === null ? t('ops.noLimit') : t('ops.myLimit', { amount: fmt.money(q.data.myLimit, cur) })}</Muted>}
      <Section title={g.moduleLabel('approvals')}>
        {q.data?.requests.map((r: any) => (
          <Card key={r.id} accent={STATUS_COLOR[r.status]} testID={`request-${r.id}`}>
            <Row
              title={`${r.title} · ${fmt.money(r.amountMinor, cur)}`}
              subtitle={`${r.requesterId === me ? t('common.you') : g.memberName(r.requesterId)}${r.category ? ` · ${r.category}` : ''} · ${t(`ops.${r.status}`)}${r.decidedBy === 'auto' ? ` (${t('ops.auto')})` : ''}`}
            />
            {r.status === 'pending' && g.can('approve') && r.requesterId !== me && (
              <View style={{ flexDirection: 'row', gap: 6, paddingBottom: 6 }}>
                <Button small color={color} title={t('ops.approve')} onPress={() => run(() => post(`/groups/${id}/spend-requests/${r.id}/approve`))} testID={`approve-${r.id}`} />
                <Button small kind="secondary" title={t('ops.reject')} onPress={() => run(() => post(`/groups/${id}/spend-requests/${r.id}/reject`))} />
              </View>
            )}
          </Card>
        ))}
      </Section>
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('ops.newRequest')} testID="request-sheet">
        <Field label={t('ops.title')} value={form.title} onChangeText={(s) => setForm({ ...form, title: s })} testID="request-title" />
        <Field label={`${t('ops.amount')} (${cur})`} value={form.amount} onChangeText={(s) => setForm({ ...form, amount: s })} inputMode="decimal" testID="request-amount" />
        <Field label={t('ops.category')} value={form.category} onChangeText={(s) => setForm({ ...form, category: s })} />
        <Button
          title={t('common.send')}
          color={color}
          loading={pending}
          disabled={!form.title.trim() || !parseMajorToMinor(form.amount)}
          testID="request-save"
          onPress={async () => {
            await run(() => post(`/groups/${id}/spend-requests`, { title: form.title.trim(), amount: parseMajorToMinor(form.amount), category: form.category.trim() }));
            setForm({ title: '', amount: '', category: '' });
            sheet.hide();
          }}
        />
      </Sheet>
      <Txt> </Txt>
    </GroupScreen>
  );
}
