import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Field, Muted, Section, Txt, colors } from '@/components/ui';
import { get, put } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function Standups() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'standups'], queryFn: () => get(`/groups/${id}/standups`) });
  const me = g.me?.userId;
  const mine = q.data?.answers.find((a: any) => a.userId === me);
  const [form, setForm] = useState({ yesterday: '', today: '', blockers: '' });
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (mine) setForm({ yesterday: mine.yesterday, today: mine.today, blockers: mine.blockers });
  }, [mine?.answeredAt]);
  const color = g.group?.color ?? colors.primary;
  return (
    <GroupScreen id={id} active="standups">
      {q.data && <Muted style={{ marginBottom: 8 }}>{`${fmt.date(`${q.data.day}T12:00:00Z`, 'UTC')}${q.data.workDay ? '' : ` · ${t('work.notWorkDay')}`}`}</Muted>}
      {(!mine || editing) && (
        <Card accent={color} testID="standup-form">
          <Field label={t('work.yesterday')} value={form.yesterday} onChangeText={(s) => setForm({ ...form, yesterday: s })} multiline testID="standup-yesterday" />
          <Field label={t('work.today')} value={form.today} onChangeText={(s) => setForm({ ...form, today: s })} multiline testID="standup-today" />
          <Field label={t('work.blockers')} value={form.blockers} onChangeText={(s) => setForm({ ...form, blockers: s })} multiline testID="standup-blockers" />
          <Button title={t('work.post')} color={color} loading={pending} disabled={!form.today.trim()} testID="standup-post" onPress={async () => (await run(() => put(`/groups/${id}/standups/me`, form)), setEditing(false))} />
        </Card>
      )}
      <Section title={t('work.answered')}>
        {q.data?.answers.map((a: any) => (
          <Card key={a.userId} testID={`standup-${a.userId === me ? 'me' : a.userId}`}>
            <Txt style={{ fontWeight: '700' }}>{a.userId === me ? t('common.you') : g.memberName(a.userId)}</Txt>
            {a.yesterday ? <Muted>{`⏮ ${a.yesterday}`}</Muted> : null}
            <Txt>{`▶ ${a.today}`}</Txt>
            {a.blockers ? <Txt style={{ color: colors.danger }}>{`⛔ ${a.blockers}`}</Txt> : null}
            {a.userId === me && !editing && <Button small kind="ghost" title={t('work.edit')} onPress={() => setEditing(true)} style={{ alignSelf: 'flex-start' }} />}
          </Card>
        ))}
      </Section>
      {q.data?.missing.length > 0 && <Muted testID="standup-missing">{`${t('work.missing')}: ${q.data.missing.map((u: string) => g.memberName(u)).join('، ')}`}</Muted>}
      {q.data?.away.length > 0 && <Muted>{`🌴 ${t('work.off')}: ${q.data.away.map((u: string) => g.memberName(u)).join('، ')}`}</Muted>}
    </GroupScreen>
  );
}
