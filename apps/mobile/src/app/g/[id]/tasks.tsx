import { getTemplate } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from '@/components/Check';
import { DateTimeField } from '@/components/DateTimeField';
import { GroupScreen } from '@/components/GroupNav';
import { MemberPicker } from '@/components/MemberPicker';
import { RepeatPicker } from '@/components/RepeatPicker';
import { Button, Card, Empty, Field, Loading, Muted, Row, Segmented, Sheet, Toggle, Txt, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat, usePrefs } from '@/lib/prefs';

export default function Tasks() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { lang } = usePrefs();
  const router = useRouter();
  const [tab, setTab] = useState<'open' | 'mine' | 'done'>('open');
  const q = useQuery({
    queryKey: ['group', id, 'tasks', tab],
    queryFn: () => get(`/groups/${id}/tasks?status=${tab === 'done' ? 'done' : 'open'}${tab === 'mine' ? '&mine=1' : ''}`),
  });
  const { run, pending } = useAct(id);
  const sheet = useSheet();
  const [form, setForm] = useState({ title: '', notes: '', assigneeId: null as string | null, rotation: false, dueAt: null as Date | null, rrule: null as string | null, points: '' });
  const reset = () => setForm({ title: '', notes: '', assigneeId: null, rotation: false, dueAt: null, rrule: null, points: '' });
  const tpl = g.group ? getTemplate(g.group.type) : null;
  const suggestion = tpl?.starters.tasks?.[0];

  async function create() {
    await run(() =>
      post(`/groups/${id}/tasks`, {
        title: form.title.trim(),
        notes: form.notes || undefined,
        assigneeId: form.rotation ? undefined : form.assigneeId,
        rotation: form.rotation ? g.members.filter((m) => m.role !== 'guest').map((m) => m.userId) : undefined,
        dueAt: form.dueAt?.toISOString() ?? null,
        rrule: form.rrule,
        points: form.points ? Number(form.points) : undefined,
      }),
    );
    reset();
    sheet.hide();
  }

  return (
    <GroupScreen id={id} active="tasks">
      <Button small kind="secondary" title={`▦ ${t('work.board')}`} onPress={() => router.push(`/g/${id}/board`)} testID="open-board" style={{ alignSelf: 'flex-start', marginBottom: 8 }} />
      <Segmented
        value={tab}
        onChange={setTab}
        testID="tasks-tab"
        options={[
          { value: 'open', label: t('tasks.open') },
          { value: 'mine', label: t('tasks.mine') },
          { value: 'done', label: t('tasks.doneTab') },
        ]}
      />
      {g.can('items.create') && <Button title={t('tasks.new', { task: g.v('task') })} onPress={sheet.show} testID="new-task" style={{ marginBottom: 12 }} color={g.group?.color} />}
      {q.isLoading && <Loading />}
      {q.data?.length === 0 && (
        <Empty
          title={t('group.nothingYet')}
          action={
            suggestion && g.can('items.create') ? (
              <Button small kind="secondary" title={`+ ${suggestion.title[lang]}`} onPress={() => run(() => post(`/groups/${id}/tasks`, { title: suggestion.title[lang], rrule: suggestion.rrule ?? null, points: suggestion.points }))} />
            ) : undefined
          }
        />
      )}
      {q.data?.map((x: any) => (
        <Card key={x.id} style={{ paddingVertical: 4 }} testID={`task-${x.id}`}>
          <Row
            title={x.title}
            strike={x.status === 'done'}
            subtitle={[x.assigneeId ? g.memberName(x.assigneeId) : t('tasks.unassigned'), x.dueAt ? fmt.dateTime(x.dueAt) : null, x.rrule ? '🔁' : null, x.points ? `⭐ ${fmt.number(x.points)}` : null].filter(Boolean).join(' · ')}
            left={<Check checked={x.status === 'done'} label={t('tasks.complete')} color={g.group?.color} onPress={() => run(() => post(`/groups/${id}/tasks/${x.id}/${x.status === 'done' ? 'reopen' : 'complete'}`))} testID={`complete-${x.id}`} />}
            onPress={() => router.push(`/g/${id}/task/${x.id}`)}
          />
        </Card>
      ))}
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('tasks.new', { task: g.v('task') })} testID="task-sheet">
        <Field label={t('tasks.title')} value={form.title} onChangeText={(s) => setForm({ ...form, title: s })} testID="task-title" />
        <Toggle label={t('tasks.rotation')} value={form.rotation} onChange={(v) => setForm({ ...form, rotation: v })} testID="task-rotation" />
        {!form.rotation && <MemberPicker label={t('tasks.assignee')} members={g.members} selected={form.assigneeId ? [form.assigneeId] : []} onToggle={(uid) => setForm({ ...form, assigneeId: form.assigneeId === uid ? null : uid })} testID="task-assignee" color={g.group?.color} />}
        <DateTimeField value={form.dueAt} onChange={(d) => setForm({ ...form, dueAt: d })} tz={g.group?.timezone ?? 'Africa/Cairo'} allowNone testID="task-due" />
        <RepeatPicker value={form.rrule} onChange={(r) => setForm({ ...form, rrule: r })} date={form.dueAt} testID="task-repeat" />
        <Field label={t('tasks.points')} value={form.points} onChangeText={(s) => setForm({ ...form, points: s.replace(/\D/g, '') })} inputMode="numeric" />
        <Field label={`${t('tasks.notes')} (${t('common.optional')})`} value={form.notes} onChangeText={(s) => setForm({ ...form, notes: s })} multiline />
        <Button title={t('common.create')} onPress={create} disabled={!form.title.trim()} loading={pending} testID="task-save" />
        {form.rotation && <Muted style={{ marginTop: 8 }}>{g.members.map((m) => m.displayName).join(' → ')}</Muted>}
      </Sheet>
    </GroupScreen>
  );
}
