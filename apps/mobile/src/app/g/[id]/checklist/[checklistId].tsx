import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorView, Loading, Muted, Screen, Txt, colors } from '@/components/ui';
import { authHeaders, fileUrl, get, post, uploadFile } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function ChecklistRun() {
  const { id, checklistId } = useLocalSearchParams<{ id: string; checklistId: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'checklists', checklistId], queryFn: () => get(`/groups/${id}/checklists/${checklistId}/run`) });
  const color = g.group?.color ?? colors.primary;
  if (q.isLoading) return <Screen title="" back><Loading /></Screen>;
  if (q.error || !q.data) return <Screen title="" back><ErrorView error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const { checklist, run: r } = q.data;
  const check = (itemId: string, body: object = {}) => run(() => post(`/groups/${id}/checklists/${checklistId}/items/${itemId}/check`, body));
  return (
    <Screen title={`☑️ ${checklist.title}`} back accent={color} testID="checklist-run">
      <Muted style={{ marginBottom: 8 }}>{r.completedAt ? t('company.completed') : t('company.progress', { done: fmt.number(Object.keys(r.checks).length), total: fmt.number(checklist.items.length) })}</Muted>
      {checklist.items.map((item: any) => {
        const done = r.checks[item.id];
        return (
          <Card key={item.id} accent={done ? colors.good : undefined} testID={`item-${item.id}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Txt style={{ flex: 1, fontWeight: '600', textDecorationLine: done ? 'line-through' : 'none' }}>{`${item.photo ? '📷 ' : ''}${item.text}`}</Txt>
              {!done &&
                (item.photo ? (
                  <Button
                    small
                    color={color}
                    title={t('company.photo')}
                    loading={pending}
                    testID={`photo-${item.id}`}
                    onPress={async () => {
                      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
                      if (res.canceled) return;
                      const a = res.assets[0];
                      await run(async () => post(`/groups/${id}/checklists/${checklistId}/items/${item.id}/check`, { photoFileId: await uploadFile(id, a.uri, a.mimeType ?? 'image/jpeg') }));
                    }}
                  />
                ) : (
                  <Button small color={color} title={`✓ ${t('company.check')}`} onPress={() => check(item.id)} testID={`check-${item.id}`} />
                ))}
            </View>
            {done && <Muted testID={`checked-${item.id}`}>{t('company.checkedBy', { name: g.memberName(done.by), time: fmt.time(done.at) })}</Muted>}
            {done?.photoFileId && <Image source={{ uri: fileUrl(id, done.photoFileId), headers: authHeaders() }} style={{ width: 96, height: 96, borderRadius: 8, marginTop: 6 }} contentFit="cover" />}
          </Card>
        );
      })}
    </Screen>
  );
}
