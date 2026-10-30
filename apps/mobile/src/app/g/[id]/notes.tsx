import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Empty, Row } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function Notes() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const router = useRouter();
  const { run } = useAct(id);
  const pages = useQuery({ queryKey: ['group', id, 'pages'], queryFn: () => get(`/groups/${id}/pages`) });
  return (
    <GroupScreen id={id} active="notes">
      {g.can('items.create') && (
        <Button
          title={t('study.newPage')}
          color={g.group?.color}
          style={{ marginBottom: 12 }}
          testID="new-page"
          onPress={async () => {
            const p = await run(() => post(`/groups/${id}/pages`, { title: t('study.newPage'), body: '' }));
            router.push(`/g/${id}/page/${p.id}?edit=1`);
          }}
        />
      )}
      {pages.data?.length === 0 && <Empty title={t('group.nothingYet')} />}
      {pages.data?.map((p: any) => (
        <Card key={p.id} style={{ paddingVertical: 4 }}>
          <Row title={`📄 ${p.title}`} subtitle={`${g.memberName(p.updatedBy)} · ${fmt.date(p.updatedAt)}`} onPress={() => router.push(`/g/${id}/page/${p.id}`)} testID={`page-${p.id}`} />
        </Card>
      ))}
    </GroupScreen>
  );
}
