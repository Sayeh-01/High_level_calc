import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Card, Chip, HScroll, Muted, Section, Txt, colors } from '@/components/ui';
import { get, put } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function Teams() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { run } = useAct(id);
  const skills = useQuery({ queryKey: ['group', id, 'skills'], queryFn: () => get(`/groups/${id}/teams/skills`) });
  const stats = useQuery({ queryKey: ['group', id, 'stats'], queryFn: () => get(`/groups/${id}/teams/stats?days=120`) });
  const color = g.group?.color ?? colors.primary;
  return (
    <GroupScreen id={id} active="teams">
      <Section title={`${t('sport.leaderboard')} · ${t('sport.matches', { count: stats.data?.matches ?? 0 })}`}>
        <Card testID="leaderboard">
          <View style={{ flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Muted style={{ flex: 1 }}> </Muted>
            <Muted style={{ width: 56, textAlign: 'center' }}>{t('sport.motm')}</Muted>
            <Muted style={{ width: 56, textAlign: 'center' }}>{t('sport.attended')}</Muted>
            <Muted style={{ width: 56, textAlign: 'center' }}>{t('sport.rate')}</Muted>
          </View>
          {stats.data?.rows.map((r: any, i: number) => (
            <View key={r.userId} style={{ flexDirection: 'row', paddingVertical: 8, alignItems: 'center' }}>
              <Txt style={{ flex: 1 }} numberOfLines={1}>
                {fmt.number(i + 1)}. {r.name}
              </Txt>
              <Txt style={{ width: 56, textAlign: 'center', fontWeight: '700' }}>{fmt.number(r.motm)}</Txt>
              <Txt style={{ width: 56, textAlign: 'center' }}>{fmt.number(r.attended)}</Txt>
              <Txt style={{ width: 56, textAlign: 'center' }}>{fmt.number(r.rate)}%</Txt>
            </View>
          ))}
        </Card>
      </Section>
      {g.can('approve') && (
        <Section title={t('sport.skills')}>
          {g.members.map((m) => {
            const cur = skills.data?.find((s: any) => s.userId === m.userId)?.skill ?? 5;
            return (
              <Card key={m.userId} style={{ paddingVertical: 10 }}>
                <Txt style={{ marginBottom: 6, fontWeight: '600' }}>{m.displayName}</Txt>
                <HScroll>
                  {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => (
                    <Chip key={n} label={fmt.number(n)} active={cur === n} color={color} onPress={() => run(() => put(`/groups/${id}/teams/skills/${m.userId}`, { skill: n }))} testID={`skill-${m.userId}-${n}`} />
                  ))}
                </HScroll>
              </Card>
            );
          })}
        </Section>
      )}
    </GroupScreen>
  );
}
