import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Chip, Empty, Field, Muted, Row, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { del, get, post } from '@/lib/api';
import { confirmAsk, useAct, useGroup } from '@/lib/hooks';

const KINDS = ['vendor', 'doctor', 'emergency', 'other'] as const;

export default function Contacts() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'contacts'], queryFn: () => get(`/groups/${id}/contacts`) });
  const sheet = useSheet();
  const empty = { name: '', kind: 'vendor' as string, phone: '', email: '', notes: '' };
  const [form, setForm] = useState(empty);
  const color = g.group?.color ?? colors.primary;
  const kindLabel = (k: string) => ((KINDS as readonly string[]).includes(k) ? t(`money.kind_${k}`) : k);
  return (
    <GroupScreen id={id} active="contacts">
      {g.can('items.create') && <Button title={t('money.addContact')} color={color} onPress={sheet.show} testID="new-contact" style={{ marginBottom: 12 }} />}
      {q.data?.length === 0 && <Empty title={t('group.nothingYet')} />}
      {q.data?.map((ct: any) => (
        <Card key={ct.id} style={{ paddingVertical: 4 }} testID={`contact-${ct.id}`}>
          <Row
            title={ct.name}
            subtitle={[kindLabel(ct.kind), ct.notes].filter(Boolean).join(' · ')}
            right={
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {ct.phone ? <Button small color={color} title={`📞 ${t('money.call')}`} onPress={() => Linking.openURL(`tel:${ct.phone}`)} /> : null}
                {ct.email ? <Button small kind="secondary" title="✉️" accessibilityLabel={t('money.email')} onPress={() => Linking.openURL(`mailto:${ct.email}`)} /> : null}
                {g.can('items.create') && <Button small kind="secondary" title="🗑️" accessibilityLabel={t('common.delete')} onPress={async () => (await confirmAsk(t('common.delete'))) && run(() => del(`/groups/${id}/contacts/${ct.id}`))} />}
              </View>
            }
          />
          {ct.phone ? <Muted style={{ writingDirection: 'ltr', textAlign: 'auto', paddingBottom: 6 }}>{ct.phone}</Muted> : null}
        </Card>
      ))}
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('money.addContact')} testID="contact-sheet">
        <Field label={t('money.name')} value={form.name} onChangeText={(s) => setForm({ ...form, name: s })} testID="contact-name" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {KINDS.map((k) => (
            <Chip key={k} label={kindLabel(k)} active={form.kind === k} onPress={() => setForm({ ...form, kind: k })} color={color} testID={`contact-kind-${k}`} />
          ))}
        </View>
        <Field label={t('money.phone')} value={form.phone} onChangeText={(s) => setForm({ ...form, phone: s })} inputMode="tel" style={{ writingDirection: 'ltr' }} testID="contact-phone" />
        <Field label={t('money.email')} value={form.email} onChangeText={(s) => setForm({ ...form, email: s })} inputMode="email" autoCapitalize="none" style={{ writingDirection: 'ltr' }} />
        <Field label={t('money.notes')} value={form.notes} onChangeText={(s) => setForm({ ...form, notes: s })} />
        <Button
          title={t('common.save')}
          color={color}
          loading={pending}
          disabled={!form.name.trim()}
          testID="contact-save"
          onPress={async () => {
            await run(() =>
              post(`/groups/${id}/contacts`, { name: form.name.trim(), kind: form.kind, phone: form.phone.trim() || undefined, email: form.email.trim() || undefined, notes: form.notes.trim() || undefined }),
            );
            setForm(empty);
            sheet.hide();
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
