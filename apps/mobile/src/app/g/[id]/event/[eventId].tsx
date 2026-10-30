import { parseMajorToMinor } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Linking, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { EventExtras } from '@/components/EventExtras';
import { Button, Card, Chip, ErrorView, Field, Loading, Muted, Row, Screen, Section, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { del, get, post } from '@/lib/api';
import { confirmAsk, useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function EventDetail() {
  const { id, eventId } = useLocalSearchParams<{ id: string; eventId: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const router = useRouter();
  const q = useQuery({ queryKey: ['group', id, 'event', eventId], queryFn: () => get(`/groups/${id}/events/${eventId}`) });
  const { run, pending } = useAct(id);
  const split = useSheet();
  const [amount, setAmount] = useState('');
  const [nudged, setNudged] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  if (q.isLoading) return <Screen title="" back><Loading /></Screen>;
  if (q.error) return <Screen title="" back><ErrorView error={q.error} /></Screen>;
  const { event: e, rsvps, myStatus } = q.data;
  const going = rsvps.filter((r: any) => r.status === 'going');
  const waitlist = rsvps.filter((r: any) => r.status === 'waitlist');
  const maybe = rsvps.filter((r: any) => r.status === 'maybe');
  const myPos = waitlist.find((r: any) => r.userId === g.me?.userId)?.waitlistPos;
  const tz = e.tz;
  const need = e.capacity ? Math.max(0, e.capacity - going.length) : 0;
  const shareText = (link: string) => t('events.shareCard', { emoji: g.group?.emoji ?? '', title: e.title, time: fmt.dateTime(e.startsAt, tz), going: e.capacity ? `${going.length}/${e.capacity}` : going.length, link });
  const guestLink = async () => (await post(`/groups/${id}/guest-links`, { entity: 'event', entityId: e.id })).url as string;

  return (
    <Screen title={g.v('event')} back accent={g.group?.color} testID="event-detail">
      <Card accent={g.group?.color}>
        <Txt style={{ fontSize: 22, fontWeight: '800' }} testID="event-title-text">
          {e.title}
        </Txt>
        <Muted style={{ marginTop: 6, fontSize: 15 }}>{fmt.dateTime(e.startsAt, tz)}</Muted>
        {e.location ? <Muted style={{ marginTop: 4 }}>📍 {e.location}</Muted> : null}
        {e.capacity ? (
          <Txt style={{ marginTop: 10, fontSize: 18, fontWeight: '700', color: need === 0 ? colors.warn : colors.text }} testID="event-spots">
            {t('events.spots', { going: fmt.number(going.length), capacity: fmt.number(e.capacity) })}
            {need === 0 ? ` · ${t('events.full')}` : ''}
          </Txt>
        ) : (
          <Txt style={{ marginTop: 10, fontWeight: '700' }}>{t('events.goingCount', { count: going.length })}</Txt>
        )}
      </Card>

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['going', 'maybe', 'no'] as const).map((s) => (
          <Chip
            key={s}
            label={s === 'going' && myStatus === 'waitlist' ? t('events.waitlisted', { pos: fmt.number(myPos ?? 0) }) : t(`events.${s}`)}
            active={myStatus === s || (s === 'going' && myStatus === 'waitlist')}
            color={g.group?.color}
            onPress={() => run(() => post(`/groups/${id}/events/${eventId}/rsvp`, { status: s }))}
            testID={`rsvp-${s}`}
          />
        ))}
      </View>

      <Section title={t('events.whosIn')}>
        <Card style={{ paddingVertical: 4 }} testID="event-going-list">
          {going.length === 0 && <Row title="—" />}
          {going.map((r: any, i: number) => (
            <Row key={r.userId} title={`${fmt.number(i + 1)}. ${r.displayName ?? g.memberName(r.userId)}`} />
          ))}
          {maybe.map((r: any) => (
            <Row key={r.userId} title={`? ${r.displayName ?? g.memberName(r.userId)}`} subtitle={t('events.maybe')} />
          ))}
        </Card>
        {waitlist.length > 0 && (
          <Card style={{ paddingVertical: 4 }} testID="event-waitlist">
            {waitlist.map((r: any) => (
              <Row key={r.userId} title={r.displayName ?? g.memberName(r.userId)} subtitle={t('events.waitlisted', { pos: fmt.number(r.waitlistPos) })} />
            ))}
          </Card>
        )}
      </Section>

      {g.has('teams') && g.me && <EventExtras groupId={id} event={e} going={going} memberName={(u) => going.find((x: any) => x.userId === u)?.displayName ?? g.memberName(u)} me={g.me.userId} color={g.group?.color ?? colors.primary} members={g.members} />}

      <View style={{ gap: 10 }}>
        {g.has('expenses') && g.can('money.write') && going.length > 0 && (
          <Button title={`💸 ${t('events.splitCost', { event: g.v('event') })}`} onPress={split.show} testID="split-cost" color={g.group?.color} />
        )}
        {e.capacity && need > 0 && g.can('items.create') ? (
          <Button
            kind="secondary"
            title={nudged !== null ? t('events.nudged', { count: nudged }) : `📣 ${t('events.nudge', { count: need })}`}
            onPress={async () => {
              const res = await run(() => post(`/groups/${id}/events/${eventId}/nudge`));
              setNudged(res.notified);
            }}
          />
        ) : null}
        <Button kind="secondary" title={t('common.whatsapp')} onPress={() => run(async () => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(shareText(await guestLink()))}`))} testID="event-whatsapp" />
        {g.can('items.create') && (
          <Button
            kind="secondary"
            title={copied ? t('reach.linkCopied') : t('reach.copyLink')}
            testID="event-guest-link"
            onPress={() =>
              run(async () => {
                await Clipboard.setStringAsync(await guestLink());
                setCopied(true);
              })
            }
          />
        )}
        {(e.createdBy === g.me?.userId || g.can('items.manage')) && (
          <Button
            kind="ghost"
            color={colors.danger}
            title={t('events.cancel')}
            onPress={async () => {
              if (!(await confirmAsk(t('events.cancel')))) return;
              await run(() => del(`/groups/${id}/events/${eventId}`));
              router.back();
            }}
          />
        )}
      </View>

      <Sheet visible={split.open} onClose={split.hide} title={t('events.splitCost', { event: g.v('event') })} testID="split-sheet">
        <Field label={`${t('events.amount')} (${g.group?.currency})`} value={amount} onChangeText={setAmount} inputMode="decimal" testID="split-amount" />
        {parseMajorToMinor(amount) ? (
          <Muted style={{ marginBottom: 12 }}>
            {going.length} × {fmt.money(Math.floor(parseMajorToMinor(amount)! / going.length), g.group?.currency)}
          </Muted>
        ) : null}
        <Button
          title={t('common.confirm')}
          disabled={!parseMajorToMinor(amount)}
          loading={pending}
          testID="split-save"
          onPress={async () => {
            await run(() => post(`/groups/${id}/events/${eventId}/split`, { amount: parseMajorToMinor(amount) }));
            split.hide();
            setAmount('');
            router.push(`/g/${id}/expenses`);
          }}
        />
      </Sheet>
    </Screen>
  );
}
