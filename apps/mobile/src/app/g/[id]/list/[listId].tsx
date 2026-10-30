import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Check } from '@/components/Check';
import { Button, Card, ErrorView, Field, Loading, Row, Screen, colors } from '@/components/ui';
import { del, get, patch, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';

export default function ListDetail() {
  const { id, listId } = useLocalSearchParams<{ id: string; listId: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['group', id, 'list', listId], queryFn: () => get(`/groups/${id}/lists/${listId}`) });
  const { run } = useAct(id);
  const [title, setTitle] = useState('');
  const [qty, setQty] = useState('');
  if (q.isLoading) return <Screen title="" back><Loading /></Screen>;
  if (q.error) return <Screen title="" back><ErrorView error={q.error} /></Screen>;
  const add = async () => {
    if (!title.trim()) return;
    await run(() => post(`/groups/${id}/lists/${listId}/items`, { title: title.trim(), qty: qty || undefined }));
    setTitle('');
    setQty('');
  };
  return (
    <Screen title={q.data.list.title} back accent={g.group?.color} testID="list-detail">
      {g.can('lists.create') && (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Field value={title} onChangeText={setTitle} placeholder={t('lists.addItem')} onSubmitEditing={add} returnKeyType="done" testID="item-title" />
          </View>
          <View style={{ width: 70 }}>
            <Field value={qty} onChangeText={setQty} placeholder={t('lists.qty')} />
          </View>
          <Button small title="+" onPress={add} testID="item-add" color={g.group?.color} />
        </View>
      )}
      {g.can('items.create') && (
        <Button
          small
          kind="ghost"
          title={`🔗 ${t('reach.shareList')}`}
          onPress={() =>
            run(async () => {
              const link = await post(`/groups/${id}/guest-links`, { entity: 'list', entityId: listId });
              await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(`${q.data.list.title}: ${link.url}`)}`);
            })
          }
        />
      )}
      <Card style={{ paddingVertical: 4 }}>
        {q.data.items.map((it: any) => (
          <Row
            key={it.id}
            title={it.qty ? `${it.title} × ${it.qty}` : it.title}
            strike={it.checked}
            subtitle={it.checked ? t('lists.checkedBy', { name: g.memberName(it.checkedBy) }) : it.category}
            left={<Check checked={it.checked} label={it.title} color={g.group?.color} onPress={() => run(() => patch(`/groups/${id}/lists/${listId}/items/${it.id}`, { checked: !it.checked }))} testID={`item-check-${it.id}`} />}
            right={
              g.can('lists.create') ? (
                <Pressable onPress={() => run(() => del(`/groups/${id}/lists/${listId}/items/${it.id}`))} accessibilityRole="button" accessibilityLabel={t('common.delete')} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: colors.faint, fontSize: 16 }}>✕</Text>
                </Pressable>
              ) : null
            }
            testID={`item-${it.id}`}
          />
        ))}
      </Card>
    </Screen>
  );
}
