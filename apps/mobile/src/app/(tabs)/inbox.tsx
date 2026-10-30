import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Empty, Loading, Row, Screen } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct } from '@/lib/hooks';
import { hrefFor } from '@/lib/nav';
import { useFormat } from '@/lib/prefs';

export default function Inbox() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const router = useRouter();
  const q = useQuery({ queryKey: ['inbox'], queryFn: () => get('/me/inbox') });
  const { run } = useAct();
  return (
    <Screen title={t('inbox.title')} testID="inbox-screen" right={<Button small kind="ghost" title={t('inbox.markAllRead')} onPress={() => run(() => post('/me/inbox/read', {}))} />}>
      {q.isLoading && <Loading />}
      {q.data?.length === 0 && <Empty title={t('inbox.empty')} />}
      {q.data?.map((n: any) => (
        <Card key={n.id} style={{ paddingVertical: 4, opacity: n.readAt ? 0.6 : 1 }}>
          <Row
            title={n.title}
            subtitle={`${n.body ? n.body + ' · ' : ''}${fmt.dateTime(n.createdAt)}`}
            onPress={() => {
              run(() => post('/me/inbox/read', { ids: [n.id] }));
              const href = hrefFor(n);
              if (href) router.push(href as any);
            }}
          />
        </Card>
      ))}
    </Screen>
  );
}
