import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { get, post } from '@/lib/api';
import { useAct, type Member } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';
import { Button, Card, Chip, Field, Muted, Row, Section, Sheet, Txt, colors, useSheet } from './ui';

/** Sport pack on an event: balanced teams, man-of-the-match vote, carpool board. */
export function EventExtras({ groupId, event, going, memberName, me, color }: { groupId: string; event: any; going: { userId: string }[]; memberName: (id: string) => string; me: string; color: string; members: Member[] }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { run, pending } = useAct(groupId);
  const [teams, setTeams] = useState<any>(null);
  const motm = useQuery({ queryKey: ['group', groupId, 'motm', event.id], queryFn: () => get(`/groups/${groupId}/events/${event.id}/motm`) });
  const carpool = useQuery({ queryKey: ['group', groupId, 'carpool', event.id], queryFn: () => get(`/groups/${groupId}/events/${event.id}/carpool`) });
  const offer = useSheet();
  const [seats, setSeats] = useState('3');
  const [note, setNote] = useState('');
  const iPlayed = going.some((x) => x.userId === me);
  const players = going.filter((x) => !x.userId.startsWith('guest:'));

  return (
    <View>
      {players.length >= 2 && (
        <Section title={t('sport.balance')}>
          <Button kind="secondary" title={`⚖️ ${t('sport.balance')}`} onPress={() => run(() => post(`/groups/${groupId}/events/${event.id}/teams`)).then(setTeams)} testID="balance-teams" />
          {teams && (
            <Card style={{ marginTop: 8 }} testID="teams-result">
              <View style={{ flexDirection: 'row', gap: 12 }}>
                {(['a', 'b'] as const).map((k) => (
                  <View key={k} style={{ flex: 1 }}>
                    <Txt style={{ fontWeight: '800', color }}>
                      {k === 'a' ? t('sport.teamA') : t('sport.teamB')} · {fmt.number(k === 'a' ? teams.sumA : teams.sumB)}
                    </Txt>
                    {teams[k].map((u: string) => (
                      <Txt key={u}>{memberName(u)}</Txt>
                    ))}
                  </View>
                ))}
              </View>
              <Muted style={{ marginTop: 6 }}>{t('sport.diff', { diff: fmt.number(teams.diff) })}</Muted>
            </Card>
          )}
        </Section>
      )}

      <Section title={t('sport.motmTitle')}>
        <Card testID="motm">
          {!motm.data?.open ? (
            <Muted>{t('sport.notStarted')}</Muted>
          ) : (
            <>
              {motm.data.winners.length > 0 && <Txt style={{ fontWeight: '800', marginBottom: 6 }}>{t('sport.winner', { name: motm.data.winners.map(memberName).join(', ') })}</Txt>}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {players
                  .filter((p) => p.userId !== me)
                  .map((p) => (
                    <Chip
                      key={p.userId}
                      label={`${memberName(p.userId)}${motm.data.tally[p.userId] ? ` · ${fmt.number(motm.data.tally[p.userId])}` : ''}`}
                      active={motm.data.myVote === p.userId}
                      color={color}
                      onPress={iPlayed && !motm.data.myVote ? () => run(() => post(`/groups/${groupId}/events/${event.id}/motm`, { nomineeId: p.userId })) : undefined}
                      testID={`motm-${p.userId}`}
                    />
                  ))}
              </View>
              {motm.data.myVote && <Muted style={{ marginTop: 6 }}>{t('sport.voted')}</Muted>}
            </>
          )}
        </Card>
      </Section>

      <Section title={`🚗 ${t('sport.carpool')}`} right={<Button small kind="ghost" title={`+ ${t('sport.offerSeats')}`} onPress={offer.show} testID="offer-seats" />}>
        {carpool.data?.map((o: any) => {
          const riding = o.riders.includes(me);
          const full = o.riders.length >= o.seats;
          return (
            <Card key={o.id} style={{ paddingVertical: 4 }} testID={`car-${o.id}`}>
              <Row
                title={`${memberName(o.driverId)} · ${fmt.number(o.riders.length)}/${fmt.number(o.seats)}`}
                subtitle={[o.note, o.riders.map(memberName).join(', ')].filter(Boolean).join(' · ')}
                right={
                  o.driverId === me ? null : riding ? (
                    <Button small kind="secondary" title={t('sport.leaveSeat')} onPress={() => run(() => post(`/groups/${groupId}/carpool/${o.id}/leave`))} />
                  ) : (
                    <Button small color={color} title={full ? t('sport.full') : t('sport.takeSeat')} disabled={full} onPress={() => run(() => post(`/groups/${groupId}/carpool/${o.id}/join`))} testID={`take-seat-${o.id}`} />
                  )
                }
              />
            </Card>
          );
        })}
      </Section>
      <Sheet visible={offer.open} onClose={offer.hide} title={t('sport.offerSeats')}>
        <Field label={t('sport.seats')} value={seats} onChangeText={(s) => setSeats(s.replace(/\D/g, ''))} inputMode="numeric" />
        <Field label={t('sport.from')} value={note} onChangeText={setNote} />
        <Button
          title={t('common.save')}
          color={color}
          loading={pending}
          disabled={!Number(seats)}
          onPress={async () => {
            await run(() => post(`/groups/${groupId}/events/${event.id}/carpool`, { seats: Number(seats), note: note || undefined }));
            offer.hide();
          }}
        />
      </Sheet>
      <View style={{ height: 1, backgroundColor: colors.border, marginBottom: 12 }} />
    </View>
  );
}
