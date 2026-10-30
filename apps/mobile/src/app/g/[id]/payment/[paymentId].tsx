import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorView, Loading, Muted, Row, Screen, Txt, colors } from '@/components/ui';
import { get } from '@/lib/api';
import { notifyError, useGroup } from '@/lib/hooks';
import { useFormat, usePrefs } from '@/lib/prefs';
import { printHtml } from '@/lib/print';

/** Where the gateway sends the payer back. Waits for the webhook (polling; the socket also refreshes it). */
export default function PaymentStatus() {
  const { id, paymentId } = useLocalSearchParams<{ id: string; paymentId: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { lang } = usePrefs();
  const router = useRouter();
  const q = useQuery({
    queryKey: ['group', id, 'payments', paymentId],
    queryFn: () => get(`/groups/${id}/payments/${paymentId}`),
    refetchInterval: (query) => ((query.state.data as any)?.status === 'created' ? 2000 : false),
  });
  if (q.isLoading) return <Screen title={t('pay.status')} back><Loading /></Screen>;
  if (q.error || !q.data) return <Screen title={t('pay.status')} back><ErrorView error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const p = q.data;
  const cur = p.currency;
  const tone = p.status === 'succeeded' ? colors.good : p.status === 'failed' ? colors.danger : colors.warn;
  return (
    <Screen title={t('pay.status')} back accent={g.group?.color} testID="payment-screen">
      <Card accent={tone}>
        <Txt style={{ fontSize: 22, fontWeight: '800', color: tone }} testID="payment-status">{t(`pay.${p.status}`)}</Txt>
        {p.status === 'failed' && <Muted>{t(`pay.reason_${p.failureCode}`, { defaultValue: p.failureCode })}</Muted>}
        <View style={{ marginTop: 10 }}>
          <Row title={t(`pay.purpose_${p.purpose}`)} subtitle={`${g.memberName(p.payerId)} → ${g.memberName(p.payeeId)}`} />
          <Row title={t('pay.amount')} right={<Txt>{fmt.money(p.amountMinor, cur)}</Txt>} />
          <Row title={t('pay.fee')} right={<Txt>{fmt.money(p.feeMinor, cur)}</Txt>} />
          <Row title={t('pay.total')} right={<Txt style={{ fontWeight: '800' }}>{fmt.money(p.totalMinor, cur)}</Txt>} />
        </View>
      </Card>
      {p.receipt && (
        <Button
          kind="secondary"
          title={`🧾 ${t('pay.receiptNo', { n: p.receipt.number })}`}
          testID="payment-receipt"
          style={{ marginBottom: 12 }}
          onPress={async () => {
            try {
              const r = await get(`/groups/${id}/payments/${paymentId}/receipt?lang=${lang}`);
              await printHtml(r.html, r.number);
            } catch (e) {
              notifyError(e);
            }
          }}
        />
      )}
      <Button title={t('pay.back')} color={g.group?.color} onPress={() => router.replace(`/g/${id}`)} testID="payment-back" />
    </Screen>
  );
}
