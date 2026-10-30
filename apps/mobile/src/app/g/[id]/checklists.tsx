import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Chip, Empty, Field, Muted, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

type Kind = 'opening' | 'closing' | 'onboarding' | 'other';

export default function Checklists() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const router = useRouter();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'checklists'], queryFn: () => get(`/groups/${id}/checklists`) });
  const sheet = useSheet();
  const color = g.group?.color ?? colors.primary;
  const [form, setForm] = useState({ title: '', kind: 'opening' as Kind, items: '' });
  return (
    <GroupScreen id={id} active="checklists">
      {g.can('items.manage') && <Button title={t('company.newChecklist')} color={color} onPress={sheet.show} testID="new-checklist" style={{ marginBottom: 12 }} />}
      {q.data?.length === 0 && <Empty title={t('group.nothingYet')} />}
      {q.data?.map((l: any) => (
        <Card key={l.id} accent={l.completedAt ? colors.good : color} onPress={() => router.push(`/g/${id}/checklist/${l.id}`)} testID={`checklist-${l.id}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Txt style={{ fontSize: 16, fontWeight: '700', flex: 1 }}>{`☑️ ${l.title}`}</Txt>
            <Txt style={{ fontWeight: '700', color: l.completedAt ? colors.good : colors.text }}>{l.completedAt ? t('company.completed') : t('company.progress', { done: fmt.number(l.done), total: fmt.number(l.total) })}</Txt>
          </View>
          <Muted>{`${t(`company.kind_${l.kind}`)}${l.kind !== 'onboarding' ? ` · ${t('company.today')}` : ''}`}</Muted>
          {l.onboarding?.length > 0 && <Muted>{`${t('company.newHires')}: ${l.onboarding.map((o: any) => `${g.memberName(o.userId)} ${o.completedAt ? '✓' : `${o.done}/${l.total}`}`).join('، ')}`}</Muted>}
        </Card>
      ))}
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('company.newChecklist')} testID="checklist-sheet">
        <Field label={t('company.checklistTitle')} value={form.title} onChangeText={(s) => setForm({ ...form, title: s })} testID="checklist-title" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {(['opening', 'closing', 'onboarding', 'other'] as Kind[]).map((k) => (
            <Chip key={k} label={t(`company.kind_${k}`)} active={form.kind === k} color={color} onPress={() => setForm({ ...form, kind: k })} />
          ))}
        </View>
        <Field label={t('company.items')} value={form.items} onChangeText={(s) => setForm({ ...form, items: s })} multiline style={{ minHeight: 120 }} testID="checklist-items" />
        <Button
          title={t('common.create')}
          color={color}
          loading={pending}
          disabled={!form.title.trim() || !form.items.trim()}
          testID="checklist-save"
          onPress={async () => {
            const items = form.items.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => ({ text: s.replace(/^📷\s*/u, ''), photo: s.startsWith('📷') }));
            await run(() => post(`/groups/${id}/checklists`, { title: form.title.trim(), kind: form.kind, items }));
            setForm({ title: '', kind: form.kind, items: '' });
            sheet.hide();
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
