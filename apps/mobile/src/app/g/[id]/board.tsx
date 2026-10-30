import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Muted, Txt, colors } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

/** Task board (A6 Work Team): To do / Doing / Done, side by side; swipe sideways on a phone. */
export default function Board() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const router = useRouter();
  const { run } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'tasks', 'board'], queryFn: () => get(`/groups/${id}/board`) });
  const color = g.group?.color ?? colors.primary;
  const columns: { key: 'todo' | 'doing' | 'done'; title: string }[] = [
    { key: 'todo', title: t('work.todo') },
    { key: 'doing', title: t('work.doing') },
    { key: 'done', title: t('work.done') },
  ];
  return (
    <GroupScreen id={id} active="tasks" scroll={false}>
      <ScrollView horizontal contentContainerStyle={{ padding: 12, gap: 12 }} testID="board">
        {columns.map((col) => (
          <View key={col.key} style={{ width: 280 }} testID={`board-${col.key}`}>
            <Txt style={{ fontWeight: '800', marginBottom: 8 }}>{`${col.title} · ${fmt.number(q.data?.[col.key]?.length ?? 0)}`}</Txt>
            <ScrollView style={{ maxHeight: 640 }}>
              {(q.data?.[col.key] ?? []).map((task: any) => (
                <Card key={task.id} onPress={() => router.push(`/g/${id}/task/${task.id}`)} testID={`card-${task.id}`} style={{ opacity: col.key === 'done' ? 0.7 : 1 }}>
                  <Txt style={{ fontWeight: '600' }}>{task.title}</Txt>
                  <Muted>{[task.assigneeId ? g.memberName(task.assigneeId) : null, task.dueAt ? fmt.date(task.dueAt) : null].filter(Boolean).join(' · ') || ' '}</Muted>
                  {col.key !== 'done' && (
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                      {col.key === 'todo' ? (
                        <Button small kind="secondary" title={`▶ ${t('work.start')}`} onPress={() => run(() => post(`/groups/${id}/tasks/${task.id}/stage`, { stage: 'doing' }))} testID={`start-${task.id}`} />
                      ) : (
                        <Button small kind="ghost" title={t('work.back')} onPress={() => run(() => post(`/groups/${id}/tasks/${task.id}/stage`, { stage: 'todo' }))} />
                      )}
                      <Button small color={color} title={`✓ ${t('work.finish')}`} onPress={() => run(() => post(`/groups/${id}/tasks/${task.id}/complete`))} testID={`finish-${task.id}`} />
                    </View>
                  )}
                </Card>
              ))}
            </ScrollView>
          </View>
        ))}
      </ScrollView>
    </GroupScreen>
  );
}
