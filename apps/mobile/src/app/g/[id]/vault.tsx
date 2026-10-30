import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { MemberPicker } from '@/components/MemberPicker';
import { Button, Card, Field, Row, Section, Segmented, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

export default function Vault() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  // calendar days shown through Intl: a raw 2027-03-31 inside Arabic text is reordered by the bidi algorithm
  const day = (d: string) => fmt.date(`${d}T12:00:00Z`, 'UTC');
  const router = useRouter();
  const { run } = useAct(id);
  const folders = useQuery({ queryKey: ['group', id, 'vault'], queryFn: () => get(`/groups/${id}/vault/folders`) });
  const [q, setQ] = useState('');
  const search = useQuery({ queryKey: ['group', id, 'vault-search', q], queryFn: () => get(`/groups/${id}/vault/search?q=${encodeURIComponent(q)}`), enabled: q.trim().length > 1 });
  const sheet = useSheet();
  const [form, setForm] = useState({ name: '', access: 'all' as 'all' | 'admins' | 'custom', memberIds: [] as string[] });
  const color = g.group?.color ?? colors.primary;
  return (
    <GroupScreen id={id} active="vault">
      <Field value={q} onChangeText={setQ} placeholder={t('care.search')} testID="vault-search" />
      {q.trim().length > 1 && (
        <Card style={{ paddingVertical: 4 }} testID="vault-results">
          {(search.data ?? []).map((d: any) => (
            <Row key={d.id} title={`📄 ${d.title}`} subtitle={d.expiresOn ? t('care.expiresIn', { date: day(d.expiresOn) }) : null} onPress={() => router.push(`/g/${id}/vault/${d.folderId}`)} />
          ))}
          {search.data?.length === 0 && <Txt style={{ padding: 8 }}>—</Txt>}
        </Card>
      )}
      {g.can('group.settings') && <Button title={t('care.newFolder')} color={color} onPress={sheet.show} testID="new-folder" style={{ marginBottom: 12 }} />}
      <Section title={t('care.vault')}>
        {folders.data?.map((f: any) => (
          <Card key={f.id} style={{ paddingVertical: 4 }}>
            <Row
              title={`${f.access === 'all' ? '🗂️' : '🔒'} ${f.name}`}
              subtitle={[t('care.docs', { count: f.docs }), f.nextExpiry ? t('care.expiresIn', { date: day(f.nextExpiry) }) : null].filter(Boolean).join(' · ')}
              onPress={() => router.push(`/g/${id}/vault/${f.id}`)}
              testID={`folder-${f.id}`}
            />
          </Card>
        ))}
      </Section>
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('care.newFolder')}>
        <Field label={t('care.folderName')} value={form.name} onChangeText={(s) => setForm({ ...form, name: s })} testID="folder-name" />
        <Segmented value={form.access} onChange={(v) => setForm({ ...form, access: v })} options={[{ value: 'all', label: t('care.accessAll') }, { value: 'admins', label: t('care.accessAdmins') }, { value: 'custom', label: t('care.accessCustom') }]} />
        {form.access === 'custom' && <MemberPicker members={g.members} selected={form.memberIds} onToggle={(u) => setForm({ ...form, memberIds: form.memberIds.includes(u) ? form.memberIds.filter((x) => x !== u) : [...form.memberIds, u] })} color={color} />}
        <View style={{ height: 8 }} />
        <Button
          title={t('common.create')}
          color={color}
          disabled={!form.name.trim()}
          testID="folder-save"
          onPress={async () => {
            await run(() => post(`/groups/${id}/vault/folders`, { name: form.name.trim(), access: form.access, memberIds: form.memberIds }));
            setForm({ name: '', access: 'all', memberIds: [] });
            sheet.hide();
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
