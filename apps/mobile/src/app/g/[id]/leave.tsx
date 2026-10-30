import { localDayKey } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Chip, Field, Muted, Row, Section, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { del, get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export default function Leave() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { run, pending } = useAct(id);
  const today = localDayKey(Date.now(), g.group?.timezone ?? 'Africa/Cairo');
  const q = useQuery({ queryKey: ['group', id, 'leave'], queryFn: () => get(`/groups/${id}/time-off?from=${today}&to=${addDays(today, 90)}`) });
  const sheet = useSheet();
  const color = g.group?.color ?? colors.primary;
  const me = g.me?.userId;
  const [form, setForm] = useState({ startDay: today, endDay: today, kind: 'vacation' as 'vacation' | 'sick' | 'other', note: '' });
  const week = addDays(today, 6);
  const rows: any[] = q.data ?? [];
  const thisWeek = rows.filter((l) => l.status === 'approved' && l.startDay <= week && l.endDay >= today);
  const later = rows.filter((l) => !thisWeek.includes(l));
  const day = (d: string) => fmt.date(`${d}T12:00:00Z`, 'UTC');
  const line = (l: any) => (
    <Card key={l.id} style={{ paddingVertical: 4 }} testID={`leave-${l.id}`}>
      <Row
        title={`${l.userId === me ? t('common.you') : g.memberName(l.userId)} · ${t(`work.kind_${l.kind}`)}`}
        subtitle={`${day(l.startDay)} → ${day(l.endDay)}${l.status === 'pending' ? ` · ${t('work.pending')}` : ''}`}
        right={
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {l.status === 'pending' && g.can('approve') && l.userId !== me && (
              <>
                <Button small color={color} title={t('work.approve')} onPress={() => run(() => post(`/groups/${id}/time-off/${l.id}/approve`))} testID={`approve-${l.id}`} />
                <Button small kind="secondary" title={t('work.reject')} onPress={() => run(() => post(`/groups/${id}/time-off/${l.id}/reject`))} />
              </>
            )}
            {l.userId === me && <Button small kind="ghost" title="✕" accessibilityLabel={t('common.delete')} onPress={() => run(() => del(`/groups/${id}/time-off/${l.id}`))} />}
          </View>
        }
      />
    </Card>
  );
  return (
    <GroupScreen id={id} active="leave">
      <Button title={`🌴 ${t('work.bookLeave')}`} color={color} onPress={sheet.show} testID="new-leave" style={{ marginBottom: 12 }} />
      <Section title={t('work.offThisWeek')}>
        {thisWeek.length === 0 ? <Muted>{t('work.nobodyOff')}</Muted> : thisWeek.map(line)}
      </Section>
      {later.length > 0 && <Section title={t('work.upcoming')}>{later.map(line)}</Section>}
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('work.bookLeave')} testID="leave-sheet">
        <Field label={t('work.from')} value={form.startDay} onChangeText={(s) => setForm({ ...form, startDay: s })} style={{ writingDirection: 'ltr' }} testID="leave-from" />
        <Field label={t('work.to')} value={form.endDay} onChangeText={(s) => setForm({ ...form, endDay: s })} style={{ writingDirection: 'ltr' }} testID="leave-to" />
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {(['vacation', 'sick', 'other'] as const).map((k) => (
            <Chip key={k} label={t(`work.kind_${k}`)} active={form.kind === k} color={color} onPress={() => setForm({ ...form, kind: k })} />
          ))}
        </View>
        <Button
          title={t('common.save')}
          color={color}
          loading={pending}
          disabled={!/^\d{4}-\d{2}-\d{2}$/.test(form.startDay) || !/^\d{4}-\d{2}-\d{2}$/.test(form.endDay)}
          testID="leave-save"
          onPress={async () => {
            await run(() => post(`/groups/${id}/time-off`, { startDay: form.startDay, endDay: form.endDay, kind: form.kind, note: form.note || undefined }));
            sheet.hide();
          }}
        />
      </Sheet>
      <Txt> </Txt>
    </GroupScreen>
  );
}
