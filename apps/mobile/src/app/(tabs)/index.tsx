import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Empty, ErrorView, GroupTag, Loading, Muted, Row, Screen, Section, Txt, colors } from '@/components/ui';
import { Check } from '@/components/Check';
import { KidsHome } from '@/components/KidsHome';
import { authClient } from '@/lib/auth';
import { get, post } from '@/lib/api';
import { useAct } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function TodayTab() {
  const { data: session } = authClient.useSession();
  const user = session?.user as { isChild?: boolean; name?: string } | undefined;
  if (user?.isChild) return <KidsHome name={user.name ?? ''} />;
  return <Today />;
}

function Today() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const router = useRouter();
  const q = useQuery({ queryKey: ['today'], queryFn: () => get('/me/today') });
  const { run } = useAct();
  const d = q.data;

  if (q.isLoading) return <Screen title={t('today.title')}><Loading /></Screen>;
  if (q.error) return <Screen title={t('today.title')}><ErrorView error={q.error} onRetry={() => q.refetch()} /></Screen>;

  const now = new Date(d.now);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const overdue = d.tasks.filter((x: any) => x.overdue);
  const todayTasks = d.tasks.filter((x: any) => !x.overdue && new Date(x.dueAt) <= endOfToday);
  const weekTasks = d.tasks.filter((x: any) => !x.overdue && new Date(x.dueAt) > endOfToday);
  const nothing = !d.tasks.length && !d.events.length && !d.money.length && !d.toConfirm.length && !d.announcements.length && !(d.extra?.length) && !(d.gameya?.length);

  const taskRow = (x: any) => (
    <Card key={x.id} accent={x.groupColor} testID={`today-task-${x.id}`} style={{ paddingVertical: 4 }}>
      <Row
        title={x.title}
        subtitle={x.dueAt ? fmt.dateTime(x.dueAt) : null}
        left={<Check label={t('tasks.complete')} onPress={() => run(() => post(`/groups/${x.groupId}/tasks/${x.id}/complete`))} testID={`today-complete-${x.id}`} />}
        right={<GroupTag emoji={x.groupEmoji} name={x.groupName} color={x.groupColor} />}
        onPress={() => router.push(`/g/${x.groupId}/task/${x.id}`)}
        chevron={false}
      />
    </Card>
  );

  return (
    <Screen title={t('today.title')} testID="today-screen" right={<Muted>{fmt.date(now)}</Muted>}>
      {nothing && (
        <Empty
          title={t('today.empty')}
          hint={t('today.emptyHint')}
          testID="today-empty"
          action={
            <View style={{ gap: 8, width: '100%', maxWidth: 320 }}>
              <Button title={t('groups.new')} onPress={() => router.push('/new-group')} testID="today-new-group" />
              <Button kind="secondary" title={t('groups.join')} onPress={() => router.push('/join/enter')} testID="today-join" />
            </View>
          }
        />
      )}

      {d.announcements.length > 0 && (
        <Section title={t('today.announcements')}>
          {d.announcements.map((a: any) => (
            <Card key={a.id} accent={a.groupColor} testID={`today-ann-${a.id}`}>
              <GroupTag emoji={a.groupEmoji} name={a.groupName} color={a.groupColor} />
              <Txt style={{ marginVertical: 8, fontSize: 16 }}>📣 {a.body}</Txt>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Muted>{a.authorName}</Muted>
                <Button small kind="secondary" title={t('today.markRead')} onPress={() => run(() => post(`/groups/${a.groupId}/announcements/${a.id}/read`, {}))} />
              </View>
            </Card>
          ))}
        </Section>
      )}

      {d.toConfirm.length > 0 && (
        <Section title={t('today.toConfirm')}>
          {d.toConfirm.map((s: any) => (
            <Card key={s.id} accent={s.groupColor} testID={`today-confirm-${s.id}`}>
              <GroupTag emoji={s.groupEmoji} name={s.groupName} color={s.groupColor} />
              <Txt style={{ marginVertical: 8 }}>{t('today.confirmPayment', { name: s.fromName, amount: fmt.money(s.amountMinor) })}</Txt>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button small title={t('common.confirm')} onPress={() => run(() => post(`/groups/${s.groupId}/settlements/${s.id}/confirm`))} testID={`confirm-${s.id}`} />
                <Button small kind="secondary" title={t('common.reject')} onPress={() => run(() => post(`/groups/${s.groupId}/settlements/${s.id}/reject`))} />
              </View>
            </Card>
          ))}
        </Section>
      )}

      {overdue.length > 0 && <Section title={t('today.overdue')}>{overdue.map(taskRow)}</Section>}
      {todayTasks.length > 0 && <Section title={t('today.dueToday')}>{todayTasks.map(taskRow)}</Section>}

      {d.events.length > 0 && (
        <Section title={t('today.upcoming')}>
          {d.events.map((e: any) => (
            <Card key={e.id} accent={e.groupColor} testID={`today-event-${e.id}`} onPress={() => router.push(`/g/${e.groupId}/event/${e.id}`)}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Txt style={{ fontSize: 16, fontWeight: '600', flex: 1 }}>{e.title}</Txt>
                <GroupTag emoji={e.groupEmoji} name={e.groupName} color={e.groupColor} />
              </View>
              <Muted style={{ marginTop: 4 }}>
                {fmt.dateTime(e.startsAt, e.tz)}
                {e.capacity ? ` · ${t('events.spots', { going: fmt.number(e.going), capacity: fmt.number(e.capacity) })}` : ` · ${t('events.goingCount', { count: e.going, defaultValue: '' }).replace(String(e.going), fmt.number(e.going))}`}
              </Muted>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {(['going', 'maybe', 'no'] as const).map((s) => (
                  <Chip
                    key={s}
                    label={e.myStatus === 'waitlist' && s === 'going' ? t('events.waitlisted', { pos: '' }) : t(`events.${s}`)}
                    active={e.myStatus === s || (s === 'going' && e.myStatus === 'waitlist')}
                    onPress={() => run(() => post(`/groups/${e.groupId}/events/${e.id}/rsvp`, { status: s }))}
                    testID={`today-rsvp-${s}-${e.id}`}
                  />
                ))}
              </View>
            </Card>
          ))}
        </Section>
      )}

      {d.gameya?.length > 0 && (
        <Section title={t('gameya.title')}>
          {d.gameya.map((x: any) => (
            <Card key={x.gameyaId} accent={x.color} testID={`today-gameya-${x.gameyaId}`} onPress={() => router.push(`/g/${x.groupId}/gameya/${x.gameyaId}`)}>
              <GroupTag emoji={x.emoji} name={x.groupName} color={x.color} />
              <Txt style={{ marginTop: 6, fontWeight: '600' }}>{`💰 ${x.title} · ${t('gameya.monthOf', { n: fmt.number(x.month), total: fmt.number(x.months) })}`}</Txt>
              {x.due && (
                <Txt style={{ marginTop: 4, color: x.due.late ? colors.danger : colors.text, fontWeight: '600' }}>{t('gameya.dueBy', { amount: fmt.money(x.due.amount, x.currency), date: fmt.date(x.due.dueAt) })}</Txt>
              )}
              <Muted style={{ marginTop: 4 }}>{t('gameya.yourTurn', { n: fmt.number(x.myTurn), month: fmt.monthTitle(new Date(`${x.myTurnMonth}-15T12:00:00Z`), 'UTC') })}</Muted>
            </Card>
          ))}
        </Section>
      )}

      {d.money.length > 0 && (
        <Section title={t('today.money')}>
          {d.money.map((m: any) => (
            <Card key={m.groupId} accent={m.groupColor} testID={`today-money-${m.groupId}`} onPress={() => router.push(`/g/${m.groupId}/expenses`)}>
              <GroupTag emoji={m.groupEmoji} name={m.groupName} color={m.groupColor} />
              {m.owe.map((o: any) => (
                <Txt key={o.to} style={{ marginTop: 6, color: colors.danger, fontWeight: '600' }}>
                  {t('today.youOwe', { name: o.name })} · {fmt.money(o.amount, m.currency)}
                </Txt>
              ))}
              {m.owed.map((o: any) => (
                <Txt key={o.from} style={{ marginTop: 6, color: colors.good, fontWeight: '600' }}>
                  {t('today.owesYou', { name: o.name })} · {fmt.money(o.amount, m.currency)}
                </Txt>
              ))}
              {m.owe.length > 0 && <Button small style={{ marginTop: 10, alignSelf: 'flex-start' }} title={t('today.settleUp')} onPress={() => router.push(`/g/${m.groupId}/expenses?settle=1`)} testID={`today-settle-${m.groupId}`} />}
            </Card>
          ))}
        </Section>
      )}

      {Array.isArray(d.extra) && d.extra.length > 0 && (
        <Section title={t('today.thisWeek')}>
          {d.extra.map((x: any, i: number) => (
            <Card key={i} accent={x.groupColor} onPress={x.href ? () => router.push(x.href) : undefined}>
              <GroupTag emoji={x.groupEmoji} name={x.groupName} color={x.groupColor} />
              <Txt style={{ marginTop: 6 }}>{x.text}</Txt>
            </Card>
          ))}
        </Section>
      )}

      {weekTasks.length > 0 && <Section title={t('today.thisWeek')}>{weekTasks.map(taskRow)}</Section>}
    </Screen>
  );
}
