import { parseMajorToMinor } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Empty, Field, Muted, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function Assets() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'assets'], queryFn: () => get(`/groups/${id}/assets`) });
  const sheet = useSheet();
  const color = g.group?.color ?? colors.primary;
  const [form, setForm] = useState({ name: '', location: '', every: '90', last: '' });
  const [serviceFor, setServiceFor] = useState<any>(null);
  const [service, setService] = useState({ note: '', cost: '' });
  const day = (d: string) => fmt.date(`${d}T12:00:00Z`, 'UTC');
  return (
    <GroupScreen id={id} active="assets">
      {g.can('items.manage') && <Button title={t('ops.newAsset')} color={color} onPress={sheet.show} testID="new-asset" style={{ marginBottom: 12 }} />}
      {q.data?.length === 0 && <Empty title={t('group.nothingYet')} />}
      {q.data?.map((a: any) => (
        <Card key={a.id} testID={`asset-${a.id}`}>
          <Txt style={{ fontWeight: '700' }}>{`🛠️ ${a.name}`}</Txt>
          <Muted>{[a.location, a.nextServiceDay ? t('ops.next', { date: day(a.nextServiceDay) }) : t('ops.noSchedule')].filter(Boolean).join(' · ')}</Muted>
          <Button small kind="secondary" title={t('ops.service')} onPress={() => setServiceFor(a)} testID={`service-${a.id}`} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
        </Card>
      ))}
      <Sheet visible={!!serviceFor} onClose={() => setServiceFor(null)} title={`${t('ops.service')}: ${serviceFor?.name ?? ''}`} testID="service-sheet">
        <Field label={t('ops.serviceNote')} value={service.note} onChangeText={(s) => setService({ ...service, note: s })} testID="service-note" />
        <Field label={`${t('ops.cost')} (${g.group?.currency ?? 'EGP'})`} value={service.cost} onChangeText={(s) => setService({ ...service, cost: s })} inputMode="decimal" />
        <Button title={t('common.save')} color={color} loading={pending} testID="service-save" onPress={async () => (await run(() => post(`/groups/${id}/assets/${serviceFor.id}/service`, { note: service.note.trim(), costMinor: parseMajorToMinor(service.cost) ?? 0 })), setServiceFor(null), setService({ note: '', cost: '' }))} />
      </Sheet>
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('ops.newAsset')} testID="asset-sheet">
        <Field label={t('ops.name')} value={form.name} onChangeText={(s) => setForm({ ...form, name: s })} testID="asset-name" />
        <Field label={t('ops.location')} value={form.location} onChangeText={(s) => setForm({ ...form, location: s })} />
        <Field label={t('ops.every')} value={form.every} onChangeText={(s) => setForm({ ...form, every: s })} inputMode="numeric" testID="asset-every" />
        <Field label={t('ops.last')} value={form.last} onChangeText={(s) => setForm({ ...form, last: s })} style={{ writingDirection: 'ltr' }} testID="asset-last" />
        <Button
          title={t('common.save')}
          color={color}
          loading={pending}
          disabled={!form.name.trim() || (!!form.last && !/^\d{4}-\d{2}-\d{2}$/.test(form.last))}
          testID="asset-save"
          onPress={async () => {
            await run(() => post(`/groups/${id}/assets`, { name: form.name.trim(), location: form.location.trim(), serviceEveryDays: Number(form.every) || null, lastServiceDay: form.last || null }));
            setForm({ name: '', location: '', every: '90', last: '' });
            sheet.hide();
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
