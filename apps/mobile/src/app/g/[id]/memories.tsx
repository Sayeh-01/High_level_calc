import { localDayKey } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Field, Muted, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { authHeaders, fileUrl, get, post, uploadFile } from '@/lib/api';
import { notifyError, useAct, useGroup } from '@/lib/hooks';
import { useFormat, usePrefs } from '@/lib/prefs';
import { printHtml } from '@/lib/print';

export default function Memories() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { lang } = usePrefs();
  const { run, pending } = useAct(id);
  const year = new Date().getFullYear();
  const q = useQuery({ queryKey: ['group', id, 'memories'], queryFn: () => get(`/groups/${id}/memories`) });
  const sheet = useSheet();
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; mime: string }[]>([]);
  const color = g.group?.color ?? colors.primary;
  return (
    <GroupScreen id={id} active="memories">
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        {g.can('items.create') && <Button style={{ flex: 1 }} title={t('life.addMemory')} color={color} onPress={sheet.show} testID="new-memory" />}
        <Button
          style={{ flex: 1 }}
          kind="secondary"
          title={t('life.book', { year })}
          testID="memories-book"
          onPress={async () => {
            try {
              const book = await get(`/groups/${id}/memories/book?year=${year}&lang=${lang}`);
              await printHtml(book.html, book.title);
            } catch (e) {
              notifyError(e);
            }
          }}
        />
      </View>
      {q.data?.map((m: any) => (
        <Card key={m.id} accent={color} testID={`memory-${m.id}`}>
          <Muted>
            {fmt.date(`${m.day}T12:00:00Z`, 'UTC')} · {g.memberName(m.userId)}
          </Muted>
          {m.photoFileIds.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 8 }}>
              {m.photoFileIds.map((f: string) => (
                <Image key={f} source={{ uri: fileUrl(id, f), headers: authHeaders() }} style={{ width: 96, height: 96, borderRadius: 8 }} contentFit="cover" />
              ))}
            </View>
          )}
          {m.text ? <Txt style={{ fontSize: 16 }}>{m.text}</Txt> : null}
        </Card>
      ))}
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('life.addMemory')}>
        <Field label={t('life.memoryText')} value={text} onChangeText={setText} multiline testID="memory-text" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {photos.map((p) => (
            <Image key={p.uri} source={{ uri: p.uri }} style={{ width: 64, height: 64, borderRadius: 8 }} />
          ))}
        </View>
        <Button
          kind="secondary"
          title={`📷 ${t('life.addPhotos')}`}
          onPress={async () => {
            const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6, allowsMultipleSelection: true, selectionLimit: 6 });
            if (!res.canceled) setPhotos([...photos, ...res.assets.map((a) => ({ uri: a.uri, mime: a.mimeType ?? 'image/jpeg' }))]);
          }}
        />
        <Button
          title={t('common.save')}
          color={color}
          loading={pending}
          disabled={!text.trim() && photos.length === 0}
          style={{ marginTop: 10 }}
          testID="memory-save"
          onPress={async () => {
            await run(async () => {
              const photoFileIds = [];
              for (const p of photos) photoFileIds.push(await uploadFile(id, p.uri, p.mime));
              await post(`/groups/${id}/memories`, { day: localDayKey(Date.now(), g.group?.timezone ?? 'Africa/Cairo'), text: text.trim(), photoFileIds });
            });
            setText('');
            setPhotos([]);
            sheet.hide();
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
