import { fromZoned, localDayKey } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Chip, Field, Muted, Row, Section, Segmented, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function Shifts() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'shifts'], queryFn: () => get(`/groups/${id}/shifts`) });
  const newSheet = useSheet();
  const [swapFor, setSwapFor] = useState<string | null>(null);
  const [view, setView] = useState<'mine' | 'all'>('all');
  const tz = g.group?.timezone ?? 'Africa/Cairo';
  const color = g.group?.color ?? colors.primary;
  const me = g.me?.userId;
  const manager = g.can('approve');
  const staff = g.members.filter((m) => m.role !== 'child' && m.role !== 'guest');
  const [form, setForm] = useState({ userId: '' as string | null, day: localDayKey(Date.now() + 86_400_000, tz), from: '09:00', to: '17:00', label: '', repeat: '1' });
  const rows: any[] = (q.data?.shifts ?? []).filter((s: any) => view === 'all' || s.userId === me || s.userId === null);
  const days = [...new Set(rows.map((s) => localDayKey(new Date(s.startsAt).getTime(), tz)))];
  const name = (u: string | null) => (u ? (u === me ? t('common.you') : g.memberName(u)) : t('shifts.open'));
  const toInstant = (day: string, hm: string) => {
    const [y, mo, d] = day.split('-').map(Number);
    const [h, mi] = hm.split(':').map(Number);
    return new Date(fromZoned({ year: y, month: mo, day: d, hour: h, minute: mi }, tz)).toISOString();
  };
  const validTime = (s: string) => /^\d{2}:\d{2}$/.test(s);

  return (
    <GroupScreen id={id} active="shifts">
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Segmented<'mine' | 'all'> value={view} onChange={setView} options={[{ value: 'all', label: t('shifts.all') }, { value: 'mine', label: t('shifts.mine') }]} />
        </View>
        {manager && <Button small color={color} title={`＋ ${t('shifts.newShift')}`} onPress={newSheet.show} testID="new-shift" />}
      </View>

      {q.data?.swaps.length > 0 && (
        <Section title={t('shifts.swaps')}>
          {q.data.swaps.map((sw: any) => {
            const s = q.data.shifts.find((x: any) => x.id === sw.shiftId);
            return (
              <Card key={sw.id} testID={`swap-${sw.id}`}>
                <Txt style={{ fontWeight: '700' }}>{t('shifts.asks', { from: name(s?.userId ?? null), to: name(sw.toUserId) })}</Txt>
                {s && <Muted>{`${fmt.date(s.startsAt, tz)} · ${fmt.time(s.startsAt, tz)}–${fmt.time(s.endsAt, tz)}`}</Muted>}
                <Muted>{sw.peerAcceptedAt ? t('shifts.waitingManager') : t('shifts.waitingPeer', { name: name(sw.toUserId) })}</Muted>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                  {sw.toUserId === me && !sw.peerAcceptedAt && <Button small color={color} title={t('shifts.accept')} onPress={() => run(() => post(`/groups/${id}/shift-swaps/${sw.id}/accept`))} testID={`swap-accept-${sw.id}`} />}
                  {manager && sw.peerAcceptedAt && <Button small color={color} title={t('shifts.approve')} onPress={() => run(() => post(`/groups/${id}/shift-swaps/${sw.id}/approve`))} testID={`swap-approve-${sw.id}`} />}
                  {(manager || sw.toUserId === me || sw.requesterId === me) && <Button small kind="secondary" title={t('shifts.reject')} onPress={() => run(() => post(`/groups/${id}/shift-swaps/${sw.id}/reject`))} />}
                </View>
              </Card>
            );
          })}
        </Section>
      )}

      {days.map((day) => (
        <Section key={day} title={fmt.date(`${day}T12:00:00Z`, 'UTC')}>
          {q.data?.timeOff.filter((l: any) => l.startDay <= day && l.endDay >= day).map((l: any) => <Muted key={l.id}>{`${t('shifts.off')}: ${name(l.userId)}`}</Muted>)}
          {rows.filter((s) => localDayKey(new Date(s.startsAt).getTime(), tz) === day).map((s) => {
            const future = new Date(s.startsAt).getTime() > Date.now();
            const pendingSwap = q.data.swaps.some((sw: any) => sw.shiftId === s.id);
            return (
              <Card key={s.id} accent={s.userId === me ? color : s.userId === null ? colors.warn : undefined} style={{ paddingVertical: 4 }} testID={`shift-${s.id}`}>
                <Row
                  title={`${fmt.time(s.startsAt, tz)}–${fmt.time(s.endsAt, tz)} · ${name(s.userId)}`}
                  subtitle={s.label || undefined}
                  right={
                    future && !pendingSwap ? (
                      s.userId === me ? (
                        <Button small kind="secondary" title={`🔁 ${t('shifts.swap')}`} onPress={() => setSwapFor(s.id)} testID={`swap-open-${s.id}`} />
                      ) : s.userId === null ? (
                        <Button small color={color} title={t('shifts.claim')} onPress={() => run(() => post(`/groups/${id}/shifts/${s.id}/swap`, { toUserId: me }))} testID={`claim-${s.id}`} />
                      ) : undefined
                    ) : undefined
                  }
                />
              </Card>
            );
          })}
        </Section>
      ))}

      <Sheet visible={!!swapFor} onClose={() => setSwapFor(null)} title={t('shifts.swapTo')} testID="swap-sheet">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {staff.filter((m) => m.userId !== me).map((m) => (
            <Chip key={m.userId} label={m.displayName} color={color} onPress={async () => (await run(() => post(`/groups/${id}/shifts/${swapFor}/swap`, { toUserId: m.userId })), setSwapFor(null))} testID={`swap-to-${m.userId}`} />
          ))}
        </View>
        <Button kind="secondary" title={t('shifts.giveUp')} onPress={async () => (await run(() => post(`/groups/${id}/shifts/${swapFor}/swap`, { toUserId: null })), setSwapFor(null))} />
      </Sheet>

      <Sheet visible={newSheet.open} onClose={newSheet.hide} title={t('shifts.newShift')} testID="shift-sheet">
        <Muted>{t('shifts.who')}</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 }}>
          <Chip label={t('shifts.open')} active={form.userId === null} color={color} onPress={() => setForm({ ...form, userId: null })} />
          {staff.map((m) => (
            <Chip key={m.userId} label={m.displayName} active={form.userId === m.userId} color={color} onPress={() => setForm({ ...form, userId: m.userId })} testID={`shift-who-${m.userId}`} />
          ))}
        </View>
        <Field label={t('shifts.day')} value={form.day} onChangeText={(s) => setForm({ ...form, day: s })} style={{ writingDirection: 'ltr' }} testID="shift-day" />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label={t('shifts.from')} value={form.from} onChangeText={(s) => setForm({ ...form, from: s })} style={{ writingDirection: 'ltr' }} testID="shift-from" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label={t('shifts.to')} value={form.to} onChangeText={(s) => setForm({ ...form, to: s })} style={{ writingDirection: 'ltr' }} testID="shift-to" />
          </View>
        </View>
        <Field label={t('shifts.label')} value={form.label} onChangeText={(s) => setForm({ ...form, label: s })} testID="shift-label" />
        <Field label={t('shifts.repeat')} value={form.repeat} onChangeText={(s) => setForm({ ...form, repeat: s })} inputMode="numeric" />
        <Button
          title={t('common.save')}
          color={color}
          loading={pending}
          disabled={!/^\d{4}-\d{2}-\d{2}$/.test(form.day) || !validTime(form.from) || !validTime(form.to) || form.userId === ''}
          testID="shift-save"
          onPress={async () => {
            const startsAt = toInstant(form.day, form.from);
            let endsAt = toInstant(form.day, form.to);
            if (endsAt <= startsAt) endsAt = new Date(new Date(endsAt).getTime() + 86_400_000).toISOString(); // overnight
            await run(() => post(`/groups/${id}/shifts`, { userId: form.userId, startsAt, endsAt, label: form.label.trim(), repeatWeeks: Math.min(12, Math.max(1, Number(form.repeat) || 1)) }));
            newSheet.hide();
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
