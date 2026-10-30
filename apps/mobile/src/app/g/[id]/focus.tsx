import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DateTimeField } from '@/components/DateTimeField';
import { GroupScreen } from '@/components/GroupNav';
import { Avatar, Button, Card, Field, Muted, Row, Section, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';
import { realtime } from '@/lib/realtime';

const POMODORO = 25 * 60;
const BREAK = 5 * 60;

/** Focus together: a live Pomodoro room. Presence travels over the WebSocket; sessions count minutes and streaks. */
export default function Focus() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { run } = useAct(id);
  const focus = useQuery({ queryKey: ['group', id, 'focus'], queryFn: () => get(`/groups/${id}/focus`) });
  const countdowns = useQuery({ queryKey: ['group', id, 'countdowns'], queryFn: () => get(`/groups/${id}/countdowns`) });
  const [room, setRoom] = useState<string[]>([]);
  const [left, setLeft] = useState<number | null>(null);
  const [phase, setPhase] = useState<'focus' | 'break'>('focus');
  const phaseRef = useRef<'focus' | 'break'>('focus');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const sheet = useSheet();
  const [cd, setCd] = useState<{ title: string; at: Date | null }>({ title: '', at: null });
  const color = g.group?.color ?? colors.primary;

  useEffect(() => {
    const off = realtime.on((m) => {
      if (m.type === 'presence' && m.groupId === id && m.room === 'focus') setRoom(m.users);
    });
    return () => {
      off();
      realtime.send({ type: 'presence', groupId: id, room: 'focus', action: 'leave' });
      if (timer.current) clearInterval(timer.current);
    };
  }, [id]);

  function start() {
    realtime.send({ type: 'presence', groupId: id, room: 'focus', action: 'join' });
    run(() => post(`/groups/${id}/focus/start`));
    setPhase('focus');
    phaseRef.current = 'focus';
    setLeft(POMODORO);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setLeft((s) => {
        if (s === null) return s;
        if (s > 1) return s - 1;
        // the interval closure is created once, so the current phase lives in a ref
        phaseRef.current = phaseRef.current === 'focus' ? 'break' : 'focus';
        setPhase(phaseRef.current);
        return phaseRef.current === 'break' ? BREAK : POMODORO;
      });
    }, 1000);
  }
  function stop() {
    realtime.send({ type: 'presence', groupId: id, room: 'focus', action: 'leave' });
    run(() => post(`/groups/${id}/focus/stop`));
    if (timer.current) clearInterval(timer.current);
    setLeft(null);
  }

  const active = new Set([...room, ...(focus.data?.active ?? []).map((a: any) => a.userId)]);
  const mm = left === null ? '25:00' : `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  return (
    <GroupScreen id={id} active="focus">
      {countdowns.data?.map((c: any) => {
        const days = Math.max(0, Math.ceil((new Date(c.at).getTime() - Date.now()) / 86_400_000));
        return (
          <Card key={c.id} accent={color} testID={`countdown-${c.id}`}>
            <Txt style={{ fontSize: 18, fontWeight: '800' }}>⏳ {c.title}</Txt>
            <Txt style={{ fontSize: 28, fontWeight: '800', color }}>{t('study.daysLeft', { count: days })}</Txt>
            <Muted>{fmt.date(c.at)}</Muted>
          </Card>
        );
      })}
      <Card style={{ alignItems: 'center', paddingVertical: 24 }} testID="pomodoro">
        <Muted>{phase === 'focus' ? t('study.focus') : t('study.break')}</Muted>
        <Txt style={{ fontSize: 56, fontWeight: '800', color, writingDirection: 'ltr' }}>{fmt.number(Number(mm.slice(0, 2)))}:{mm.slice(3)}</Txt>
        {left === null ? <Button title={t('study.start')} color={color} onPress={start} testID="focus-start" /> : <Button kind="secondary" title={t('study.stop')} onPress={stop} testID="focus-stop" />}
        <Muted style={{ marginTop: 10 }}>{t('study.groupStreak', { count: focus.data?.groupStreak ?? 0 })}</Muted>
      </Card>
      <Section title={t('study.studyingNow', { count: active.size })}>
        <Card style={{ paddingVertical: 4 }} testID="focus-room">
          {g.members.map((m) => (
            <Row
              key={m.userId}
              title={m.displayName}
              left={<Avatar name={m.displayName} size={28} color={active.has(m.userId) ? color : colors.faint} />}
              right={<Muted>{`${active.has(m.userId) ? '🟢 ' : ''}${fmt.number(focus.data?.minutesToday?.[m.userId] ?? 0)}′`}</Muted>}
            />
          ))}
        </Card>
      </Section>
      {g.can('items.create') && <Button kind="ghost" title={`+ ${t('study.newCountdown')}`} onPress={sheet.show} testID="new-countdown" />}
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('study.newCountdown')}>
        <Field label={t('events.title')} value={cd.title} onChangeText={(s) => setCd({ ...cd, title: s })} testID="countdown-title" />
        <DateTimeField value={cd.at} onChange={(d) => setCd({ ...cd, at: d })} tz={g.group?.timezone ?? 'Africa/Cairo'} testID="countdown-at" />
        <Button
          title={t('common.save')}
          color={color}
          disabled={!cd.title.trim() || !cd.at}
          testID="countdown-save"
          onPress={async () => {
            await run(() => post(`/groups/${id}/countdowns`, { title: cd.title.trim(), at: cd.at!.toISOString() }));
            setCd({ title: '', at: null });
            sheet.hide();
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
