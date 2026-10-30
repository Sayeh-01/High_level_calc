import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Field, Muted, Section, Txt, colors } from '@/components/ui';
import { get, post, put } from '@/lib/api';
import { confirmAsk, useAct, useGroup } from '@/lib/hooks';

const FIELDS = ['bloodType', 'allergies', 'conditions', 'medications', 'doctors', 'insurance'] as const;
const LABEL: Record<(typeof FIELDS)[number], string> = { bloodType: 'blood', allergies: 'allergies', conditions: 'conditions', medications: 'medications', doctors: 'doctors', insurance: 'insurance' };

export default function Safety() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const { run, pending } = useAct(id);
  const cards = useQuery({ queryKey: ['group', id, 'emergency'], queryFn: () => get(`/groups/${id}/emergency`) });
  const [sent, setSent] = useState(false);
  const me = g.me?.userId;
  const mine = cards.data?.find((c: any) => c.userId === me)?.card ?? {};
  const [form, setForm] = useState<Record<string, string>>({});
  const [contact, setContact] = useState('');
  useEffect(() => {
    setForm(Object.fromEntries(FIELDS.map((f) => [f, mine[f] ?? ''])));
    setContact(mine.contacts?.[0] ? `${mine.contacts[0].name}, ${mine.contacts[0].phone}` : '');
  }, [cards.dataUpdatedAt]);
  const color = g.group?.color ?? colors.primary;
  return (
    <GroupScreen id={id} active="safety">
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
        <Button style={{ flex: 1, minHeight: 64 }} color={colors.good} title={sent ? t('care.arrivedSent') : t('care.arrived')} onPress={() => run(() => post(`/groups/${id}/safety/arrived`, {})).then(() => setSent(true))} testID="arrived" />
        <Button style={{ flex: 1, minHeight: 64 }} kind="danger" title={t('care.sos')} onPress={async () => (await confirmAsk(t('care.sosConfirm'))) && run(() => post(`/groups/${id}/safety/sos`, {}))} testID="sos" />
      </View>
      <Section title={t('care.myCard')}>
        <Card testID="my-card">
          {FIELDS.map((f) => (
            <Field key={f} label={t(`care.${LABEL[f]}`)} value={form[f] ?? ''} onChangeText={(s) => setForm({ ...form, [f]: s })} testID={`card-${f}`} />
          ))}
          <Field label={t('care.contacts')} value={contact} onChangeText={setContact} />
          <Button
            title={t('common.save')}
            color={color}
            loading={pending}
            testID="card-save"
            onPress={() => {
              const [name, phone] = contact.split(',').map((x) => x.trim());
              return run(() => put(`/groups/${id}/emergency/${me}`, { ...Object.fromEntries(Object.entries(form).filter(([, v]) => v)), contacts: name && phone ? [{ name, phone }] : [] }));
            }}
          />
        </Card>
      </Section>
      {cards.data
        ?.filter((c: any) => c.userId !== me)
        .map((c: any) => (
          <Card key={c.userId} accent={color}>
            <Txt style={{ fontWeight: '700', marginBottom: 4 }}>🩺 {g.memberName(c.userId)}</Txt>
            {FIELDS.filter((f) => c.card[f]).map((f) => (
              <Muted key={f}>{`${t(`care.${LABEL[f]}`)}: ${c.card[f]}`}</Muted>
            ))}
            {c.card.contacts?.map((x: any) => (
              <Muted key={x.phone}>{`📞 ${x.name} ${x.phone}`}</Muted>
            ))}
          </Card>
        ))}
    </GroupScreen>
  );
}
