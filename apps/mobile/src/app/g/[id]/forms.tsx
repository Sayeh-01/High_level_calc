import type { FieldType, FormField } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GroupScreen } from '@/components/GroupNav';
import { Button, Card, Chip, Empty, Field, Muted, Row, Sheet, Toggle, Txt, colors, useSheet } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

const TYPES: FieldType[] = ['text', 'yes_no', 'choice', 'number', 'date'];

export default function Forms() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const router = useRouter();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'forms'], queryFn: () => get(`/groups/${id}/forms`) });
  const sheet = useSheet();
  const color = g.group?.color ?? colors.primary;
  const empty = { title: '', description: '', requireSignature: true, fields: [] as FormField[], memberIds: [] as string[] };
  const [form, setForm] = useState(empty);
  const [draft, setDraft] = useState({ label: '', type: 'yes_no' as FieldType, options: '', required: true });
  const addField = () => {
    const options = draft.options.split(/[,،]/).map((s) => s.trim()).filter(Boolean);
    setForm({ ...form, fields: [...form.fields, { id: `q${form.fields.length + 1}`, label: draft.label.trim(), type: draft.type, required: draft.required, ...(draft.type === 'choice' ? { options } : {}) }] });
    setDraft({ ...draft, label: '', options: '' });
  };
  const draftOk = draft.label.trim() && (draft.type !== 'choice' || draft.options.split(/[,،]/).filter((s) => s.trim()).length >= 2);

  return (
    <GroupScreen id={id} active="forms">
      {g.can('approve') && <Button title={t('forms.new')} color={color} onPress={sheet.show} testID="new-form" style={{ marginBottom: 12 }} />}
      {q.data?.length === 0 && <Empty title={t('group.nothingYet')} />}
      {q.data?.map((f: any) => (
        <Card key={f.id} accent={f.forMe && !f.responded && f.open ? color : undefined} onPress={() => router.push(`/g/${id}/form/${f.id}`)} testID={`form-${f.id}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Txt style={{ fontSize: 16, fontWeight: '700', flex: 1 }}>{`${f.requireSignature ? '🖊️' : '📋'} ${f.title}`}</Txt>
            <Txt style={{ fontWeight: '600', color: !f.open ? colors.muted : f.responded ? colors.good : colors.warn }}>
              {!f.open ? t('forms.closed') : f.responded ? (f.requireSignature ? t('forms.signed') : t('forms.responded')) : f.forMe ? t('forms.todo') : ''}
            </Txt>
          </View>
          {f.expected !== undefined && <Muted>{t('forms.count', { n: fmt.number(f.responses), total: fmt.number(f.expected) })}</Muted>}
        </Card>
      ))}
      <Sheet visible={sheet.open} onClose={sheet.hide} title={t('forms.new')} testID="form-sheet">
        <Field label={t('forms.title')} value={form.title} onChangeText={(s) => setForm({ ...form, title: s })} testID="form-title" />
        <Field label={t('forms.description')} value={form.description} onChangeText={(s) => setForm({ ...form, description: s })} multiline testID="form-description" />
        <Toggle label={t('forms.signature')} value={form.requireSignature} onChange={(v) => setForm({ ...form, requireSignature: v })} testID="form-signature" />
        <Muted style={{ marginVertical: 6 }}>{t('forms.fields')}</Muted>
        {form.fields.map((f, i) => (
          <Row key={f.id} title={`${i + 1}. ${f.label}${f.required ? ' *' : ''}`} subtitle={`${t(`forms.type_${f.type}`)}${f.options ? ` · ${f.options.join(', ')}` : ''}`} right={<Button small kind="ghost" title="✕" accessibilityLabel={t('common.delete')} onPress={() => setForm({ ...form, fields: form.fields.filter((x) => x !== f) })} />} />
        ))}
        <Card style={{ marginTop: 6 }}>
          <Field label={t('forms.label')} value={draft.label} onChangeText={(s) => setDraft({ ...draft, label: s })} testID="field-label" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {TYPES.map((ty) => (
              <Chip key={ty} label={t(`forms.type_${ty}`)} active={draft.type === ty} color={color} onPress={() => setDraft({ ...draft, type: ty })} testID={`field-type-${ty}`} />
            ))}
          </View>
          {draft.type === 'choice' && <Field label={t('forms.options')} value={draft.options} onChangeText={(s) => setDraft({ ...draft, options: s })} testID="field-options" />}
          <Toggle label={t('forms.required')} value={draft.required} onChange={(v) => setDraft({ ...draft, required: v })} />
          <Button small kind="secondary" title={`＋ ${t('forms.addField')}`} disabled={!draftOk} onPress={addField} testID="field-add" />
        </Card>
        <Button
          title={t('common.create')}
          color={color}
          loading={pending}
          style={{ marginTop: 12 }}
          disabled={!form.title.trim() || (!form.fields.length && !form.requireSignature)}
          testID="form-save"
          onPress={async () => {
            const res = await run(() => post(`/groups/${id}/forms`, { ...form, title: form.title.trim() }));
            setForm(empty);
            sheet.hide();
            router.push(`/g/${id}/form/${res.id}`);
          }}
        />
      </Sheet>
    </GroupScreen>
  );
}
