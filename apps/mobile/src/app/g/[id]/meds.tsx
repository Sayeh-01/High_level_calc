import { localDayKey } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Field, Muted, Row, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function Meds() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'meds'], queryFn: () => get(`/groups/${id}/meds`) });
  const sheet = useSheet();
  const tz = g.group?.timezone ?? 'Africa/Cairo';
  const [form, setForm] = useState({ patientName: '', name: '', dose: '', times: '08:00, 20:00', startOn: localDayKey(Date.now(), tz) });
  const color = g.group?.color ?? colors.primary;
  return (
    <GroupScreen id={id} active="meds">
      {g.can('items.create') && <Button title={t('care.addMed')} color={color} onPress={sheet.show} testID="new-med" style={{ marginBottom: 12 }} />}
      {q.data?.map((m: any) => (
        <Card key={m.id} accent={color} testID={`med-${m.id}`}>
          <Txt style={{ fontSize: 17, fontWeight: '700' }}>{`💊 ${m.name} ${m.dose}`.trim()}</Txt>
          <Muted>{`${m.patientName} · ${m.times.join(' · ')}`}</Muted>
          {m.doses.map((d: any) => (
            <Row
              key={d.id}
              title={fmt.dateTime(d.scheduledAt, tz)}
              subtitle={d.givenAt ? t('care.givenBy', { name: g.memberName(d.givenBy) }) : t('care.due')}
              right={d.givenAt ? <Txt>✅</Txt> : <Button small color={color} title={t('care.given')} onPress={() => run(() => post(`/groups/${id}/meds/${m.id}/doses/${d.id}/given`))} />}
            />
          ))}
        </Card>
      ))}
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('care.addMed')}>
        <Field label={t('care.patient')} value={form.patientName} onChangeText={(s) => setForm({ ...form, patientName: s })} testID="med-patient" />
        <Field label={t('care.medName')} value={form.name} onChangeText={(s) => setForm({ ...form, name: s })} testID="med-name" />
        <Field label={t('care.dose')} value={form.dose} onChangeText={(s) => setForm({ ...form, dose: s })} />
        <Field label={t('care.times')} value={form.times} onChangeText={(s) => setForm({ ...form, times: s })} style={{ writingDirection: 'ltr' }} testID="med-times" />
        <Field label={t('care.start')} value={form.startOn} onChangeText={(s) => setForm({ ...form, startOn: s })} style={{ writingDirection: 'ltr' }} />
        <Button
          title={t('common.save')}
          color={color}
          loading={pending}
          disabled={!form.patientName.trim() || !form.name.trim()}
          testID="med-save"
          onPress={async () => {
            const times = form.times.split(/[,،\s]+/).map((x) => x.trim()).filter((x) => /^\d{2}:\d{2}$/.test(x));
            await run(() => post(`/groups/${id}/meds`, { patientName: form.patientName.trim(), name: form.name.trim(), dose: form.dose, times, startOn: form.startOn }));
            sheet.hide();
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
