import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Share, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { QR } from '@/components/QR';
import { Button, Card, ErrorView, Loading, Muted, Screen, Txt, colors } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';

export default function Invite() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const g = useGroup(id);
  const q = useQuery({ queryKey: ['group', id, 'invite'], queryFn: () => get(`/groups/${id}/invite`) });
  const plan = useQuery({ queryKey: ['group', id, 'plan'], queryFn: () => get(`/groups/${id}/plan`) });
  const { run } = useAct(id);
  const [copied, setCopied] = useState(false);
  const text = q.data && g.group ? t('invite.shareText', { name: g.group.name, link: q.data.webLink, code: q.data.code }) : '';
  return (
    <Screen title={t('invite.title')} back testID="invite-screen" accent={g.group?.color}>
      {q.isLoading && <Loading />}
      {q.error ? <ErrorView error={q.error} /> : null}
      {plan.data?.full && (
        <Card accent={colors.danger} testID="invite-full">
          <Txt style={{ fontWeight: '700' }}>{t('plans.full')}</Txt>
          <Muted>{t('plans.fullHint', { limit: plan.data.limit })}</Muted>
          {g.can('group.settings') && <Button small style={{ marginTop: 8, alignSelf: 'flex-start' }} title={t('plans.upgradeGroup')} onPress={() => router.push(`/paywall?plan=group_pro&groupId=${id}`)} testID="invite-upgrade" />}
        </Card>
      )}
      {q.data && (
        <>
          <Card style={{ alignItems: 'center', gap: 12 }}>
            <Muted>{t('invite.code')}</Muted>
            <Txt style={{ fontSize: 34, fontWeight: '800', letterSpacing: 4, color: g.group?.color ?? colors.primary, writingDirection: 'ltr' }} testID="invite-code">
              {q.data.code}
            </Txt>
            <QR value={q.data.webLink} size={180} />
            <Muted>{t('invite.scan')}</Muted>
            {plan.data && <Muted testID="invite-seats">{t('plans.seats', { members: plan.data.members, limit: plan.data.limit })}</Muted>}
          </Card>
          <View style={{ gap: 10 }}>
            <Button title={t('common.whatsapp')} color="#1F8A4C" onPress={() => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`)} testID="invite-whatsapp" />
            <Button kind="secondary" title={t('invite.shareLink')} onPress={() => Share.share({ message: text })} />
            <Button
              kind="secondary"
              title={copied ? t('common.copied') : t('invite.copyCode')}
              testID="invite-copy"
              onPress={async () => {
                await Clipboard.setStringAsync(q.data.code);
                setCopied(true);
              }}
            />
            {g.can('group.settings') && <Button kind="ghost" title={t('invite.rotate')} onPress={() => run(() => post(`/groups/${id}/invite/rotate`))} />}
            {fresh ? <Button title={t('invite.later')} onPress={() => router.replace(`/g/${id}`)} testID="invite-done" /> : null}
          </View>
        </>
      )}
    </Screen>
  );
}
