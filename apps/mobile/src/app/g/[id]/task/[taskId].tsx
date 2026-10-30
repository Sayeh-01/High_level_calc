import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Card, ErrorView, Field, Loading, Muted, Row, Screen, Section, Txt, colors } from '@/components/ui';
import { authHeaders, fileUrl, get, post, uploadFile } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function TaskDetail() {
  const { id, taskId } = useLocalSearchParams<{ id: string; taskId: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const q = useQuery({ queryKey: ['group', id, 'task', taskId], queryFn: () => get(`/groups/${id}/tasks/${taskId}`) });
  const { run, pending } = useAct(id);
  const [comment, setComment] = useState('');
  const [photo, setPhoto] = useState<{ uri: string; mime: string } | null>(null);
  if (q.isLoading) return <Screen title="" back><Loading /></Screen>;
  if (q.error) return <Screen title="" back><ErrorView error={q.error} /></Screen>;
  const task = q.data.task;
  const done = task.status === 'done';

  async function pick() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (!res.canceled && res.assets[0]) setPhoto({ uri: res.assets[0].uri, mime: res.assets[0].mimeType ?? 'image/jpeg' });
  }

  return (
    <Screen title={g.v('task')} back accent={g.group?.color} testID="task-detail">
      <Card>
        <Txt style={{ fontSize: 20, fontWeight: '700', textDecorationLine: done ? 'line-through' : 'none' }}>{task.title}</Txt>
        {task.notes ? <Txt style={{ marginTop: 8 }}>{task.notes}</Txt> : null}
        <Muted style={{ marginTop: 8 }}>
          {[task.assigneeId ? `${t('tasks.assignee')}: ${g.memberName(task.assigneeId)}` : t('tasks.unassigned'), task.dueAt ? `${t('tasks.due')}: ${fmt.dateTime(task.dueAt)}` : null, task.rrule ? `🔁 ${task.rrule}` : null, task.points ? `⭐ ${fmt.number(task.points)}` : null]
            .filter(Boolean)
            .join('\n')}
        </Muted>
        {task.rotation?.length ? <Muted style={{ marginTop: 8 }}>{task.rotation.map((u: string) => g.memberName(u)).join(' → ')}</Muted> : null}
      </Card>
      {!done ? (
        <View style={{ gap: 8, marginBottom: 16 }}>
          {photo ? <Image source={{ uri: photo.uri }} style={{ width: 120, height: 120, borderRadius: 12 }} /> : null}
          <Button kind="secondary" title={`📷 ${t('tasks.photo')}`} onPress={pick} />
          <Button
            title={`✓ ${t('tasks.complete')}`}
            color={g.group?.color}
            loading={pending}
            testID="task-complete"
            onPress={() =>
              run(async () => {
                const photoFileId = photo ? await uploadFile(id, photo.uri, photo.mime) : undefined;
                await post(`/groups/${id}/tasks/${taskId}/complete`, photoFileId ? { photoFileId } : {});
                setPhoto(null);
              })
            }
          />
        </View>
      ) : (
        <Button kind="secondary" title={t('tasks.reopen')} onPress={() => run(() => post(`/groups/${id}/tasks/${taskId}/reopen`))} style={{ marginBottom: 16 }} />
      )}
      {q.data.completions.length > 0 && (
        <Section title={t('tasks.history')}>
          <Card style={{ paddingVertical: 4 }}>
            {q.data.completions.map((c: any) => (
              <View key={c.id}>
                <Row title={`✓ ${g.memberName(c.userId)}`} subtitle={fmt.dateTime(c.completedAt)} right={c.points ? <Muted>⭐ {fmt.number(c.points)}</Muted> : null} />
                {c.photoFileId ? <Image source={{ uri: fileUrl(id, c.photoFileId), headers: authHeaders() }} style={{ width: 160, height: 160, borderRadius: 12, marginBottom: 8 }} contentFit="cover" /> : null}
              </View>
            ))}
          </Card>
        </Section>
      )}
      <Section title={t('tasks.comments')}>
        {q.data.comments.map((c: any) => (
          <View key={c.id} style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            <Avatar name={g.memberName(c.userId)} size={28} />
            <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: 10 }}>
              <Muted>{g.memberName(c.userId)}</Muted>
              <Txt>{c.body}</Txt>
            </View>
          </View>
        ))}
        <Field value={comment} onChangeText={setComment} placeholder={t('tasks.addComment')} testID="task-comment" />
        <Button small kind="secondary" title={t('common.send')} disabled={!comment.trim()} onPress={() => run(() => post(`/groups/${id}/tasks/${taskId}/comments`, { body: comment.trim() })).then(() => setComment(''))} />
      </Section>
    </Screen>
  );
}
