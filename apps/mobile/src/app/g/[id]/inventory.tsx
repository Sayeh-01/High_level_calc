import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Chip, Empty, Field, Muted, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function Inventory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'inventory'], queryFn: () => get(`/groups/${id}/inventory`) });
  const sheet = useSheet();
  const color = g.group?.color ?? colors.primary;
  const manage = g.can('items.manage');
  const [form, setForm] = useState({ name: '', unit: '', quantity: '0', lowAt: '0', vendorUserId: null as string | null });
  const [reorderFor, setReorderFor] = useState<any>(null);
  const [qty, setQty] = useState('10');
  const move = (itemId: string, delta: number) => run(() => post(`/groups/${id}/inventory/${itemId}/move`, { delta }));
  return (
    <GroupScreen id={id} active="inventory">
      {manage && <Button title={t('ops.newItem')} color={color} onPress={sheet.show} testID="new-item" style={{ marginBottom: 12 }} />}
      {q.data?.length === 0 && <Empty title={t('group.nothingYet')} />}
      {q.data?.map((i: any) => (
        <Card key={i.id} accent={i.low ? colors.danger : undefined} testID={`item-${i.id}`}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Txt style={{ fontWeight: '700' }}>{`${i.low ? '⚠️ ' : ''}${i.name}`}</Txt>
              <Muted>{`${t('ops.lowAt')}: ${fmt.number(i.lowAt)}${i.vendorUserId ? ` · ${t('ops.vendor')}: ${g.memberName(i.vendorUserId)}` : ''}`}</Muted>
            </View>
            <Button small kind="secondary" title={t('ops.use')} onPress={() => move(i.id, -1)} disabled={i.quantity <= 0} testID={`use-${i.id}`} />
            <Txt style={{ fontSize: 18, fontWeight: '800', minWidth: 56, textAlign: 'center', color: i.low ? colors.danger : colors.text }} testID={`qty-${i.id}`}>{`${fmt.number(i.quantity)} ${i.unit}`.trim()}</Txt>
            <Button small kind="secondary" title={t('ops.restock')} onPress={() => move(i.id, 1)} testID={`restock-${i.id}`} />
          </View>
          {manage && i.low && <Button small color={color} title={`🛒 ${t('ops.reorder')}`} onPress={() => setReorderFor(i)} testID={`reorder-${i.id}`} style={{ alignSelf: 'flex-start', marginTop: 8 }} />}
        </Card>
      ))}
      <Sheet visible={!!reorderFor} onClose={() => setReorderFor(null)} title={`${t('ops.reorder')}: ${reorderFor?.name ?? ''}`} testID="reorder-sheet">
        <Field label={t('ops.reorderQty')} value={qty} onChangeText={setQty} inputMode="numeric" testID="reorder-qty" />
        <Button title={t('ops.reorder')} color={color} loading={pending} disabled={!(Number(qty) > 0)} testID="reorder-save" onPress={async () => (await run(() => post(`/groups/${id}/inventory/${reorderFor.id}/reorder`, { quantity: Number(qty) })), setReorderFor(null))} />
      </Sheet>
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('ops.newItem')} testID="item-sheet">
        <Field label={t('ops.name')} value={form.name} onChangeText={(s) => setForm({ ...form, name: s })} testID="item-name" />
        <Field label={t('ops.unit')} value={form.unit} onChangeText={(s) => setForm({ ...form, unit: s })} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label={t('ops.quantity')} value={form.quantity} onChangeText={(s) => setForm({ ...form, quantity: s })} inputMode="numeric" testID="item-qty" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label={t('ops.lowAt')} value={form.lowAt} onChangeText={(s) => setForm({ ...form, lowAt: s })} inputMode="numeric" testID="item-low" />
          </View>
        </View>
        <Muted>{t('ops.vendor')}</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 }}>
          <Chip label={t('ops.none')} active={!form.vendorUserId} color={color} onPress={() => setForm({ ...form, vendorUserId: null })} />
          {g.members.filter((m) => m.role === 'vendor').map((m) => (
            <Chip key={m.userId} label={m.displayName} active={form.vendorUserId === m.userId} color={color} onPress={() => setForm({ ...form, vendorUserId: m.userId })} />
          ))}
        </View>
        <Button
          title={t('common.save')}
          color={color}
          loading={pending}
          disabled={!form.name.trim()}
          testID="item-save"
          onPress={async () => {
            await run(() => post(`/groups/${id}/inventory`, { name: form.name.trim(), unit: form.unit.trim(), quantity: Number(form.quantity) || 0, lowAt: Number(form.lowAt) || 0, vendorUserId: form.vendorUserId }));
            setForm({ name: '', unit: '', quantity: '0', lowAt: '0', vendorUserId: null });
            sheet.hide();
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
