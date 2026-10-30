import '@/lib/i18n';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button, Field, Loading, Screen, Txt, colors } from '@/components/ui';
import { patch } from '@/lib/api';
import { authClient } from '@/lib/auth';
import { PrefsProvider, usePrefs } from '@/lib/prefs';
import { registerForPush } from '@/lib/push';
import { persister, queryClient } from '@/lib/query';
import { realtime } from '@/lib/realtime';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 24 * 60 * 60_000 }} onSuccess={() => queryClient.invalidateQueries()}>
        <PrefsProvider>
          <AuthGate />
        </PrefsProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}

function AuthGate() {
  const { data: session, isPending, refetch } = authClient.useSession();
  const { setPrefs } = usePrefs();
  const signedIn = !!session?.user;
  const user = session?.user as (typeof session extends null ? never : any) | undefined;

  useEffect(() => {
    if (!isPending) SplashScreen.hideAsync().catch(() => {});
  }, [isPending]);

  useEffect(() => {
    if (!signedIn) {
      realtime.stop();
      return;
    }
    realtime.start();
    registerForPush();
    if (user?.language) setPrefs({ lang: user.language, digits: user.digits, tz: user.timezone });
  }, [signedIn]);

  if (isPending) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}><Loading /></View>;
  if (signedIn && !user?.name) return <NameStep onDone={() => refetch()} />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="new-group" />
        <Stack.Screen name="g/[id]" />
        <Stack.Screen name="p/[token]" />
        <Stack.Screen name="paywall" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Screen name="join/[code]" />
    </Stack>
  );
}

function NameStep({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { lang, digits, tz } = usePrefs();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Screen title="Circle" testID="name-step">
      <Txt style={{ fontSize: 18, fontWeight: '600', marginBottom: 16 }}>{t('auth.welcome')}</Txt>
      <Field label={t('auth.yourName')} value={name} onChangeText={setName} testID="name-input" autoFocus />
      <Button
        title={t('auth.continue')}
        disabled={!name.trim()}
        loading={busy}
        testID="name-continue"
        onPress={async () => {
          setBusy(true);
          try {
            await patch('/me', { name: name.trim(), language: lang, digits, timezone: tz });
            onDone();
          } finally {
            setBusy(false);
          }
        }}
      />
    </Screen>
  );
}
