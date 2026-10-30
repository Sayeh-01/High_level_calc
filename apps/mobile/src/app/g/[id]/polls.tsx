import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Empty, Field, Loading, Muted, Sheet, Toggle, Txt, colors, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';

export default function Polls() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['group', id, 'polls'], queryFn: () => get(`/groups/${id}/polls`) });
  const { run, pending } = useAct(id);
  const sheet = useSheet();
  const [form, setForm] = useState({ question: '', options: ['', ''], multi: false, anonymous: false, hours: '' });
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const color = g.group?.color ?? colors.primary;

  return (
    <GroupScreen id={id} active="polls">
      {g.can('items.create') && <Button title={t('polls.new')} onPress={sheet.show} testID="new-poll" style={{ marginBottom: 12 }} color={color} />}
      {q.isLoading && <Loading />}
      {q.data?.length === 0 && <Empty title={t('group.nothingYet')} />}
      {q.data?.map((p: any) => {
        const closed = p.closesAt && new Date(p.closesAt) <= new Date();
        const total = Math.max(1, p.options.reduce((s: number, o: any) => s + o.votes, 0));
        const sel = picked[p.id] ?? p.myVotes;
        return (
          <Card key={p.id} testID={`poll-${p.id}`}>
            <Txt style={{ fontSize: 17, fontWeight: '700', marginBottom: 8 }}>{p.question}</Txt>
            {p.options.map((o: any) => (
              <Pressable
                key={o.id}
                disabled={!!closed}
                accessibilityRole={p.multi ? 'checkbox' : 'radio'}
                accessibilityState={{ checked: sel.includes(o.id) }}
                onPress={() => {
                  const next = p.multi ? (sel.includes(o.id) ? sel.filter((x: string) => x !== o.id) : [...sel, o.id]) : [o.id];
                  setPicked({ ...picked, [p.id]: next });
                  if (!p.multi) run(() => post(`/groups/${id}/polls/${p.id}/vote`, { optionIds: next }));
                }}
                testID={`poll-option-${o.id}`}
                style={{ marginBottom: 8, borderRadius: 10, borderWidth: 2, borderColor: sel.includes(o.id) ? color : colors.border, overflow: 'hidden', minHeight: 44, justifyContent: 'center' }}>
                <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, width: `${(o.votes / total) * 100}%`, backgroundColor: color, opacity: 0.15 }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 10, gap: 8 }}>
                  <Txt style={{ flex: 1 }}>{o.label}</Txt>
                  <Txt style={{ fontWeight: '700' }}>{t('polls.votes', { count: o.votes })}</Txt>
                </View>
              </Pressable>
            ))}
            {p.multi && !closed && <Button small title={t('polls.vote')} onPress={() => run(() => post(`/groups/${id}/polls/${p.id}/vote`, { optionIds: sel }))} disabled={sel.length === 0} color={color} />}
            <Muted style={{ marginTop: 6 }}>
              {[t('polls.voters', { count: p.voterCount }), p.anonymous ? t('polls.anonymous') : null, p.multi ? t('polls.multi') : null, closed ? t('polls.closed') : null].filter(Boolean).join(' · ')}
            </Muted>
          </Card>
        );
      })}
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('polls.new')} testID="poll-sheet">
        <Field label={t('polls.question')} value={form.question} onChangeText={(s) => setForm({ ...form, question: s })} testID="poll-question" />
        {form.options.map((o, i) => (
          <Field key={i} placeholder={t('polls.option', { n: i + 1 })} value={o} onChangeText={(s) => setForm({ ...form, options: form.options.map((x, j) => (j === i ? s : x)) })} testID={`poll-opt-${i}`} />
        ))}
        <Button small kind="ghost" title={`+ ${t('polls.addOption')}`} onPress={() => setForm({ ...form, options: [...form.options, ''] })} />
        <Toggle label={t('polls.multi')} value={form.multi} onChange={(v) => setForm({ ...form, multi: v })} />
        <Toggle label={t('polls.anonymous')} value={form.anonymous} onChange={(v) => setForm({ ...form, anonymous: v })} />
        <Field label={t('polls.deadline')} value={form.hours} onChangeText={(s) => setForm({ ...form, hours: s.replace(/\D/g, '') })} inputMode="numeric" />
        <Button
          title={t('common.create')}
          loading={pending}
          testID="poll-save"
          color={color}
          disabled={!form.question.trim() || form.options.filter((o) => o.trim()).length < 2}
          onPress={async () => {
            await run(() =>
              post(`/groups/${id}/polls`, {
                question: form.question.trim(),
                options: form.options.map((o) => o.trim()).filter(Boolean),
                multi: form.multi,
                anonymous: form.anonymous,
                closesAt: form.hours ? new Date(Date.now() + Number(form.hours) * 3600_000).toISOString() : null,
              }),
            );
            setForm({ question: '', options: ['', ''], multi: false, anonymous: false, hours: '' });
            sheet.hide();
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
