import { useQueries } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { get, post } from '@/lib/api';
import { useAct, useGroups } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';
import { Card, Muted, Screen, Txt, colors } from './ui';

/** Kids mode: big buttons, my chores, my points and the shop (A6). */
export function KidsHome({ name }: { name: string }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const router = useRouter();
  const groups = useGroups();
  const { run } = useAct();
  const pointGroups = (groups.data ?? []).filter((g: any) => g.modules.includes('points'));
  const points = useQueries({ queries: pointGroups.map((g: any) => ({ queryKey: ['group', g.id, 'points'], queryFn: () => get(`/groups/${g.id}/points`) })) });
  const taskGroups = (groups.data ?? []).filter((g: any) => g.modules.includes('tasks'));
  const mine = useQueries({ queries: taskGroups.map((g: any) => ({ queryKey: ['group', g.id, 'tasks', 'mine'], queryFn: () => get(`/groups/${g.id}/tasks?mine=1`) })) });
  // every open chore assigned to me, dated or not
  const chores = taskGroups.flatMap((g: any, i: number) => (mine[i]?.data ?? []).map((task: any) => ({ ...task, groupColor: g.color })));
  return (
    <Screen title={t('points.kidsHello', { name })} testID="kids-home">
      {pointGroups.map((g: any, i: number) => (
        <Pressable key={g.id} onPress={() => router.push(`/g/${g.id}/points`)} accessibilityRole="button" testID={`kids-points-${g.id}`}>
          <Card accent={g.color} style={{ alignItems: 'center', paddingVertical: 24 }}>
            <Text style={{ fontSize: 48, fontWeight: '800', color: g.color }}>⭐ {fmt.number(points[i]?.data?.me?.balance ?? 0)}</Text>
            <Txt style={{ fontSize: 18, marginTop: 4 }}>{points[i]?.data?.me?.streak ? t('points.streak', { count: points[i].data.me.streak }) : t('points.shop')}</Txt>
          </Card>
        </Pressable>
      ))}
      <Txt style={{ fontSize: 22, fontWeight: '800', marginVertical: 12 }}>{t('points.myChores')}</Txt>
      {chores.length === 0 && <Muted style={{ fontSize: 18 }}>{t('points.allDone')}</Muted>}
      {chores.map((c: any) => (
        <Pressable
          key={c.id}
          accessibilityRole="button"
          accessibilityLabel={c.title}
          testID={`kids-chore-${c.id}`}
          onPress={() => run(() => post(`/groups/${c.groupId}/tasks/${c.id}/complete`))}
          style={({ pressed }) => ({ backgroundColor: pressed ? colors.chip : colors.card, borderRadius: 20, padding: 20, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 16, borderWidth: 3, borderColor: c.groupColor, minHeight: 88 })}>
          <View style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 4, borderColor: c.groupColor }} />
          <View style={{ flex: 1 }}>
            <Txt style={{ fontSize: 22, fontWeight: '700' }}>{c.title}</Txt>
            {c.points ? <Txt style={{ fontSize: 18, color: colors.warn }}>⭐ +{fmt.number(c.points)}</Txt> : null}
          </View>
        </Pressable>
      ))}
    </Screen>
  );
}
