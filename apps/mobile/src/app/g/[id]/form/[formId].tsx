import type { FormField } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SignaturePad, SignatureView } from '@/components/Signature';
import { Button, Card, Chip, ErrorView, Field, Loading, Muted, Screen, Section, Segmented, Txt, colors } from '@/components/ui';
import { get, post } from '@/lib/api';
import { notifyError, useAct, useGroup } from '@/lib/hooks';
import { useFormat, usePrefs } from '@/lib/prefs';
import { printHtml } from '@/lib/print';

type Answer = string | number | boolean;

export default function FormScreen() {
  const { id, formId } = useLocalSearchParams<{ id: string; formId: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const { lang } = usePrefs();
  const { run, pending } = useAct(id);
  const q = useQuery({ queryKey: ['group', id, 'forms', formId], queryFn: () => get(`/groups/${id}/forms/${formId}`) });
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [drawn, setDrawn] = useState<{ path: string; width: number; height: number } | null>(null);
  const [signer, setSigner] = useState('');
  const [editing, setEditing] = useState(false);
  const color = g.group?.color ?? colors.primary;
  useEffect(() => {
    if (q.data?.mine) setAnswers(q.data.mine.answers);
    if (!signer && g.me) setSigner(g.me.displayName);
  }, [q.data?.mine?.id, g.me?.displayName]);
  if (q.isLoading) return <Screen title="" back><Loading /></Screen>;
  if (q.error || !q.data) return <Screen title="" back><ErrorView error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const { form, mine, open, forMe, manager } = q.data;
  const fields: FormField[] = form.fields;
  const show = (v: unknown) => (v === true ? t('forms.yes') : v === false ? t('forms.no') : v === undefined ? '—' : String(v));
  const missingRequired = fields.some((f) => f.required && (answers[f.id] === undefined || answers[f.id] === ''));
  const filling = forMe && open && (!mine || editing);

  return (
    <Screen title={form.title} back accent={color} testID="form-screen">
      {form.description ? <Txt style={{ marginBottom: 12 }}>{form.description}</Txt> : null}

      {filling && (
        <Card testID="form-fill">
          {fields.map((f) => (
            <View key={f.id} style={{ marginBottom: 8 }}>
              <Txt style={{ fontWeight: '600', marginBottom: 6 }}>{`${f.label}${f.required ? ' *' : ''}`}</Txt>
              {f.type === 'yes_no' ? (
                <Segmented<'yes' | 'no' | ''> value={answers[f.id] === true ? 'yes' : answers[f.id] === false ? 'no' : ''} onChange={(v) => setAnswers({ ...answers, [f.id]: v === 'yes' })} options={[{ value: 'yes', label: t('forms.yes') }, { value: 'no', label: t('forms.no') }]} testID={`answer-${f.id}`} />
              ) : f.type === 'choice' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {f.options!.map((o) => (
                    <Chip key={o} label={o} active={answers[f.id] === o} color={color} onPress={() => setAnswers({ ...answers, [f.id]: o })} testID={`answer-${f.id}-${o}`} />
                  ))}
                </View>
              ) : (
                <Field
                  value={answers[f.id] === undefined ? '' : String(answers[f.id])}
                  onChangeText={(s) => setAnswers({ ...answers, [f.id]: f.type === 'number' ? (s === '' ? '' : Number(s)) : s })}
                  inputMode={f.type === 'number' ? 'decimal' : 'text'}
                  placeholder={f.type === 'date' ? 'YYYY-MM-DD' : undefined}
                  testID={`answer-${f.id}`}
                />
              )}
            </View>
          ))}
          {form.requireSignature && (
            <>
              <Txt style={{ fontWeight: '600', marginBottom: 6 }}>{t('forms.sign')}</Txt>
              <SignaturePad onChange={setDrawn} testID="signature-pad" />
              <Field label={t('forms.fullName')} value={signer} onChangeText={setSigner} testID="signature-name" />
            </>
          )}
          <Button
            title={form.requireSignature ? t('forms.signAndSubmit') : t('forms.submit')}
            color={color}
            loading={pending}
            disabled={missingRequired || (form.requireSignature && (!drawn || !signer.trim()))}
            testID="form-submit"
            onPress={async () => {
              const clean = Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== ''));
              await run(() => post(`/groups/${id}/forms/${formId}/respond`, { answers: clean, signature: form.requireSignature && drawn ? { ...drawn, name: signer.trim() } : undefined }));
              setEditing(false);
            }}
          />
        </Card>
      )}

      {mine && !filling && (
        <Card accent={colors.good} testID="form-mine">
          <Txt style={{ fontWeight: '700', color: colors.good }}>{mine.signature ? t('forms.signed') : t('forms.responded')}</Txt>
          {fields.map((f) => (
            <Muted key={f.id}>{`${f.label}: ${show(mine.answers[f.id])}`}</Muted>
          ))}
          {mine.signature && (
            <View style={{ marginTop: 8 }}>
              <SignatureView signature={mine.signature} testID="my-signature" />
              <Muted>{t('forms.signedBy', { name: mine.signature.name, date: fmt.dateTime(mine.signedAt) })}</Muted>
            </View>
          )}
          {open && <Button small kind="secondary" title={t('forms.update')} style={{ marginTop: 8, alignSelf: 'flex-start' }} onPress={() => setEditing(true)} />}
        </Card>
      )}

      {manager && (
        <Section title={t('forms.responses')}>
          <Card testID="form-summary">
            <Txt style={{ fontWeight: '700' }}>{t('forms.count', { n: fmt.number(q.data.responses.length), total: fmt.number(q.data.expected) })}</Txt>
            {q.data.missing.length > 0 && <Muted>{t('forms.missing', { names: q.data.missing.map((u: string) => g.memberName(u)).join('، ') })}</Muted>}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <Button
                small
                kind="secondary"
                title={`🖨️ ${t('forms.print')}`}
                onPress={async () => {
                  try {
                    const s = await get(`/groups/${id}/forms/${formId}/sheet?lang=${lang}`);
                    await printHtml(s.html, s.title);
                  } catch (e) {
                    notifyError(e);
                  }
                }}
              />
              {open && <Button small kind="ghost" title={t('forms.close')} onPress={() => run(() => post(`/groups/${id}/forms/${formId}/close`))} testID="form-close" />}
            </View>
          </Card>
          {q.data.responses.map((r: any) => (
            <Card key={r.id} testID={`response-${r.userId}`}>
              <Txt style={{ fontWeight: '700' }}>{g.memberName(r.userId)}</Txt>
              {fields.map((f) => (
                <Muted key={f.id}>{`${f.label}: ${show(r.answers[f.id])}`}</Muted>
              ))}
              {r.signature && (
                <View style={{ marginTop: 6 }}>
                  <SignatureView signature={r.signature} width={180} testID={`signature-${r.userId}`} />
                  <Muted>{t('forms.signedBy', { name: r.signature.name, date: fmt.dateTime(r.signedAt) })}</Muted>
                </View>
              )}
            </Card>
          ))}
        </Section>
      )}
    </Screen>
  );
}
