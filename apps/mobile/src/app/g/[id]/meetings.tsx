import { localDayKey } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Field, Muted, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function Meetings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'meetings'], queryFn: () => get(`/groups/${id}/meetings`) });
  const sheet = useSheet();
  const color = g.group?.color ?? colors.primary;
  const [form, setForm] = useState({ title: '', notes: '' });
  return (
    <GroupScreen id={id} active="meetings">
      {g.can('items.create') && <Button title={t('work.newMeeting')} color={color} onPress={sheet.show} testID="new-meeting" style={{ marginBottom: 12 }} />}
      {q.data?.map((m: any) => {
        const open = m.actionItems.filter((i: any) => !i.taskId).length;
        return (
          <Card key={m.id} accent={color} testID={`meeting-${m.id}`}>
            <Txt style={{ fontSize: 16, fontWeight: '700' }}>{m.title}</Txt>
            <Muted>{fmt.date(`${m.day}T12:00:00Z`, 'UTC')}</Muted>
            {m.notes ? <Txt style={{ marginVertical: 6 }}>{m.notes}</Txt> : null}
            <Txt style={{ fontWeight: '600', marginTop: 4 }}>{t('work.actionItems')}</Txt>
            {m.actionItems.length === 0 && <Muted>{t('work.noItems')}</Muted>}
            {m.actionItems.map((i: any, k: number) => (
              <Muted key={k}>{`${i.taskId ? '✅' : '☐'} ${i.title}${i.assigneeId ? ` · ${g.memberName(i.assigneeId)}` : ''}${i.dueDay ? ` · ${fmt.date(`${i.dueDay}T12:00:00Z`, 'UTC')}` : ''}`}</Muted>
            ))}
            {open > 0 && <Button small color={color} title={`${t('work.makeTasks')} (${fmt.number(open)})`} onPress={() => run(() => post(`/groups/${id}/meetings/${m.id}/tasks`))} testID={`make-tasks-${m.id}`} style={{ marginTop: 8, alignSelf: 'flex-start' }} />}
          </Card>
        );
      })}
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('work.newMeeting')} testID="meeting-sheet">
        <Field label={t('work.meetingTitle')} value={form.title} onChangeText={(s) => setForm({ ...form, title: s })} testID="meeting-title" />
        <Field label={t('work.notes')} value={form.notes} onChangeText={(s) => setForm({ ...form, notes: s })} multiline style={{ minHeight: 140 }} testID="meeting-notes" />
        <Muted style={{ marginBottom: 12 }}>{t('work.notesHint')}</Muted>
        <View>
          <Button
            title={t('common.save')}
            color={color}
            loading={pending}
            disabled={!form.title.trim()}
            testID="meeting-save"
            onPress={async () => {
              await run(() => post(`/groups/${id}/meetings`, { title: form.title.trim(), day: localDayKey(Date.now(), g.group?.timezone ?? 'Africa/Cairo'), notes: form.notes }));
              setForm({ title: '', notes: '' });
              sheet.hide();
            }}
          />
        </View>
      </Sheet>
    </GroupScreen>
  );
}
