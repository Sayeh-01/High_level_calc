import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Field, Loading, Muted, Row, Screen, Section, Txt, colors } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';

export default function Deck() {
  const { id, deckId } = useLocalSearchParams<{ id: string; deckId: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { run } = useAct(id);
  const deck = useQuery({ queryKey: ['group', id, 'deck', deckId], queryFn: () => get(`/groups/${id}/decks/${deckId}`) });
  const due = useQuery({ queryKey: ['group', id, 'deck', deckId, 'study'], queryFn: () => get(`/groups/${id}/decks/${deckId}/study`) });
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [studying, setStudying] = useState(false);
  const [shown, setShown] = useState(false);
  const color = g.group?.color ?? colors.primary;
  if (deck.isLoading) return <Screen title="" back><Loading /></Screen>;
  const card = due.data?.[0];

  async function grade(n: number) {
    await post(`/groups/${id}/cards/${card.id}/review`, { grade: n });
    setShown(false);
    await qc.invalidateQueries({ queryKey: ['group', id, 'deck', deckId, 'study'] });
  }

  return (
    <Screen title={deck.data?.deck.title ?? ''} back accent={color} testID="deck-screen">
      {studying ? (
        card ? (
          <Card style={{ minHeight: 220, justifyContent: 'center', alignItems: 'center' }} testID="study-card">
            <Txt style={{ fontSize: 22, fontWeight: '700', textAlign: 'center' }}>{card.front}</Txt>
            {shown ? (
              <>
                <Txt style={{ fontSize: 20, marginTop: 16, color, textAlign: 'center' }} testID="study-answer">
                  {card.back}
                </Txt>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <Button small kind="secondary" title={t('study.again')} onPress={() => grade(1)} testID="grade-again" />
                  <Button small kind="secondary" title={t('study.hard')} onPress={() => grade(3)} />
                  <Button small color={color} title={t('study.good')} onPress={() => grade(4)} testID="grade-good" />
                  <Button small kind="secondary" title={t('study.easy')} onPress={() => grade(5)} />
                </View>
              </>
            ) : (
              <Button title={t('study.show')} color={color} onPress={() => setShown(true)} style={{ marginTop: 20 }} testID="study-show" />
            )}
          </Card>
        ) : (
          <Card>
            <Txt style={{ textAlign: 'center' }} testID="study-done">
              {t('study.doneForNow')}
            </Txt>
          </Card>
        )
      ) : (
        <Button title={`${t('study.study')} · ${t('study.due', { count: due.data?.length ?? 0 })}`} color={color} onPress={() => setStudying(true)} testID="study-start" style={{ marginBottom: 12 }} />
      )}
      {studying && <Button kind="ghost" title={t('common.close')} onPress={() => setStudying(false)} />}
      {g.can('items.create') && !studying && (
        <Section title={t('study.addCard')}>
          <Field label={t('study.front')} value={front} onChangeText={setFront} testID="card-front" />
          <Field label={t('study.back')} value={back} onChangeText={setBack} testID="card-back" />
          <Button
            small
            kind="secondary"
            title={t('study.addCard')}
            disabled={!front.trim() || !back.trim()}
            testID="card-save"
            onPress={() => run(() => post(`/groups/${id}/decks/${deckId}/cards`, { front: front.trim(), back: back.trim() })).then(() => (setFront(''), setBack('')))}
          />
        </Section>
      )}
      {!studying && (
        <Card style={{ paddingVertical: 4 }}>
          {deck.data?.cards.map((c: any) => (
            <Row key={c.id} title={c.front} subtitle={c.back} />
          ))}
          {deck.data?.cards.length === 0 && <Muted style={{ padding: 8 }}>{t('group.nothingYet')}</Muted>}
        </Card>
      )}
    </Screen>
  );
}
