import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Field, Muted, Row, Section, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { ApiError, get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function Points() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { run, pending } = useAct(id);
  const pts = useQuery({ queryKey: ['group', id, 'points'], queryFn: () => get(`/groups/${id}/points`) });
  const shop = useQuery({ queryKey: ['group', id, 'rewards'], queryFn: () => get(`/groups/${id}/rewards`) });
  const reds = useQuery({ queryKey: ['group', id, 'redemptions'], queryFn: () => get(`/groups/${id}/redemptions`) });
  const approvals = useQuery({ queryKey: ['group', id, 'approvals'], queryFn: () => get(`/groups/${id}/approvals`), enabled: g.can('approve') });
  const sheet = useSheet();
  const [reward, setReward] = useState({ title: '', cost: '', emoji: '🎁' });
  const [short, setShort] = useState<string | null>(null);
  const color = g.group?.color ?? colors.primary;
  const me = pts.data?.me;
  const members = g.members.filter((m) => m.role !== 'guest');

  return (
    <GroupScreen id={id} active="points">
      <Card accent={color} testID="my-points">
        <Muted>{t('points.myPoints')}</Muted>
        <Txt style={{ fontSize: 40, fontWeight: '800', color }}>⭐ {fmt.number(me?.balance ?? 0)}</Txt>
        <Txt style={{ marginTop: 4 }}>{me?.streak ? t('points.streak', { count: me.streak }) : t('points.noStreak')}</Txt>
      </Card>

      {g.can('approve') && approvals.data?.length > 0 && (
        <Section title={t('points.approvals')}>
          {approvals.data.map((a: any) => (
            <Card key={a.id} testID={`approval-${a.id}`}>
              <Txt>
                {g.memberName(a.userId)} · ⭐ {fmt.number(a.points)}
              </Txt>
              <Muted>{fmt.dateTime(a.completedAt)}</Muted>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Button small title={t('points.approve')} color={color} onPress={() => run(() => post(`/groups/${id}/completions/${a.id}/approve`))} testID={`approve-${a.id}`} />
                <Button small kind="secondary" title={t('points.reject')} onPress={() => run(() => post(`/groups/${id}/completions/${a.id}/reject`))} />
              </View>
            </Card>
          ))}
        </Section>
      )}

      <Section title={t('points.fairness')}>
        <Card testID="fairness">
          {members.map((m) => {
            const share = pts.data?.fairness?.[m.userId] ?? 0;
            return (
              <View key={m.userId} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Txt>{m.displayName}</Txt>
                  <Txt style={{ fontWeight: '700' }}>
                    {fmt.number(share)}% · 🔥{fmt.number(pts.data?.streaks?.[m.userId] ?? 0)}
                  </Txt>
                </View>
                <View style={{ height: 10, backgroundColor: colors.chip, borderRadius: 5, marginTop: 4, overflow: 'hidden' }}>
                  <View style={{ width: `${share}%`, height: 10, backgroundColor: color }} />
                </View>
              </View>
            );
          })}
        </Card>
      </Section>

      <Section title={t('points.shop')} right={g.can('approve') ? <Button small kind="ghost" title={`+ ${t('points.newReward')}`} onPress={sheet.show} testID="new-reward" /> : null}>
        {shop.data?.map((r: any) => (
          <Card key={r.id} style={{ paddingVertical: 4 }} testID={`reward-${r.id}`}>
            <Row
              title={`${r.emoji} ${r.title}`}
              subtitle={t('points.cost', { count: r.cost })}
              right={
                <Button
                  small
                  color={color}
                  title={t('points.redeem')}
                  disabled={(me?.balance ?? 0) < r.cost}
                  testID={`redeem-${r.id}`}
                  onPress={() =>
                    run(() => post(`/groups/${id}/rewards/${r.id}/redeem`)).catch((e) => {
                      if (e instanceof ApiError && e.status === 409) setShort(t('points.notEnough'));
                    })
                  }
                />
              }
            />
          </Card>
        ))}
        {short ? <Muted style={{ color: colors.warn }}>{short}</Muted> : null}
      </Section>

      {reds.data?.length > 0 && (
        <Section title={g.can('approve') ? t('points.redemptions') : t('points.myRewards')}>
          <Card style={{ paddingVertical: 4 }}>
            {reds.data.map((r: any) => (
              <Row
                key={r.id}
                title={`${r.emoji} ${r.title}`}
                subtitle={`${g.memberName(r.userId)} · ${r.status === 'pending' ? t('points.pending') : t('points.given')}`}
                right={g.can('approve') && r.status === 'pending' ? <Button small kind="secondary" title={t('points.given')} onPress={() => run(() => post(`/groups/${id}/redemptions/${r.id}/fulfill`))} /> : null}
              />
            ))}
          </Card>
        </Section>
      )}

      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('points.newReward')}>
        <Field label={t('points.rewardTitle')} value={reward.title} onChangeText={(s) => setReward({ ...reward, title: s })} testID="reward-title" />
        <Field label="⭐" value={reward.cost} onChangeText={(s) => setReward({ ...reward, cost: s.replace(/\D/g, '') })} inputMode="numeric" testID="reward-cost" />
        <Field label={t('settings.emoji')} value={reward.emoji} onChangeText={(s) => setReward({ ...reward, emoji: s })} />
        <Button
          title={t('common.create')}
          color={color}
          loading={pending}
          disabled={!reward.title.trim() || !Number(reward.cost)}
          testID="reward-save"
          onPress={async () => {
            await run(() => post(`/groups/${id}/rewards`, { title: reward.title.trim(), cost: Number(reward.cost), emoji: reward.emoji || undefined }));
            setReward({ title: '', cost: '', emoji: '🎁' });
            sheet.hide();
          }}
        />
        <Text style={{ height: 8 }} />
      </Sheet>
    </GroupScreen>
  );
}
