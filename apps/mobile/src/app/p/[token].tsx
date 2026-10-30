import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Empty, Loading, Screen } from '@/components/ui';
import { get } from '@/lib/api';

/** circleapp://p/<token> (from a guest page's install banner): open the item in-app if you're a member. */
export default function SharedItem() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const info = useQuery({ queryKey: ['guest', token], queryFn: () => get(`/guest/${token}`), retry: false });
  const open = useQuery({ queryKey: ['guest', token, 'open'], queryFn: () => get(`/guest/${token}/open`), retry: false });
  useEffect(() => {
    const o = open.data;
    if (o) router.replace(o.entity === 'event' ? `/g/${o.groupId}/event/${o.entityId}` : `/g/${o.groupId}/list/${o.entityId}`);
  }, [open.data]);
  return (
    <Screen title={t('reach.sharedItem')} back>
      {info.isLoading || open.isLoading ? <Loading /> : <Empty title={info.data ? `${info.data.group.emoji} ${info.data.group.name}` : t('common.error')} hint={t('reach.askInvite')} />}
    </Screen>
  );
}
