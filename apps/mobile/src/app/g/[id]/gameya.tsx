import { localDayKey, parseMajorToMinor } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Chip, Empty, Field, Muted, Segmented, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function Gameyas() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const router = useRouter();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'gameya'], queryFn: () => get(`/groups/${id}/gameyas`) });
  const sheet = useSheet();
  const color = g.group?.color ?? colors.primary;
  const cur = g.group?.currency ?? 'EGP';
  const thisMonth = localDayKey(Date.now(), g.group?.timezone ?? 'Africa/Cairo').slice(0, 7);
  const adults = g.members.filter((m) => ['owner', 'admin', 'manager', 'member'].includes(m.role));
  const [form, setForm] = useState({ title: '', amount: '', startMonth: thisMonth, dueDay: '5', orderMode: 'agreed' as 'agreed' | 'drawn', order: [] as string[] });
  const [touched, setTouched] = useState(false);
  // everyone is in by default, including members who join while the screen is open, until the organizer edits the list
  useEffect(() => {
    if (g.group) setForm((f) => ({ ...f, title: f.title || g.group!.name, order: touched ? f.order : adults.map((m) => m.userId) }));
  }, [g.group?.id, adults.length]);
  const toggle = (u: string) => {
    setTouched(true);
    setForm((f) => ({ ...f, order: f.order.includes(u) ? f.order.filter((x) => x !== u) : [...f.order, u] }));
  };

  return (
    <GroupScreen id={id} active="gameya">
      {g.can('approve') && <Button title={t('gameya.start')} color={color} onPress={sheet.show} testID="new-gameya" style={{ marginBottom: 12 }} />}
      {q.data?.length === 0 && <Empty title={t('gameya.empty')} hint={t('gameya.tracking')} />}
      {q.data?.map((x: any) => (
        <Card key={x.id} accent={color} onPress={() => router.push(`/g/${id}/gameya/${x.id}`)} testID={`gameya-${x.id}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Txt style={{ fontSize: 17, fontWeight: '700', flex: 1 }}>{`💰 ${x.title}${x.round > 1 ? ` · ${t('gameya.round', { n: fmt.number(x.round) })}` : ''}`}</Txt>
            <Txt style={{ fontWeight: '700' }}>{fmt.money(x.pot, cur)}</Txt>
          </View>
          <Muted>
            {x.status === 'done' ? t('gameya.done') : t('gameya.monthOf', { n: fmt.number(Math.min(Math.max(x.current, 1), x.months)), total: fmt.number(x.months) })}
            {x.myTurn ? ` · ${t('gameya.myTurn', { n: fmt.number(x.myTurn) })}` : ''}
          </Muted>
        </Card>
      ))}
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('gameya.start')} testID="gameya-sheet">
        <Field label={t('gameya.name')} value={form.title} onChangeText={(s) => setForm({ ...form, title: s })} testID="gameya-title" />
        <Field label={`${t('gameya.amount')} (${cur})`} value={form.amount} onChangeText={(s) => setForm({ ...form, amount: s })} inputMode="decimal" testID="gameya-amount" />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label={t('gameya.startMonth')} value={form.startMonth} onChangeText={(s) => setForm({ ...form, startMonth: s })} style={{ writingDirection: 'ltr' }} testID="gameya-start" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label={t('gameya.dueDay')} value={form.dueDay} onChangeText={(s) => setForm({ ...form, dueDay: s })} inputMode="numeric" testID="gameya-due-day" />
          </View>
        </View>
        <Segmented<'agreed' | 'drawn'> value={form.orderMode} onChange={(m) => setForm({ ...form, orderMode: m })} options={[{ value: 'agreed', label: t('gameya.agreed') }, { value: 'drawn', label: t('gameya.drawn') }]} />
        <Muted style={{ marginBottom: 8 }}>{form.orderMode === 'agreed' ? t('gameya.orderHint') : t('gameya.members')}</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {adults.map((m) => {
            const i = form.order.indexOf(m.userId);
            return <Chip key={m.userId} label={`${i >= 0 && form.orderMode === 'agreed' ? `${fmt.number(i + 1)}. ` : ''}${m.displayName}`} active={i >= 0} color={color} onPress={() => toggle(m.userId)} testID={`gameya-member-${m.userId}`} />;
          })}
        </View>
        {parseMajorToMinor(form.amount) ? <Muted style={{ marginBottom: 8 }}>{`${t('gameya.pot')}: ${fmt.money((parseMajorToMinor(form.amount) ?? 0) * form.order.length, cur)}`}</Muted> : null}
        <Muted style={{ marginBottom: 12 }}>{t('gameya.tracking')}</Muted>
        <Button
          title={t('common.create')}
          color={color}
          loading={pending}
          disabled={!form.title.trim() || !parseMajorToMinor(form.amount) || form.order.length < 2 || !/^\d{4}-\d{2}$/.test(form.startMonth)}
          testID="gameya-save"
          onPress={async () => {
            const res = await run(() =>
              post(`/groups/${id}/gameyas`, { title: form.title.trim(), amount: parseMajorToMinor(form.amount), startMonth: form.startMonth, dueDay: Math.min(28, Math.max(1, Number(form.dueDay) || 1)), orderMode: form.orderMode, memberIds: form.order }),
            );
            sheet.hide();
            router.push(`/g/${id}/gameya/${res.id}`);
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
