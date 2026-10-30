import { PLANS, type PlanId } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Muted, Screen, Txt, colors } from '@/components/ui';
import { get } from '@/lib/api';
import { localDigits } from '@/lib/i18n';
import { notifyError, useGroup } from '@/lib/hooks';
import { usePrefs, useFormat } from '@/lib/prefs';
import { StoreUnavailable, purchases } from '@/lib/purchases';

/** Paywall (v2.4). Shows the plans for sale; buying goes through the store adapter, never through our API. */
export default function Paywall() {
  const { plan: focus, groupId } = useLocalSearchParams<{ plan?: string; groupId?: string }>();
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const fmt = useFormat();
  const g = useGroup(groupId);
  const myPlan = useQuery({ queryKey: ['me', 'plan'], queryFn: () => get('/me/plan') });
  const groupPlan = useQuery({ queryKey: ['group', groupId, 'plan'], queryFn: () => get(`/groups/${groupId}/plan`), enabled: !!groupId });
  const [unavailable, setUnavailable] = useState(false);
  const sold = Object.values(PLANS).filter((p) => p.sold && (p.scope === 'user' || groupId));
  sold.sort((a, b) => Number(b.id === focus) - Number(a.id === focus));
  const price = (p: (typeof PLANS)[PlanId]) => {
    const egp = fmt.money(p.price.egp, 'EGP');
    const usd = fmt.money(p.price.usd, 'USD');
    return t(p.price.per === 'seat' ? 'plans.perSeat' : p.price.per === 'unit' ? 'plans.perUnit' : 'plans.perMonth', { price: `${egp} · ${usd}` });
  };
  const isActive = (id: PlanId) => (id === 'plus' ? !!myPlan.data?.plus : groupPlan.data?.plan === id);

  return (
    <Screen title={t('plans.title')} back testID="paywall-screen" accent={g.group?.color}>
      {groupPlan.data && (
        <Card testID="paywall-group-status">
          <Muted>{`${g.group?.emoji ?? ''} ${g.group?.name ?? ''}`.trim()}</Muted>
          <Txt style={{ fontSize: 17, fontWeight: '700' }}>{`${t('plans.current')}: ${PLANS[groupPlan.data.plan as PlanId]?.name[lang] ?? groupPlan.data.plan}`}</Txt>
          <Muted style={{ color: groupPlan.data.full ? colors.danger : colors.muted }}>{t('plans.seats', { members: fmt.number(groupPlan.data.members), limit: fmt.number(groupPlan.data.limit) })}</Muted>
        </Card>
      )}
      {sold.map((p) => (
        <Card key={p.id} accent={p.id === focus ? g.group?.color ?? colors.primary : undefined} testID={`plan-${p.id}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Txt style={{ fontSize: 19, fontWeight: '800', flex: 1 }}>{p.name[lang]}</Txt>
            {isActive(p.id) && <Txt style={{ color: colors.good, fontWeight: '700' }}>{`✓ ${t('plans.active')}`}</Txt>}
          </View>
          <Muted>{p.scope === 'user' ? t('plans.plusHint') : t('plans.groupHint')}</Muted>
          <View style={{ marginVertical: 10, gap: 4 }}>
            {p.features.map((f) => (
              <Txt key={f.en}>{`• ${localDigits(f[lang])}`}</Txt>
            ))}
          </View>
          <Txt style={{ fontWeight: '700', marginBottom: 10 }}>{price(p)}</Txt>
          {!isActive(p.id) && (
            <Button
              title={p.id === 'group_pro' ? t('plans.upgradeGroup') : t('plans.upgrade')}
              color={g.group?.color}
              testID={`buy-${p.id}`}
              onPress={async () => {
                try {
                  await purchases.purchase(p.id, p.scope === 'group' ? groupId : undefined);
                } catch (e) {
                  if (e instanceof StoreUnavailable) setUnavailable(true);
                  else notifyError(e);
                }
              }}
            />
          )}
        </Card>
      ))}
      {unavailable && <Muted style={{ color: colors.warn, marginTop: 4 }} testID="paywall-store-soon">{t('plans.storeSoon')}</Muted>}
    </Screen>
  );
}
