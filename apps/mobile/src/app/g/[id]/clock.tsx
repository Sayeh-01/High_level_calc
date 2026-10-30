import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { QR } from '@/components/QR';
import { Button, Card, Field, Muted, Row, Section, Txt, colors } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

/**
 * Time clock (v3.4). A manager's phone shows a QR that changes every 30 s; staff scan it with the phone camera (it opens
 * circleapp://g/<id>/clock?code=…) or type the 6 digits — the same flow on web (B7 #13 fallback). Geofence is a B5 Skip.
 */
export default function Clock() {
  const { id, code: linked } = useLocalSearchParams<{ id: string; code?: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { run, pending } = useAct(id);
  const tz = g.group?.timezone ?? 'Africa/Cairo';
  const manager = g.can('approve');
  const mine = useQuery({ queryKey: ['group', id, 'clock', 'me'], queryFn: () => get(`/groups/${id}/clock/me`) });
  const codeQ = useQuery({ queryKey: ['group', id, 'clock', 'code'], queryFn: () => get(`/groups/${id}/clock/code`), enabled: manager, refetchInterval: 5000 });
  const weekStart = new Date(Date.now() - ((new Date().getDay() + 6) % 7) * 86_400_000);
  weekStart.setHours(0, 0, 0, 0);
  const report = useQuery({ queryKey: ['group', id, 'clock', 'report'], queryFn: () => get(`/groups/${id}/clock/report?from=${weekStart.toISOString()}&to=${new Date(Date.now() + 86_400_000).toISOString()}`), enabled: manager });
  const [code, setCode] = useState(linked && /^\d{6}$/.test(linked) ? linked : '');
  const color = g.group?.color ?? colors.primary;
  const open = mine.data?.open;
  const hm = (min: number) => t('shifts.hours', { h: fmt.number(Math.floor(min / 60)), m: fmt.number(min % 60) });

  return (
    <GroupScreen id={id} active="clock">
      <Card accent={open ? colors.good : color} testID="clock-me">
        <Txt style={{ fontSize: 18, fontWeight: '700' }} testID="clock-status">{open ? t('shifts.inSince', { time: fmt.time(open.inAt, tz) }) : t('shifts.notIn')}</Txt>
        <Field label={t('shifts.enterCode')} value={code} onChangeText={(s) => setCode(s.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" style={{ fontSize: 24, letterSpacing: 6, writingDirection: 'ltr', textAlign: 'center' }} testID="clock-code" />
        <Button
          title={open ? t('shifts.clockOut') : t('shifts.clockIn')}
          color={open ? colors.danger : color}
          loading={pending}
          disabled={code.length !== 6}
          testID="clock-punch"
          onPress={async () => {
            await run(() => post(`/groups/${id}/clock/${open ? 'out' : 'in'}`, { code }));
            setCode('');
          }}
        />
      </Card>

      {manager && codeQ.data && (
        <Section title={t('shifts.showCode')}>
          <Card style={{ alignItems: 'center', gap: 10 }} testID="clock-qr">
            <QR value={`circleapp://g/${id}/clock?code=${codeQ.data.code}`} size={180} />
            <Txt style={{ fontSize: 34, fontWeight: '800', letterSpacing: 6, writingDirection: 'ltr' }} testID="clock-shown-code">{codeQ.data.code}</Txt>
            <Muted style={{ textAlign: 'center' }}>{t('shifts.codeHint')}</Muted>
          </Card>
        </Section>
      )}

      {manager && report.data && (
        <Section title={t('shifts.report')}>
          <Card testID="clock-report">
            {report.data.rows.map((r: any) => (
              <Row key={r.userId} title={g.memberName(r.userId)} right={<Txt>{hm(r.minutes)}</Txt>} />
            ))}
            <Row title={t('shifts.total')} right={<Txt style={{ fontWeight: '800' }}>{hm(report.data.totalMinutes)}</Txt>} />
            {report.data.stillOpen.length > 0 && <Muted>{`${t('shifts.stillIn')}: ${report.data.stillOpen.map((e: any) => g.memberName(e.userId)).join('، ')}`}</Muted>}
          </Card>
        </Section>
      )}

      <Section title={t('shifts.recent')}>
        <Card>
          {mine.data?.entries.map((e: any) => (
            <Row key={e.id} title={fmt.date(e.inAt, tz)} subtitle={`${fmt.time(e.inAt, tz)} – ${e.outAt ? fmt.time(e.outAt, tz) : '…'}`} />
          ))}
          <View />
        </Card>
      </Section>
    </GroupScreen>
  );
}
