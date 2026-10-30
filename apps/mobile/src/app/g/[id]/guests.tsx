import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Empty, Field, Muted, Row, Section, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { del, get, post } from '@/lib/api';
import { confirmAsk, useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

const STATUS_EMOJI: Record<string, string> = { going: '✅', maybe: '🤔', no: '❌', invited: '✉️' };

export default function Guests() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'guests'], queryFn: () => get(`/groups/${id}/guests`) });
  const sheet = useSheet();
  const [form, setForm] = useState({ name: '', phone: '', maxPlusOnes: '0' });
  const color = g.group?.color ?? colors.primary;
  const totals = q.data?.totals;
  const invite = (guest: { url: string; phone?: string | null }) => {
    const text = t('money.inviteText', { name: g.group?.name ?? '', url: guest.url });
    const phone = (guest.phone ?? '').replace(/[^\d]/g, '');
    return Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`);
  };
  return (
    <GroupScreen id={id} active="guests">
      {totals && (
        <Card accent={color} testID="guest-totals">
          <Txt style={{ fontSize: 28, fontWeight: '800' }} testID="guest-headcount">{fmt.number(totals.headcount)}</Txt>
          <Muted>{t('money.headcount')}</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
            {(['invited', 'going', 'maybe', 'no', 'pending'] as const).map((k) => (
              <Txt key={k} style={{ fontSize: 13 }}>{`${t(`money.${k}`)}: ${fmt.number(totals[k])}`}</Txt>
            ))}
          </View>
        </Card>
      )}
      {g.can('items.create') && <Button title={t('money.addGuest')} color={color} onPress={sheet.show} testID="new-guest" style={{ marginVertical: 12 }} />}
      <Section title={t('money.guests')}>
        {q.data?.guests.length === 0 && <Empty title={t('group.nothingYet')} />}
        {q.data?.guests.map((x: any) => (
          <Card key={x.id} style={{ paddingVertical: 4 }} testID={`guest-${x.id}`}>
            <Row
              title={`${STATUS_EMOJI[x.status] ?? ''} ${x.name}${x.plusOnes ? ` ${t('money.plus', { count: x.plusOnes })}` : ''}`}
              subtitle={[t(`money.${x.status === 'invited' ? 'pending' : x.status}`), x.dietary].filter(Boolean).join(' · ')}
              right={
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {x.url && <Button small color="#1F8A4C" title={t('money.sendInvite')} onPress={() => invite(x)} testID={`guest-invite-${x.id}`} />}
                  {x.url && <Button small kind="secondary" title="🔗" accessibilityLabel={t('money.copyLink')} onPress={() => Clipboard.setStringAsync(x.url)} testID={`guest-copy-${x.id}`} />}
                  {g.can('items.create') && <Button small kind="secondary" title="🗑️" accessibilityLabel={t('common.delete')} onPress={async () => (await confirmAsk(t('common.delete'))) && run(() => del(`/groups/${id}/guests/${x.id}`))} />}
                </View>
              }
            />
          </Card>
        ))}
      </Section>
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('money.addGuest')} testID="guest-sheet">
        <Field label={t('money.guestName')} value={form.name} onChangeText={(s) => setForm({ ...form, name: s })} testID="guest-name" />
        <Field label={`${t('money.phone')} (${t('common.optional')})`} value={form.phone} onChangeText={(s) => setForm({ ...form, phone: s })} inputMode="tel" style={{ writingDirection: 'ltr' }} />
        <Field label={t('money.maxPlus')} value={form.maxPlusOnes} onChangeText={(s) => setForm({ ...form, maxPlusOnes: s })} inputMode="numeric" testID="guest-max-plus" />
        <Button
          title={t('common.save')}
          color={color}
          loading={pending}
          disabled={!form.name.trim()}
          testID="guest-save"
          onPress={async () => {
            await run(() => post(`/groups/${id}/guests`, { name: form.name.trim(), phone: form.phone.trim() || undefined, maxPlusOnes: Math.min(10, Math.max(0, Number(form.maxPlusOnes) || 0)) }));
            setForm({ name: '', phone: '', maxPlusOnes: '0' });
            sheet.hide();
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
