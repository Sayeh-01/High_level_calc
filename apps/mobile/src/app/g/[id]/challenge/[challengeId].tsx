import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorView, Field, Loading, Muted, Row, Screen, Section, Txt, colors } from '@/components/ui';
import { get, post, put } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function ChallengeDetail() {
  const { id, challengeId } = useLocalSearchParams<{ id: string; challengeId: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'challenges', challengeId], queryFn: () => get(`/groups/${id}/challenges/${challengeId}`) });
  const [today, setToday] = useState('');
  const color = g.group?.color ?? colors.primary;
  const me = g.me?.userId;
  if (q.isLoading) return <Screen title="" back><Loading /></Screen>;
  if (q.error || !q.data) return <Screen title="" back><ErrorView error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const ch = q.data.challenge;
  const base = `/groups/${id}/challenges/${challengeId}`;
  const manager = ch.createdBy === me || g.can('items.manage');
  const name = (u: string | null) => (u ? (u === me ? t('common.you') : g.memberName(u)) : t('challenge.free'));

  if (ch.kind === 'tally') {
    const streaks: any[] = q.data.streaks;
    const mine = streaks.find((s) => s.userId === me);
    return (
      <Screen title={`🏁 ${ch.title}`} back accent={color} testID="challenge-screen">
        <Card accent={color}>
          <Txt style={{ fontSize: 17, fontWeight: '700' }}>{`${t('challenge.target')}: ${fmt.number(ch.target)} ${ch.unit ?? ''}`}</Txt>
          <Muted>{t('challenge.streak', { n: fmt.number(mine?.streak ?? 0) })}</Muted>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Field label={t('challenge.logToday')} value={today} onChangeText={setToday} inputMode="numeric" placeholder={String(mine?.today ?? 0)} testID="challenge-log" />
            </View>
            <Button title={t('challenge.save')} color={color} loading={pending} disabled={!/^\d+$/.test(today)} onPress={async () => (await run(() => post(`${base}/log`, { value: Number(today) })), setToday(''))} testID="challenge-log-save" style={{ marginBottom: 12 }} />
          </View>
        </Card>
        <Section title={t('challenge.leaderboard')}>
          <Card testID="challenge-streaks">
            {streaks.map((s) => (
              <Row key={s.userId} title={name(s.userId)} subtitle={`${fmt.number(s.today)} ${ch.unit ?? ''}`} right={<Txt style={{ fontWeight: '700' }}>{`🔥 ${fmt.number(s.streak)}`}</Txt>} />
            ))}
          </Card>
        </Section>
      </Screen>
    );
  }

  const parts: any[] = q.data.parts;
  const done = parts.filter((p) => p.doneAt).length;
  const mine = parts.filter((p) => p.userId === me);
  const inIt = ch.memberIds.includes(me);
  return (
    <Screen title={`🏁 ${ch.title}`} back accent={color} testID="challenge-screen">
      <Card accent={color} testID="challenge-summary">
        <Txt style={{ fontSize: 17, fontWeight: '700' }}>{`${t('challenge.round', { n: fmt.number(ch.round) })} · ${t('challenge.progress', { done: fmt.number(done), total: fmt.number(parts.length) })}`}</Txt>
        {q.data.completedRounds > 0 && <Muted>{t('challenge.rounds', { n: fmt.number(q.data.completedRounds) })}</Muted>}
        <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, marginVertical: 8, overflow: 'hidden' }}>
          <View style={{ width: `${parts.length ? (done / parts.length) * 100 : 0}%`, height: 8, backgroundColor: color }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {!inIt && <Button small kind="secondary" title={t('challenge.join')} onPress={() => run(() => post(`${base}/join`))} testID="challenge-join" />}
          {manager && <Button small kind="secondary" title={t('challenge.nextRound')} onPress={() => run(() => post(`${base}/next-round`))} testID="challenge-next" />}
        </View>
      </Card>

      <Section title={t('challenge.yours')}>
        <Card testID="challenge-mine">
          {mine.length === 0 && <Muted>{inIt ? t('challenge.none') : t('challenge.joined')}</Muted>}
          {mine.map((p) => (
            <Row
              key={p.part}
              title={`${ch.partLabel ?? ''} ${fmt.number(p.part)}`}
              subtitle={p.doneAt ? `✅ ${t('challenge.done')}` : undefined}
              right={
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {p.doneAt ? (
                    <Button small kind="ghost" title={t('challenge.undo')} onPress={() => run(() => post(`${base}/parts/${p.part}/undo`))} />
                  ) : (
                    <>
                      <Button small kind="secondary" title={t('challenge.handBack')} onPress={() => run(() => put(`${base}/parts/${p.part}`, { userId: null }))} testID={`part-handback-${p.part}`} />
                      <Button small color={color} title={t('challenge.done')} onPress={() => run(() => post(`${base}/parts/${p.part}/done`))} testID={`part-done-${p.part}`} />
                    </>
                  )}
                </View>
              }
            />
          ))}
        </Card>
      </Section>

      <Section title={t('challenge.allParts')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} testID="challenge-grid">
          {parts.map((p) => {
            const free = !p.userId && !p.doneAt && inIt;
            return (
              <Pressable
                key={p.part}
                onPress={free ? () => run(() => put(`${base}/parts/${p.part}`, { userId: me })) : undefined}
                testID={`part-${p.part}`}
                accessibilityRole={free ? 'button' : undefined}
                accessibilityLabel={free ? t('challenge.take') : undefined}
                style={{ width: 98, padding: 8, borderRadius: 10, backgroundColor: p.doneAt ? '#DDF3E4' : p.userId === me ? '#FFF4D6' : colors.card, borderWidth: 1, borderColor: free ? color : colors.border }}>
                <Txt style={{ fontWeight: '700' }}>{`${p.doneAt ? '✓ ' : ''}${fmt.number(p.part)}`}</Txt>
                <Txt numberOfLines={1} style={{ color: colors.muted, fontSize: 13 }}>{free ? `＋ ${t('challenge.take')}` : name(p.userId)}</Txt>
              </Pressable>
            );
          })}
        </View>
      </Section>
    </Screen>
  );
}
