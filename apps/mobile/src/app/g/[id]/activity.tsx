import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Card, Loading, Row, Screen } from '@/components/ui';
import { get } from '@/lib/api';
import { useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function Activity() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const q = useQuery({ queryKey: ['group', id, 'activity'], queryFn: () => get(`/groups/${id}/activity`) });
  return (
    <Screen title={t('group.activity')} back accent={g.group?.color} testID="activity-screen">
      {q.isLoading && <Loading />}
      <Card style={{ paddingVertical: 4 }}>
        {q.data?.map((a: any) => (
          <Row key={a.id} title={`${a.actorId ? g.memberName(a.actorId) : 'Circle'} ${t(`activity.${a.verb}`, { defaultValue: a.verb })} ${a.summary || ''}`.trim()} subtitle={fmt.dateTime(a.createdAt)} />
        ))}
      </Card>
    </Screen>
  );
}
