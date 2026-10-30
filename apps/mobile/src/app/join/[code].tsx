import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SignInForm } from '@/components/SignIn';
import { Button, Card, Field, Loading, Muted, Screen, Txt, colors } from '@/components/ui';
import { ApiError, get, post } from '@/lib/api';
import { authClient } from '@/lib/auth';
import { useAct } from '@/lib/hooks';

/** Join flow (A13): open the link or type the code → see name, inviter, member count → join → pick a display name. */
export default function Join() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ code: string }>();
  const { data: session, isPending } = authClient.useSession();
  const [code, setCode] = useState(params.code && params.code !== 'enter' ? params.code : '');
  const [submitted, setSubmitted] = useState(params.code && params.code !== 'enter' ? params.code : '');
  const [displayName, setDisplayName] = useState('');
  const { run, pending } = useAct();
  const preview = useQuery({ queryKey: ['invite', submitted], queryFn: () => get(`/invites/${submitted.trim()}`), enabled: !!session && !!submitted, retry: false });

  useEffect(() => {
    if (session?.user?.name && !displayName) setDisplayName(session.user.name);
  }, [session?.user?.name]);

  if (isPending) return <Loading />;
  if (!session) {
    return (
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 64 }} style={{ backgroundColor: colors.bg }}>
        <SignInForm />
      </ScrollView>
    );
  }

  const notFound = preview.error instanceof ApiError && preview.error.status === 404;
  return (
    <Screen title={t('join.title')} back testID="join-screen">
      <Field label={t('join.enterCode')} value={code} onChangeText={(s) => setCode(s.toUpperCase())} autoCapitalize="characters" testID="join-code" />
      <Button title={t('join.find')} kind="secondary" onPress={() => setSubmitted(code)} disabled={code.trim().length < 4} testID="join-find" />
      {preview.isLoading && <Loading />}
      {notFound && <Txt style={{ color: colors.danger, marginTop: 12 }}>{t('join.notFound')}</Txt>}
      {preview.data && (
        <Card style={{ marginTop: 16 }} accent={preview.data.color} testID="join-preview">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ fontSize: 40 }}>{preview.data.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Txt style={{ fontSize: 20, fontWeight: '700' }}>{preview.data.name}</Txt>
              <Muted>{t('common.members', { count: preview.data.memberCount })}</Muted>
              {preview.data.inviter ? <Muted>{t('join.invitedBy', { name: preview.data.inviter })}</Muted> : null}
            </View>
          </View>
          {preview.data.alreadyMember ? (
            <>
              <Muted style={{ marginTop: 12 }}>{t('join.already')}</Muted>
              <Button title={t('common.open')} style={{ marginTop: 12 }} onPress={() => router.replace(`/g/${preview.data.groupId}`)} />
            </>
          ) : preview.data.full ? (
            <Txt style={{ marginTop: 12, color: colors.danger, fontWeight: '600' }} testID="join-full">{t('plans.joinFull', { limit: preview.data.memberLimit })}</Txt>
          ) : (
            <>
              <View style={{ marginTop: 16 }}>
                <Field label={t('join.displayName')} value={displayName} onChangeText={setDisplayName} testID="join-display-name" />
              </View>
              <Button
                title={t('join.join')}
                color={preview.data.color}
                loading={pending}
                testID="join-submit"
                onPress={async () => {
                  try {
                    const res = await run(() => post(`/invites/${submitted.trim()}/join`, { displayName: displayName.trim() || undefined }));
                    router.replace(`/g/${res.groupId}`);
                  } catch {
                    preview.refetch(); // e.g. the last seat was just taken
                  }
                }}
              />
            </>
          )}
        </Card>
      )}
    </Screen>
  );
}
