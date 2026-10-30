import { partRanges } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Chip, Empty, Field, Muted, Segmented, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { localDigits } from '@/lib/i18n';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat, usePrefs } from '@/lib/prefs';

type Preset = 'khatma' | 'book' | 'daily';

export default function Challenges() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { lang } = usePrefs();
  const router = useRouter();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'challenges'], queryFn: () => get(`/groups/${id}/challenges`) });
  const sheet = useSheet();
  const color = g.group?.color ?? colors.primary;
  const people = g.members.filter((m) => m.role !== 'guest');
  const [preset, setPreset] = useState<Preset>('khatma');
  const [form, setForm] = useState({ title: '', parts: '30', partLabel: '', target: '20', unit: '', memberIds: [] as string[] });
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (people.length && !touched) setForm((f) => ({ ...f, memberIds: people.map((m) => m.userId) }));
  }, [people.length]);
  const choose = (p: Preset) => {
    setPreset(p);
    setForm((f) => ({ ...f, title: p === 'khatma' ? t('challenge.khatma') : '', parts: p === 'khatma' ? '30' : '12', partLabel: p === 'khatma' ? t('challenge.juz') : p === 'book' ? t('challenge.chapter') : '' }));
  };
  // Hijri date for the Faith template (A14)
  const hijri = g.group?.type === 'faith' ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-islamic-umalqura-nu-latn' : 'en-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()) : null;

  return (
    <GroupScreen id={id} active="challenges">
      {hijri && <Muted style={{ marginBottom: 8 }} testID="hijri-date">{`🌙 ${hijri}`}</Muted>}
      {g.can('items.create') && <Button title={t('challenge.new')} color={color} onPress={() => (choose('khatma'), sheet.show())} testID="new-challenge" style={{ marginBottom: 12 }} />}
      {q.data?.length === 0 && <Empty title={t('group.nothingYet')} />}
      {q.data?.map((c: any) => (
        <Card key={c.id} accent={color} onPress={() => router.push(`/g/${id}/challenge/${c.id}`)} testID={`challenge-${c.id}`}>
          <Txt style={{ fontSize: 17, fontWeight: '700' }}>{`🏁 ${c.title}`}</Txt>
          {c.kind === 'split' ? (
            <>
              <Muted>{`${t('challenge.round', { n: fmt.number(c.round) })} · ${t('challenge.progress', { done: fmt.number(c.done), total: fmt.number(c.total) })}`}</Muted>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, marginTop: 8, overflow: 'hidden' }}>
                <View style={{ width: `${c.total ? (c.done / c.total) * 100 : 0}%`, height: 6, backgroundColor: color }} />
              </View>
              {c.myOpen.length > 0 && <Txt style={{ marginTop: 6, fontWeight: '600' }}>{`${t('challenge.yours')}: ${localDigits(partRanges(c.myOpen))}`}</Txt>}
            </>
          ) : (
            <Muted>{`${fmt.number(c.mine.today)} / ${fmt.number(c.target)} ${c.unit ?? ''} · ${t('challenge.streak', { n: fmt.number(c.mine.streak) })}`}</Muted>
          )}
        </Card>
      ))}
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('challenge.new')} testID="challenge-sheet">
        <Segmented<Preset> value={preset} onChange={choose} options={[{ value: 'khatma', label: t('challenge.khatma') }, { value: 'book', label: t('challenge.book') }, { value: 'daily', label: t('challenge.daily') }]} />
        <Field label={t('challenge.title')} value={form.title} onChangeText={(s) => setForm({ ...form, title: s })} testID="challenge-title" />
        {preset === 'daily' ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Field label={t('challenge.target')} value={form.target} onChangeText={(s) => setForm({ ...form, target: s })} inputMode="numeric" testID="challenge-target" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label={t('challenge.unit')} value={form.unit} onChangeText={(s) => setForm({ ...form, unit: s })} />
            </View>
          </View>
        ) : (
          <>
            {preset === 'book' && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Field label={t('challenge.parts')} value={form.parts} onChangeText={(s) => setForm({ ...form, parts: s })} inputMode="numeric" testID="challenge-parts" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label={t('challenge.partLabel')} value={form.partLabel} onChangeText={(s) => setForm({ ...form, partLabel: s })} />
                </View>
              </View>
            )}
            <Muted style={{ marginBottom: 6 }}>{t('challenge.who')}</Muted>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              {people.map((m) => {
                const on = form.memberIds.includes(m.userId);
                return <Chip key={m.userId} label={m.displayName} active={on} color={color} onPress={() => (setTouched(true), setForm({ ...form, memberIds: on ? form.memberIds.filter((x) => x !== m.userId) : [...form.memberIds, m.userId] }))} />;
              })}
            </View>
            <Muted style={{ marginBottom: 12 }}>{t('challenge.autoNext')}</Muted>
          </>
        )}
        <Button
          title={t('common.create')}
          color={color}
          loading={pending}
          testID="challenge-save"
          disabled={!form.title.trim() || (preset === 'daily' ? !(Number(form.target) > 0) : !form.memberIds.length || !(Number(form.parts) > 0))}
          onPress={async () => {
            const body =
              preset === 'daily'
                ? { kind: 'tally', title: form.title.trim(), target: Number(form.target), unit: form.unit.trim() }
                : { kind: 'split', title: form.title.trim(), totalParts: Number(form.parts), partLabel: form.partLabel.trim() || t('challenge.partDefault'), memberIds: form.memberIds };
            const res = await run(() => post(`/groups/${id}/challenges`, body));
            sheet.hide();
            router.push(`/g/${id}/challenge/${res.id}`);
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
