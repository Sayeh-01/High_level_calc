import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, ErrorView, Loading, Muted, Row, Screen, Section, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useConfig, useGroup } from '@/lib/hooks';
import { PaySheet, type PayTarget } from '@/components/PaySheet';
import { useState } from 'react';
import { useFormat } from '@/lib/prefs';

const STATUS_COLOR: Record<string, string> = { paid: colors.good, reported: colors.warn, late: colors.danger, due: colors.faint };

export default function GameyaBoard() {
  const { id, gameyaId } = useLocalSearchParams<{ id: string; gameyaId: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const router = useRouter();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'gameya', gameyaId], queryFn: () => get(`/groups/${id}/gameyas/${gameyaId}`) });
  const swapSheet = useSheet();
  const config = useConfig();
  const [pay, setPay] = useState<{ target: PayTarget; amount: number; payee: string } | null>(null);
  const color = g.group?.color ?? colors.primary;
  const cur = g.group?.currency ?? 'EGP';
  const me = g.me?.userId;
  const month = (ym: string) => fmt.monthTitle(new Date(`${ym}-15T12:00:00Z`), 'UTC');
  const name = (u: string) => (u === me ? t('common.you') : g.memberName(u));
  if (q.isLoading) return <Screen title="" back><Loading /></Screen>;
  if (q.error || !q.data) return <Screen title="" back><ErrorView error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const { gameya, months, swaps, trust, current, pot } = q.data;
  const total = months.length;
  const mine = months.find((m: any) => m.receiverId === me);
  const shown = Math.min(Math.max(current, 1), total);
  const base = `/groups/${id}/gameyas/${gameyaId}`;
  const canSwap = gameya.status === 'active' && mine && mine.position > current;
  const pendingSwaps = swaps.filter((s: any) => s.status === 'pending');

  return (
    <Screen title={`💰 ${gameya.title}`} back accent={color} testID="gameya-board">
      <Card accent={color} testID="gameya-summary">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Txt style={{ fontSize: 15, fontWeight: '700', flex: 1 }}>{gameya.status === 'done' ? t('gameya.done') : t('gameya.monthOf', { n: fmt.number(shown), total: fmt.number(total) })}</Txt>
          <Txt style={{ fontSize: 22, fontWeight: '800' }}>{fmt.money(pot, cur)}</Txt>
        </View>
        {mine && <Txt style={{ marginTop: 6, fontWeight: '600', color }} testID="gameya-my-turn">{t('gameya.yourTurn', { n: fmt.number(mine.position), month: month(mine.month) })}</Txt>}
        <Muted style={{ marginTop: 6 }}>{t('gameya.tracking')}</Muted>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {canSwap && <Button small kind="secondary" title={`🔁 ${t('gameya.swap')}`} onPress={swapSheet.show} testID="gameya-swap" />}
          {gameya.status === 'done' && g.can('approve') && (
            <Button small color={color} title={t('gameya.nextRound')} testID="gameya-next" onPress={async () => router.replace(`/g/${id}/gameya/${(await run(() => post(`${base}/next-round`))).id}`)} />
          )}
        </View>
      </Card>

      {pendingSwaps.length > 0 && (
        <Section title={t('gameya.swaps')}>
          {pendingSwaps.map((s: any) => {
            const waiting = !s.otherAcceptedAt ? t('gameya.waitingOther', { name: name(s.otherId) }) : t('gameya.waitingOrganizer');
            return (
              <Card key={s.id} testID={`swap-${s.id}`}>
                <Txt style={{ fontWeight: '700' }}>{t('gameya.swapAsk', { from: name(s.requesterId), to: name(s.otherId) })}</Txt>
                <Muted>{waiting}</Muted>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {s.otherId === me && !s.otherAcceptedAt && <Button small color={color} title={t('gameya.accept')} onPress={() => run(() => post(`${base}/swaps/${s.id}/accept`))} testID={`swap-accept-${s.id}`} />}
                  {g.can('approve') && !s.organizerApprovedAt && <Button small color={color} title={t('gameya.approve')} onPress={() => run(() => post(`${base}/swaps/${s.id}/approve`))} testID={`swap-approve-${s.id}`} />}
                  {(s.otherId === me || s.requesterId === me || g.can('approve')) && (
                    <Button small kind="secondary" title={s.requesterId === me ? t('gameya.withdraw') : t('gameya.reject')} onPress={() => run(() => post(`${base}/swaps/${s.id}/reject`))} />
                  )}
                </View>
              </Card>
            );
          })}
        </Section>
      )}

      <Section title={t('gameya.board')}>
        {months.map((m: any) => {
          const paid = m.payments.filter((p: any) => p.status === 'paid').length;
          const open = m.position === shown && gameya.status === 'active';
          return (
            <Card key={m.position} accent={m.position === shown ? color : undefined} testID={`gameya-month-${m.position}`} style={{ opacity: m.receivedAt && !open ? 0.75 : 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <Txt style={{ fontWeight: '700', flex: 1 }}>{`${fmt.number(m.position)}. ${month(m.month)}`}</Txt>
                <Txt style={{ fontWeight: m.receiverId === me ? '800' : '600', color: m.receiverId === me ? color : colors.text }}>{`${t('gameya.receiver')}: ${name(m.receiverId)}`}</Txt>
              </View>
              <Muted>{m.receivedAt ? t('gameya.received') : t('gameya.paidOf', { paid: fmt.number(paid), total: fmt.number(m.payments.length) })}</Muted>
              {(open || m.payments.some((p: any) => p.status === 'late' || (p.payerId === me && p.status !== 'paid' && m.position <= shown))) &&
                m.payments.map((p: any) => (
                  <Row
                    key={p.id}
                    title={name(p.payerId)}
                    subtitle={t(`gameya.${p.status}`)}
                    testID={`gp-${m.position}-${p.payerId === me ? 'me' : p.payerId}`}
                    right={
                      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: STATUS_COLOR[p.status] }} />
                        {p.payerId === me && (p.status === 'due' || p.status === 'late') && config.data?.payments && (
                          <Button small color={color} title={t('pay.online')} onPress={() => setPay({ target: { purpose: 'gameya', targetId: p.id }, amount: p.amountMinor, payee: name(m.receiverId) })} testID={`gameya-pay-${m.position}`} />
                        )}
                        {p.payerId === me && (p.status === 'due' || p.status === 'late') && (
                          <Button small kind="secondary" title={t('gameya.iPaid')} onPress={() => run(() => post(`${base}/payments/${p.id}/report`))} testID={`gameya-report-${m.position}`} />
                        )}
                        {m.receiverId === me && p.status !== 'paid' && (
                          <Button small color={color} title={t('gameya.confirm')} onPress={() => run(() => post(`${base}/payments/${p.id}/confirm`))} testID={`gameya-confirm-${m.position}-${p.payerId}`} />
                        )}
                      </View>
                    }
                  />
                ))}
            </Card>
          );
        })}
      </Section>

      <Section title={t('gameya.trust')}>
        <Card testID="gameya-trust">
          {trust.map((x: any) => (
            <Row key={x.userId} title={name(x.userId)} subtitle={`${t('gameya.onTime', { n: fmt.number(x.onTime) })} · ${t('gameya.lateCount', { n: fmt.number(x.late) })}`} right={<Txt>{x.late === 0 ? '⭐' : ''}</Txt>} />
          ))}
        </Card>
      </Section>

      <PaySheet groupId={id} target={pay?.target ?? null} amount={pay?.amount ?? 0} currency={cur} payeeName={pay?.payee ?? ''} color={color} onClose={() => setPay(null)} />
      <Sheet visible={swapSheet.open} onClose={swapSheet.hide} title={t('gameya.swapWith')} testID="swap-sheet">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {months
            .filter((m: any) => m.receiverId !== me && m.position > current && !m.receivedAt)
            .map((m: any) => (
              <Chip
                key={m.position}
                label={`${fmt.number(m.position)}. ${name(m.receiverId)}`}
                color={color}
                testID={`swap-with-${m.receiverId}`}
                onPress={async () => {
                  if (pending) return;
                  await run(() => post(`${base}/swaps`, { otherId: m.receiverId }));
                  swapSheet.hide();
                }}
              />
            ))}
        </View>
      </Sheet>
    </Screen>
  );
}
