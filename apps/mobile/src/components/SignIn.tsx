import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { get } from '@/lib/api';
import { authClient } from '@/lib/auth';
import { errorMessage } from '@/lib/hooks';
import { usePrefs } from '@/lib/prefs';
import { Button, Chip, Field, Muted, Txt, colors } from './ui';

export function SignInForm({ onSignedIn }: { onSignedIn?: () => void }) {
  const { t } = useTranslation();
  const { lang, setPrefs } = usePrefs();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const config = useQuery({ queryKey: ['config'], queryFn: () => get('/config'), staleTime: Infinity });

  async function send() {
    setBusy(true);
    setError(null);
    const res = mode === 'phone' ? await authClient.phoneNumber.sendOtp({ phoneNumber: phone.trim() }) : await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: 'sign-in' });
    setBusy(false);
    if (res.error) setError(res.error.message ?? 'error');
    else setStep('code');
  }
  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const res = mode === 'phone' ? await authClient.phoneNumber.verify({ phoneNumber: phone.trim(), code: code.trim() }) : await authClient.signIn.emailOtp({ email: email.trim(), otp: code.trim() });
      if (res.error) setError(res.error.message ?? 'error');
      else onSignedIn?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View testID="sign-in">
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 24 }}>
        <Chip label="English" active={lang === 'en'} onPress={() => setPrefs({ lang: 'en' })} testID="lang-en" />
        <Chip label="العربية" active={lang === 'ar'} onPress={() => setPrefs({ lang: 'ar' })} testID="lang-ar" />
      </View>
      <Txt style={{ fontSize: 34, fontWeight: '800', color: colors.primary }}>Circle</Txt>
      <Txt style={{ fontSize: 16, color: colors.muted, marginTop: 8, marginBottom: 32 }}>{t('auth.tagline')}</Txt>
      {step === 'email' ? (
        <>
          {mode === 'email' ? (
            <Field label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" testID="email-input" />
          ) : (
            <Field label={t('auth.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="+2010…" testID="phone-input" style={{ writingDirection: 'ltr' }} />
          )}
          <Button title={t('auth.sendCode')} onPress={send} disabled={mode === 'email' ? !/.+@.+\..+/.test(email) : !/^\+[1-9]\d{7,14}$/.test(phone.trim())} loading={busy} testID="send-code" />
          <Button kind="ghost" title={mode === 'email' ? t('auth.usePhone') : t('auth.useEmail')} onPress={() => setMode(mode === 'email' ? 'phone' : 'email')} style={{ marginTop: 4 }} testID="toggle-phone" />
          {config.data?.google ? <Button kind="secondary" style={{ marginTop: 12 }} title={t('auth.google')} onPress={() => authClient.signIn.social({ provider: 'google', callbackURL: '/' })} testID="google" /> : null}
          {config.data?.apple ? <Button kind="secondary" style={{ marginTop: 12 }} title={t('auth.apple')} onPress={() => authClient.signIn.social({ provider: 'apple', callbackURL: '/' })} testID="apple" /> : null}
        </>
      ) : (
        <>
          <Muted style={{ marginBottom: 12 }}>{t('auth.codeSent', { email: mode === 'phone' ? phone : email })}</Muted>
          <Field label={t('auth.code')} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} testID="code-input" autoFocus />
          <Button title={t('auth.verify')} onPress={verify} disabled={code.trim().length !== 6} loading={busy} testID="verify-code" />
          <Button kind="ghost" title={t('auth.changeEmail')} onPress={() => setStep('email')} style={{ marginTop: 8 }} />
        </>
      )}
      {error ? <Txt style={{ color: colors.danger, marginTop: 12 }}>{error}</Txt> : null}
    </View>
  );
}
