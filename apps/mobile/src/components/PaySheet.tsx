import { paymentQuote } from '@circle/shared';
import { useRouter } from 'expo-router';
import { Linking, Platform, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Muted, Row, Sheet, Txt } from './ui';
import { post } from '@/lib/api';
import { useAct, useConfig } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export type PayTarget = { purpose: 'due' | 'gameya'; targetId: string } | { purpose: 'settlement'; targetId: string; amount: number };

/**
 * Shows amount + fee = total before leaving for the gateway (the server re-prices it; this is the same formula from
 * @circle/shared). The gateway returns to /g/:id/payment/:paymentId, which waits for the webhook.
 */
export function PaySheet({ groupId, target, amount, currency, payeeName, color, onClose }: { groupId: string; target: PayTarget | null; amount: number; currency: string; payeeName: string; color?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const router = useRouter();
  const config = useConfig();
  const { run, pending } = useAct(groupId);
  if (!config.data?.payments) return null;
  const quote = amount > 0 ? paymentQuote(amount, config.data.fee) : null;
  return (
    <Sheet visible={!!target} onClose={onClose} title={t('pay.title')} testID="pay-sheet">
      {quote && (
        <View style={{ marginBottom: 12 }}>
          <Row title={t('pay.amount')} right={<Txt>{fmt.money(quote.amount, currency)}</Txt>} />
          <Row title={t('pay.fee')} right={<Txt testID="pay-fee">{fmt.money(quote.fee, currency)}</Txt>} />
          <Row title={t('pay.total')} right={<Txt style={{ fontWeight: '800' }} testID="pay-total">{fmt.money(quote.total, currency)}</Txt>} />
          <Muted style={{ marginTop: 6 }}>{t('pay.receives', { name: payeeName, amount: fmt.money(quote.amount, currency) })}</Muted>
        </View>
      )}
      <Muted style={{ marginBottom: 12 }}>{t('pay.note')}</Muted>
      <Button
        title={t('pay.continue')}
        color={color}
        loading={pending}
        disabled={!target || !quote}
        testID="pay-continue"
        onPress={async () => {
          const res = await run(() => post(`/groups/${groupId}/payments`, target));
          onClose();
          if (Platform.OS === 'web') {
            window.location.assign(res.checkoutUrl);
            return;
          }
          router.push(`/g/${groupId}/payment/${res.payment.id}`);
          await Linking.openURL(res.checkoutUrl);
        }}
      />
    </Sheet>
  );
}
