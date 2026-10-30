import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, Empty, ErrorView, Loading, Row, Screen, Txt } from '@/components/ui';
import { useGroups } from '@/lib/hooks';

export default function Groups() {
  const { t } = useTranslation();
  const router = useRouter();
  const q = useGroups();
  return (
    <Screen title={t('groups.title')} testID="groups-screen">
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
        <Button style={{ flex: 1 }} title={t('groups.new')} onPress={() => router.push('/new-group')} testID="new-group" />
        <Button style={{ flex: 1 }} kind="secondary" title={t('groups.join')} onPress={() => router.push('/join/enter')} testID="join-group" />
      </View>
      {q.isLoading ? <Loading /> : q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data && q.data.length === 0 && <Empty title={t('groups.empty')} />}
      {q.data?.map((g: any) => (
        <Card key={g.id} accent={g.color} style={{ paddingVertical: 4 }} testID={`group-${g.id}`}>
          <Row
            title={g.name}
            subtitle={t('common.members', { count: g.memberCount })}
            left={<Txt style={{ fontSize: 28 }}>{g.emoji}</Txt>}
            right={<Badge count={g.unread} />}
            onPress={() => router.push(`/g/${g.id}`)}
            testID={`open-group-${g.id}`}
          />
        </Card>
      ))}
    </Screen>
  );
}
