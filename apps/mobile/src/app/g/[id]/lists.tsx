import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Empty, Field, Loading, Row, Sheet, Txt, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';

export default function Lists() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const router = useRouter();
  const q = useQuery({ queryKey: ['group', id, 'lists'], queryFn: () => get(`/groups/${id}/lists`) });
  const { run, pending } = useAct(id);
  const sheet = useSheet();
  const [title, setTitle] = useState('');
  return (
    <GroupScreen id={id} active="lists">
      {g.can('lists.create') && <Button title={t('lists.new')} onPress={sheet.show} testID="new-list" style={{ marginBottom: 12 }} color={g.group?.color} />}
      {q.isLoading && <Loading />}
      {q.data?.length === 0 && <Empty title={t('group.nothingYet')} />}
      {q.data?.map((l: any) => (
        <Card key={l.id} style={{ paddingVertical: 4 }}>
          <Row title={l.title} subtitle={t('lists.items', { count: l.open })} left={<Txt style={{ fontSize: 22 }}>📝</Txt>} onPress={() => router.push(`/g/${id}/list/${l.id}`)} testID={`list-${l.id}`} />
        </Card>
      ))}
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('lists.new')}>
        <Field value={title} onChangeText={setTitle} testID="list-title" autoFocus />
        <Button
          title={t('common.create')}
          disabled={!title.trim()}
          loading={pending}
          testID="list-save"
          onPress={async () => {
            const l = await run(() => post(`/groups/${id}/lists`, { title: title.trim() }));
            setTitle('');
            sheet.hide();
            router.push(`/g/${id}/list/${l.id}`);
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
