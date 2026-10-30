import { toZoned } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { DateTimeField } from '@/components/DateTimeField';
import { GroupScreen } from '@/components/GroupNav';
import { RepeatPicker } from '@/components/RepeatPicker';
import { Button, Card, Empty, Field, Loading, Muted, Segmented, Sheet, Toggle, Txt, colors, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function Events() {
  const { id, new: openNew } = useLocalSearchParams<{ id: string; new?: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const router = useRouter();
  const [view, setView] = useState<'agenda' | 'month'>('agenda');
  const [month, setMonth] = useState(() => new Date());
  const tz = g.group?.timezone ?? 'Africa/Cairo';
  const range = useMemo(() => {
    if (view === 'agenda') return { from: new Date(Date.now() - 3 * 3600_000), to: new Date(Date.now() + 35 * 86_400_000) };
    const from = new Date(month.getFullYear(), month.getMonth(), 1);
    return { from, to: new Date(month.getFullYear(), month.getMonth() + 1, 1) };
  }, [view, month]);
  const q = useQuery({ queryKey: ['group', id, 'events', view, range.from.toISOString()], queryFn: () => get(`/groups/${id}/events?from=${range.from.toISOString()}&to=${range.to.toISOString()}`) });
  const { run, pending } = useAct(id);
  const sheet = useSheet();
  const defaults = (g.group?.settings ?? {}) as { eventCapacity?: number; waitlist?: boolean };
  const [form, setForm] = useState({ title: '', startsAt: null as Date | null, rrule: null as string | null, location: '', capacity: '', waitlist: true, reminder: '60' });
  useEffect(() => {
    if (g.group) setForm((f) => ({ ...f, capacity: defaults.eventCapacity ? String(defaults.eventCapacity) : '', waitlist: defaults.waitlist ?? false }));
  }, [g.group?.id]);
  useEffect(() => {
    if (openNew) sheet.show();
  }, [openNew]);

  async function create() {
    const res = await run(() =>
      post(`/groups/${id}/events`, {
        title: form.title.trim(),
        startsAt: form.startsAt!.toISOString(),
        rrule: form.rrule,
        location: form.location || undefined,
        capacity: form.capacity ? Number(form.capacity) : null,
        waitlist: form.waitlist,
        reminderMin: form.reminder ? Number(form.reminder) : null,
      }),
    );
    sheet.hide();
    setForm((f) => ({ ...f, title: '', startsAt: null, rrule: null, location: '' }));
    router.push(`/g/${id}/event/${res.id}`);
  }

  const byDay = new Map<string, any[]>();
  for (const e of q.data ?? []) {
    const key = fmt.date(e.startsAt, tz);
    byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }

  return (
    <GroupScreen id={id} active="events">
      <Segmented value={view} onChange={setView} testID="events-view" options={[{ value: 'agenda', label: t('events.agenda') }, { value: 'month', label: t('events.month') }]} />
      {g.can('items.create') && <Button title={t('events.new', { event: g.v('event') })} onPress={sheet.show} testID="new-event" style={{ marginBottom: 12 }} color={g.group?.color} />}
      {q.isLoading && <Loading />}
      {view === 'month' && <MonthGrid month={month} setMonth={setMonth} events={q.data ?? []} tz={tz} color={g.group?.color ?? colors.primary} />}
      {view === 'agenda' && q.data?.length === 0 && <Empty title={t('events.noEvents')} />}
      {[...byDay.entries()].map(([day, list]) => (
        <View key={day} style={{ marginBottom: 8 }}>
          <Muted style={{ fontWeight: '700', marginBottom: 6 }}>{day}</Muted>
          {list.map((e) => (
            <Card key={e.id} accent={g.group?.color} onPress={() => router.push(`/g/${id}/event/${e.id}`)} testID={`event-${e.id}`}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Txt style={{ fontWeight: '700', fontSize: 16, flex: 1 }}>
                  {e.seriesId ? '🔁 ' : ''}
                  {e.title}
                </Txt>
                <Txt style={{ color: colors.muted }}>{fmt.time(e.startsAt, tz)}</Txt>
              </View>
              <Muted style={{ marginTop: 4 }}>
                {[e.location, e.capacity ? t('events.spots', { going: fmt.number(e.going), capacity: fmt.number(e.capacity) }) : t('events.goingCount', { count: e.going }), e.myStatus ? t(`events.${e.myStatus === 'waitlist' ? 'going' : e.myStatus}`) : null].filter(Boolean).join(' · ')}
              </Muted>
            </Card>
          ))}
        </View>
      ))}
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('events.new', { event: g.v('event') })} testID="event-sheet">
        <Field label={t('events.title')} value={form.title} onChangeText={(s) => setForm({ ...form, title: s })} testID="event-title" />
        <DateTimeField value={form.startsAt} onChange={(d) => setForm({ ...form, startsAt: d })} tz={tz} testID="event-when" />
        <RepeatPicker value={form.rrule} onChange={(r) => setForm({ ...form, rrule: r })} date={form.startsAt} />
        <Field label={t('events.location')} value={form.location} onChangeText={(s) => setForm({ ...form, location: s })} />
        <Field label={t('events.capacity')} value={form.capacity} onChangeText={(s) => setForm({ ...form, capacity: s.replace(/\D/g, '') })} inputMode="numeric" testID="event-capacity" />
        <Toggle label={t('events.waitlist')} value={form.waitlist} onChange={(v) => setForm({ ...form, waitlist: v })} />
        <Field label={t('events.reminder')} value={form.reminder} onChangeText={(s) => setForm({ ...form, reminder: s.replace(/\D/g, '') })} inputMode="numeric" />
        <Button title={t('common.create')} onPress={create} disabled={!form.title.trim() || !form.startsAt} loading={pending} testID="event-save" color={g.group?.color} />
      </Sheet>
    </GroupScreen>
  );
}

function MonthGrid({ month, setMonth, events, tz, color }: { month: Date; setMonth: (d: Date) => void; events: any[]; tz: string; color: string }) {
  const fmt = useFormat();
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startPad = (first.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const counts = new Map<number, number>();
  for (const e of events) {
    const z = toZoned(new Date(e.startsAt).getTime(), tz);
    if (z.month === month.getMonth() + 1) counts.set(z.day, (counts.get(z.day) ?? 0) + 1);
  }
  const cells = [...Array(startPad).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <Card testID="month-grid">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Pressable onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} style={{ padding: 10 }} accessibilityRole="button" accessibilityLabel="previous month">
          <Text style={{ fontSize: 18 }}>◀</Text>
        </Pressable>
        <Txt style={{ fontWeight: '700' }}>{fmt.monthTitle(first)}</Txt>
        <Pressable onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} style={{ padding: 10 }} accessibilityRole="button" accessibilityLabel="next month">
          <Text style={{ fontSize: 18 }}>▶</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((d, i) => (
          <View key={i} style={{ width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
            {d ? (
              <>
                <Txt style={{ fontSize: 14 }}>{fmt.number(d)}</Txt>
                {counts.get(d) ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginTop: 2 }} /> : null}
              </>
            ) : null}
          </View>
        ))}
      </View>
    </Card>
  );
}
