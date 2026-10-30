import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { VoiceNote } from '@/components/VoiceNote';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { Button, Chip, HScroll, Muted, Sheet, Txt, colors, styles, useSheet } from '@/components/ui';
import { authHeaders, fileUrl, get, post } from '@/lib/api';
import { useAct, useConfig, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const router = useRouter();
  const q = useQuery({ queryKey: ['group', id, 'messages'], queryFn: () => get(`/groups/${id}/messages`) });
  const { run, pending } = useAct(id);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<any>(null);
  const [mentions, setMentions] = useState<string[]>([]);
  const [image, setImage] = useState<{ uri: string; mime: string } | null>(null);
  const [selected, setSelected] = useState<any>(null);
  const actions = useSheet();
  const config = useConfig();
  const aiSheet = useSheet();
  const [ai, setAi] = useState<{ summary?: string; items?: any[]; added: string[] } | null>(null);
  const color = g.group?.color ?? colors.primary;
  const mentionQuery = /@(\S*)$/.exec(text)?.[1];

  async function send(pinned = false) {
    const body = text.trim();
    if (!body && !image) return;
    await run(async () => {
      const imageFileId = image ? await (await import('@/lib/api')).uploadFile(id, image.uri, image.mime) : undefined;
      await post(`/groups/${id}/messages`, { body, imageFileId, replyToId: replyTo?.id, mentions: mentions.filter((m) => body.includes(`@${g.memberName(m)}`)), pinned });
    });
    setText('');
    setReplyTo(null);
    setMentions([]);
    setImage(null);
  }

  const messages = q.data ?? [];
  const pinned = messages.find((m: any) => m.pinned);
  return (
    <GroupScreen
      id={id}
      active="chat"
      scroll={false}
      footer={
        <View style={{ backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, padding: 8 }}>
          {replyTo && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Muted style={{ flex: 1 }}>{t('chat.replyingTo', { name: g.memberName(replyTo.userId) })}: {replyTo.body.slice(0, 60)}</Muted>
              <Pressable onPress={() => setReplyTo(null)} style={{ padding: 8 }}><Text>✕</Text></Pressable>
            </View>
          )}
          {mentionQuery !== undefined && (
            <HScroll>
              {g.members
                .filter((m) => m.displayName.toLowerCase().startsWith(mentionQuery.toLowerCase()))
                .map((m) => (
                  <Chip key={m.userId} label={`@${m.displayName}`} onPress={() => (setText(text.replace(/@\S*$/, `@${m.displayName} `)), setMentions([...mentions, m.userId]))} />
                ))}
            </HScroll>
          )}
          {image && <Image source={{ uri: image.uri }} style={{ width: 80, height: 80, borderRadius: 8, marginBottom: 6 }} />}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('chat.photo')}
              style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
              onPress={async () => {
                const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
                if (!res.canceled && res.assets[0]) setImage({ uri: res.assets[0].uri, mime: res.assets[0].mimeType ?? 'image/jpeg' });
              }}>
              <Text style={{ fontSize: 22 }}>📷</Text>
            </Pressable>
            <VoiceRecorder
              label={t('chat.voice')}
              onDone={(uri, ms) =>
                run(async () => {
                  const audioFileId = await (await import('@/lib/api')).uploadFile(id, uri, 'audio/m4a');
                  await post(`/groups/${id}/messages`, { body: '', audioFileId, audioMs: ms, replyToId: replyTo?.id });
                })
              }
            />
            <TextInput value={text} onChangeText={setText} placeholder={t('chat.placeholder')} placeholderTextColor={colors.faint} multiline style={[styles.input, { flex: 1, maxHeight: 120, paddingTop: 12 }]} testID="chat-input" accessibilityLabel={t('chat.placeholder')} />
            <Button small title={t('common.send')} onPress={() => send(false)} loading={pending} disabled={!text.trim() && !image} testID="chat-send" color={color} />
          </View>
          {g.can('announce') && text.trim() ? <Button small kind="ghost" title={`📣 ${t('chat.announce')}`} onPress={() => send(true)} testID="chat-announce" /> : null}
        </View>
      }>
      {config.data?.ai && (
        <View style={{ flexDirection: 'row', gap: 8, padding: 8, flexWrap: 'wrap' }}>
          <Chip label={t('life.missed')} onPress={() => run(() => post(`/groups/${id}/ai/catchup`)).then((r) => (setAi({ summary: r.summary || t('life.nothingNew'), added: [] }), aiSheet.show()))} testID="ai-missed" />
          {g.can('items.create') && <Chip label={t('life.suggest')} onPress={() => run(() => post(`/groups/${id}/ai/chat-items`)).then((r) => (setAi({ items: r.items, added: [] }), aiSheet.show()))} testID="ai-suggest" />}
        </View>
      )}
      {pinned && (
        <View style={{ backgroundColor: '#FFF6DD', padding: 10, borderBottomWidth: 1, borderBottomColor: colors.border }} testID="pinned-banner">
          <Txt numberOfLines={2}>📣 {pinned.body}</Txt>
        </View>
      )}
      <FlatList
        inverted
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        renderItem={({ item: m }) => {
          const mine = m.userId === g.me?.userId;
          const parent = m.replyToId ? messages.find((x: any) => x.id === m.replyToId) : null;
          return (
            <Pressable onLongPress={() => (setSelected(m), actions.show())} delayLongPress={300} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }} testID={`msg-${m.id}`}>
              <View style={{ backgroundColor: mine ? color : colors.card, borderRadius: 14, padding: 10, borderWidth: m.pinned ? 2 : 0, borderColor: '#E0B000' }}>
                {!mine && <Text style={{ fontWeight: '700', color, marginBottom: 2, fontSize: 13 }}>{m.userId === 'system' ? '🤖 Circle' : g.memberName(m.userId)}</Text>}
                {parent && (
                  <View style={{ borderStartWidth: 3, borderStartColor: mine ? '#fff' : color, paddingStart: 6, marginBottom: 4, opacity: 0.8 }}>
                    <Text style={{ color: mine ? '#fff' : colors.muted, fontSize: 12 }} numberOfLines={2}>{parent.body}</Text>
                  </View>
                )}
                {m.imageFileId ? <Image source={{ uri: fileUrl(id, m.imageFileId), headers: authHeaders() }} style={{ width: 200, height: 200, borderRadius: 10, marginBottom: 4 }} contentFit="cover" /> : null}
                {m.audioFileId ? <VoiceNote uri={fileUrl(id, m.audioFileId)} ms={m.audioMs} color={mine ? '#fff' : colors.text} /> : null}
                {m.body ? <Text style={{ color: mine ? '#fff' : colors.text, fontSize: 15, textAlign: 'auto' }}>{m.body}</Text> : null}
                <Text style={{ color: mine ? 'rgba(255,255,255,0.8)' : colors.faint, fontSize: 11, marginTop: 2 }}>{fmt.time(m.createdAt)}</Text>
              </View>
            </Pressable>
          );
        }}
      />
      <Sheet visible={aiSheet.open} onClose={aiSheet.hide} title={ai?.summary !== undefined ? t('life.missed') : t('life.suggest')} testID="ai-sheet">
        {ai?.summary !== undefined && <Txt style={{ fontSize: 16, lineHeight: 24 }} testID="ai-summary">{ai.summary}</Txt>}
        {ai?.items?.length === 0 && <Muted>{t('group.nothingYet')}</Muted>}
        {ai?.items?.map((it, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}>
            <Txt style={{ flex: 1 }}>{`${it.kind === 'event' ? '📅' : '✅'} ${it.title}${it.when ? ` · ${fmt.dateTime(it.when)}` : ''}`}</Txt>
            <Button
              small
              color={color}
              title={ai.added.includes(String(i)) ? t('life.added') : t('common.add')}
              disabled={ai.added.includes(String(i)) || (it.kind === 'event' && !it.when)}
              testID={`ai-add-${i}`}
              onPress={() =>
                run(() => (it.kind === 'event' ? post(`/groups/${id}/events`, { title: it.title, startsAt: it.when }) : post(`/groups/${id}/tasks`, { title: it.title, dueAt: it.when }))).then(() =>
                  setAi({ ...ai, added: [...ai.added, String(i)] }),
                )
              }
            />
          </View>
        ))}
        <Muted style={{ marginTop: 8 }}>{t('life.draft')}</Muted>
      </Sheet>
      <Sheet visible={actions.open} onClose={actions.hide} title={selected?.body?.slice(0, 40) || t('chat.photo')}>
        <View style={{ gap: 8 }}>
          <Button kind="secondary" title={t('chat.reply')} onPress={() => (setReplyTo(selected), actions.hide())} />
          {g.has('tasks') && g.can('items.create') && (
            <Button
              kind="secondary"
              title={t('chat.makeTask')}
              onPress={async () => {
                const task = await run(() => post(`/groups/${id}/tasks`, { title: selected.body.slice(0, 200) || 'Task' }));
                actions.hide();
                router.push(`/g/${id}/task/${task.id}`);
              }}
            />
          )}
          {g.can('announce') && <Button kind="secondary" title={selected?.pinned ? t('chat.unpin') : t('chat.pin')} onPress={() => run(() => post(`/groups/${id}/messages/${selected.id}/${selected.pinned ? 'unpin' : 'pin'}`)).then(actions.hide)} />}
        </View>
      </Sheet>
    </GroupScreen>
  );
}
