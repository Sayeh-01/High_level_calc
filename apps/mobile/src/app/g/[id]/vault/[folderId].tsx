import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorView, Field, Loading, Muted, Screen, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { API_URL } from '@/lib/config';
import { authHeaders, get, post, uploadVaultFile } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function Folder() {
  const { id, folderId } = useLocalSearchParams<{ id: string; folderId: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  // calendar days shown through Intl: a raw 2027-03-31 inside Arabic text is reordered by the bidi algorithm
  const day = (d: string) => fmt.date(`${d}T12:00:00Z`, 'UTC');
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'vault', folderId], queryFn: () => get(`/groups/${id}/vault/folders/${folderId}`) });
  const sheet = useSheet();
  const [form, setForm] = useState({ title: '', expiresOn: '', notes: '' });
  const [file, setFile] = useState<{ uri: string; mime: string } | null>(null);
  const color = g.group?.color ?? colors.primary;
  if (q.isLoading) return <Screen title="" back><Loading /></Screen>;
  if (q.error) return <Screen title="" back><ErrorView error={q.error} /></Screen>;
  const fileUrl = (docId: string) => `${API_URL}/api/groups/${id}/vault/docs/${docId}/file`;
  return (
    <Screen title={`🗂️ ${q.data.folder.name}`} back accent={color} testID="folder-screen">
      <Button title={t('care.addDoc')} color={color} onPress={sheet.show} testID="new-doc" style={{ marginBottom: 12 }} />
      {q.data.docs.map((d: any) => (
        <Card key={d.id} accent={color} testID={`doc-${d.id}`}>
          <Txt style={{ fontSize: 17, fontWeight: '700' }}>📄 {d.title}</Txt>
          {d.expiresOn ? <Txt style={{ color: colors.warn, marginTop: 4 }}>{t('care.expiresIn', { date: day(d.expiresOn) })}</Txt> : null}
          {d.notes ? <Muted style={{ marginTop: 4 }}>{d.notes}</Muted> : null}
          {d.ocrText ? <Muted style={{ marginTop: 4 }}>{`${t('care.scanText')}: ${d.ocrText.slice(0, 160)}`}</Muted> : null}
          {d.fileId && Platform.OS !== 'web' ? <Image source={{ uri: fileUrl(d.id), headers: authHeaders() }} style={{ width: 120, height: 120, borderRadius: 8, marginTop: 8 }} /> : null}
          {d.fileId && Platform.OS === 'web' ? <Button small kind="ghost" title={t('care.open')} onPress={() => window.open(fileUrl(d.id), '_blank')} /> : null}
        </Card>
      ))}
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('care.addDoc')}>
        <Field label={t('care.docTitle')} value={form.title} onChangeText={(s) => setForm({ ...form, title: s })} testID="doc-title" />
        <Field label={t('care.expires')} value={form.expiresOn} onChangeText={(s) => setForm({ ...form, expiresOn: s })} placeholder="2027-02-15" testID="doc-expires" style={{ writingDirection: 'ltr' }} />
        <Field label={t('care.notes')} value={form.notes} onChangeText={(s) => setForm({ ...form, notes: s })} multiline />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          {file && <Image source={{ uri: file.uri }} style={{ width: 56, height: 56, borderRadius: 8 }} />}
          <Button
            small
            kind="secondary"
            title={`📎 ${t('care.attach')}`}
            onPress={async () => {
              const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
              if (!res.canceled && res.assets[0]) setFile({ uri: res.assets[0].uri, mime: res.assets[0].mimeType ?? 'image/jpeg' });
            }}
          />
        </View>
        <Button
          title={t('common.save')}
          color={color}
          loading={pending}
          disabled={!form.title.trim() || (!!form.expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(form.expiresOn))}
          testID="doc-save"
          onPress={async () => {
            await run(async () => {
              const fileId = file ? await uploadVaultFile(id, file.uri, file.mime) : undefined;
              await post(`/groups/${id}/vault/folders/${folderId}/docs`, { title: form.title.trim(), expiresOn: form.expiresOn || null, notes: form.notes || undefined, fileId });
            });
            setForm({ title: '', expiresOn: '', notes: '' });
            setFile(null);
            sheet.hide();
          }}
        />
      </Sheet>
    </Screen>
  );
}
