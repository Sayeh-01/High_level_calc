import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Empty, Field, Row, Sheet, Txt, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';

export default function Flashcards() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const router = useRouter();
  const { run, pending } = useAct(id);
  const decks = useQuery({ queryKey: ['group', id, 'decks'], queryFn: () => get(`/groups/${id}/decks`) });
  const sheet = useSheet();
  const [title, setTitle] = useState('');
  return (
    <GroupScreen id={id} active="flashcards">
      {g.can('items.create') && <Button title={t('study.newDeck')} onPress={sheet.show} color={g.group?.color} testID="new-deck" style={{ marginBottom: 12 }} />}
      {decks.data?.length === 0 && <Empty title={t('group.nothingYet')} />}
      {decks.data?.map((d: any) => (
        <Card key={d.id} style={{ paddingVertical: 4 }}>
          <Row title={d.title} subtitle={`${t('study.cards', { count: d.cards })} · ${t('study.due', { count: d.due })}`} left={<Txt style={{ fontSize: 22 }}>🃏</Txt>} onPress={() => router.push(`/g/${id}/deck/${d.id}`)} testID={`deck-${d.id}`} />
        </Card>
      ))}
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('study.newDeck')}>
        <Field value={title} onChangeText={setTitle} testID="deck-title" autoFocus />
        <Button
          title={t('common.create')}
          loading={pending}
          disabled={!title.trim()}
          testID="deck-save"
          onPress={async () => {
            const d = await run(() => post(`/groups/${id}/decks`, { title: title.trim() }));
            setTitle('');
            sheet.hide();
            router.push(`/g/${id}/deck/${d.id}`);
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
