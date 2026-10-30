import { getTemplate } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Avatar, Button, Card, Chip, Muted, Row, Section, Txt, colors } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat, usePrefs } from '@/lib/prefs';

/** Group home: dashboard cards (next event, my tasks, balance, latest announcement), suggestions from the template. */
export default function GroupHome() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { lang } = usePrefs();
  const router = useRouter();
  const { run } = useAct(id);
  const has = (m: string) => !!g.group?.modules.includes(m);
  const events = useQuery({ queryKey: ['group', id, 'events'], queryFn: () => get(`/groups/${id}/events`), enabled: has('events') });
  const tasks = useQuery({ queryKey: ['group', id, 'tasks', 'mine'], queryFn: () => get(`/groups/${id}/tasks?mine=1`), enabled: has('tasks') });
  const balances = useQuery({ queryKey: ['group', id, 'balances'], queryFn: () => get(`/groups/${id}/balances`), enabled: has('expenses') && g.can('money.read') });
  const anns = useQuery({ queryKey: ['group', id, 'announcements'], queryFn: () => get(`/groups/${id}/announcements`), enabled: has('chat') });
  const countdowns = useQuery({ queryKey: ['group', id, 'countdowns'], queryFn: () => get(`/groups/${id}/countdowns`), enabled: has('focus') });
  const subgroups = useQuery({ queryKey: ['group', id, 'subgroups'], queryFn: () => get(`/groups/${id}/subgroups`), enabled: !!g.group && !g.group.parentId });
  const next = events.data?.find((e: any) => new Date(e.startsAt).getTime() > Date.now() - 3 * 3600_000);
  const myNet = g.me ? balances.data?.balances?.[g.me.userId] ?? 0 : 0;
  const tpl = g.group ? getTemplate(g.group.type) : null;

  return (
    <GroupScreen id={id}>
      {g.group && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 4 }}>
          {g.members.slice(0, 6).map((m) => (
            <Avatar key={m.userId} name={m.displayName} size={30} />
          ))}
          <Muted style={{ marginStart: 8, flex: 1 }}>{t('common.members', { count: g.members.length })}</Muted>
          <Button small kind="secondary" title={t('group.invite')} onPress={() => router.push(`/g/${id}/invite`)} testID="open-invite" />
        </View>
      )}

      {countdowns.data?.[0] && (
        <Card accent={g.group?.color} onPress={() => router.push(`/g/${id}/focus`)} testID="home-countdown">
          <Txt style={{ fontWeight: '700' }}>⏳ {countdowns.data[0].title}</Txt>
          <Txt style={{ fontSize: 24, fontWeight: '800', color: g.group?.color }}>
            {t('study.daysLeft', { count: Math.max(0, Math.ceil((new Date(countdowns.data[0].at).getTime() - Date.now()) / 86_400_000)) })}
          </Txt>
        </Card>
      )}

      {has('events') && (
        <Section title={t('group.nextEvent')}>
          {next ? (
            <Card accent={g.group?.color} onPress={() => router.push(`/g/${id}/event/${next.id}`)} testID="home-next-event">
              <Txt style={{ fontSize: 17, fontWeight: '700' }}>{next.title}</Txt>
              <Muted style={{ marginTop: 4 }}>
                {fmt.dateTime(next.startsAt, next.tz)}
                {next.capacity ? ` · ${t('events.spots', { going: fmt.number(next.going), capacity: fmt.number(next.capacity) })}` : ''}
              </Muted>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {(['going', 'maybe', 'no'] as const).map((s) => (
                  <Chip key={s} label={t(`events.${s}`)} active={next.myStatus === s || (s === 'going' && next.myStatus === 'waitlist')} onPress={() => run(() => post(`/groups/${id}/events/${next.id}/rsvp`, { status: s }))} color={g.group?.color} />
                ))}
              </View>
            </Card>
          ) : (
            <Card>
              <Muted>{t('events.noEvents')}</Muted>
            </Card>
          )}
        </Section>
      )}

      {has('tasks') && (
        <Section title={t('group.myTasks', { tasks: g.v('tasks') })}>
          <Card style={{ paddingVertical: 4 }}>
            {(tasks.data ?? []).slice(0, 3).map((x: any) => (
              <Row key={x.id} title={x.title} subtitle={x.dueAt ? fmt.dateTime(x.dueAt) : null} onPress={() => router.push(`/g/${id}/task/${x.id}`)} />
            ))}
            {tasks.data?.length === 0 && <Row title={t('group.nothingYet')} />}
          </Card>
        </Section>
      )}

      {has('expenses') && g.can('money.read') && (
        <Section title={t('group.balance')}>
          <Card onPress={() => router.push(`/g/${id}/expenses`)} testID="home-balance">
            <Txt style={{ fontSize: 17, fontWeight: '700', color: myNet < 0 ? colors.danger : myNet > 0 ? colors.good : colors.text }}>
              {myNet === 0 ? t('group.allSettled') : myNet > 0 ? t('group.youAreOwed', { amount: fmt.money(myNet, g.group?.currency) }) : t('group.youOwe', { amount: fmt.money(-myNet, g.group?.currency) })}
            </Txt>
          </Card>
        </Section>
      )}

      {has('chat') && anns.data?.[0] && (
        <Section title={t('group.latest')}>
          <Card onPress={() => router.push(`/g/${id}/chat`)}>
            <Txt>📣 {anns.data[0].body}</Txt>
            <Muted style={{ marginTop: 4 }}>{g.memberName(anns.data[0].userId)}</Muted>
          </Card>
        </Section>
      )}

      {tpl && has('events') && events.data?.length === 0 && tpl.starters.events?.[0] && (
        <Card testID="home-suggestion">
          <Muted>{t('group.suggestion')}</Muted>
          <Txt style={{ marginVertical: 6 }}>{tpl.starters.events[0].title[lang]}</Txt>
          <Button small title={t('group.addSuggested')} onPress={() => router.push(`/g/${id}/events?new=1`)} />
        </Card>
      )}

      {subgroups.data?.some((s: any) => s.member) && (
        <Section title={t('company.departments')}>
          {subgroups.data.filter((s: any) => s.member).map((s: any) => (
            <Card key={s.id} onPress={() => router.push(`/g/${s.id}`)} testID={`home-department-${s.id}`}>
              <Txt style={{ fontWeight: '600' }}>{`${s.emoji} ${s.name}`}</Txt>
            </Card>
          ))}
        </Section>
      )}

      <Button kind="ghost" title={t('group.activity')} onPress={() => router.push(`/g/${id}/activity`)} testID="open-activity" />
    </GroupScreen>
  );
}
