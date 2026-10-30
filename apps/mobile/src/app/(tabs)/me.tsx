import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Share, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { KidsSwitcher } from '@/components/KidsSwitcher';
import { Avatar, Button, Card, Field, Muted, Row, Screen, Section, Segmented, Txt } from '@/components/ui';
import { del, get, imageSource, patch, post, uploadProfilePhoto } from '@/lib/api';
import { authClient } from '@/lib/auth';
import { confirmAsk, notifyError, useMe } from '@/lib/hooks';
import { usePrefs, type Digits, type Lang } from '@/lib/prefs';
import { clearCache } from '@/lib/query';

export default function Me() {
  const { t } = useTranslation();
  const me = useMe();
  const { lang, digits, tz, setPrefs } = usePrefs();
  const [name, setName] = useState('');
  const [zone, setZone] = useState(tz);
  const feed = useQuery({ queryKey: ['calendar-feed'], queryFn: () => get('/me/calendar-feed') });
  const plusQ = useQuery({ queryKey: ['me', 'plan'], queryFn: () => get('/me/plan') });
  const router = useRouter();
  const [feedCopied, setFeedCopied] = useState(false);
  useEffect(() => {
    if (me.data) setName(me.data.name);
  }, [me.data?.name]);

  async function save(p: Record<string, unknown>) {
    try {
      await patch('/me', p);
      me.refetch();
    } catch (e) {
      notifyError(e);
    }
  }

  return (
    <Screen title={t('me.title')} testID="me-screen">
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          {me.data?.image ? <Image source={imageSource(me.data.image)} style={{ width: 64, height: 64, borderRadius: 32 }} /> : <Avatar name={me.data?.name ?? '?'} size={64} />}
          <Button
            small
            kind="secondary"
            title={t('me.photo')}
            onPress={async () => {
              const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5, allowsEditing: true, aspect: [1, 1] });
              if (res.canceled || !res.assets[0]) return;
              try {
                const url = await uploadProfilePhoto(res.assets[0].uri, res.assets[0].mimeType ?? 'image/jpeg');
                await save({ image: url });
              } catch (e) {
                notifyError(e);
              }
            }}
          />
        </View>
        <Field label={t('me.name')} value={name} onChangeText={setName} onBlur={() => name.trim() && save({ name: name.trim() })} testID="me-name" />
        <Section title={t('me.language')}>
          <Segmented<Lang>
            value={lang}
            testID="me-lang"
            onChange={(v) => {
              setPrefs({ lang: v });
              save({ language: v });
            }}
            options={[
              { value: 'en', label: t('me.english') },
              { value: 'ar', label: t('me.arabic') },
            ]}
          />
        </Section>
        <Section title={t('me.digits')}>
          <Segmented<Digits>
            value={digits}
            testID="me-digits"
            onChange={(v) => {
              setPrefs({ digits: v });
              save({ digits: v });
            }}
            options={[
              { value: 'latn', label: t('me.western') },
              { value: 'arab', label: t('me.arabicDigits') },
            ]}
          />
        </Section>
        <Field
          label={t('me.timezone')}
          value={zone}
          onChangeText={setZone}
          autoCapitalize="none"
          onBlur={() => {
            setPrefs({ tz: zone });
            save({ timezone: zone });
          }}
        />
      </Card>
      {!me.data?.isChild && <Card onPress={() => router.push('/paywall?plan=plus')} testID="me-plus">
        <Row title={plusQ.data?.plus ? `✓ ${t('plans.youHavePlus')}` : `✨ ${t('plans.plusTitle')}`} subtitle={plusQ.data?.plus ? undefined : t('plans.plusHint')} />
      </Card>}
      <KidsSwitcher />
      <Section title={t('reach.calendarFeed')}>
        <Card testID="calendar-feed">
          <Muted>{t('reach.calendarHint')}</Muted>
          <Txt style={{ marginVertical: 8, fontSize: 12, writingDirection: 'ltr' }} numberOfLines={2}>
            {feed.data?.url ?? '…'}
          </Txt>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button small kind="secondary" title={feedCopied ? t('common.copied') : t('common.copy')} onPress={async () => (await Clipboard.setStringAsync(feed.data.url), setFeedCopied(true))} disabled={!feed.data} />
            <Button small kind="ghost" title={t('reach.newFeed')} onPress={async () => (await post('/me/calendar-feed/rotate'), feed.refetch())} />
          </View>
        </Card>
      </Section>
      <Button
        kind="secondary"
        title={t('me.export')}
        style={{ marginBottom: 12 }}
        onPress={async () => {
          const data = await get('/me/export');
          const text = JSON.stringify(data, null, 2);
          if (Platform.OS === 'web') {
            const blob = new Blob([text], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'circle-export.json';
            a.click();
          } else Share.share({ message: text });
        }}
      />
      <Button
        kind="secondary"
        title={t('me.signOut')}
        testID="sign-out"
        style={{ marginBottom: 12 }}
        onPress={async () => {
          await authClient.signOut();
          await clearCache();
        }}
      />
      {!me.data?.isChild && <Button
        kind="danger"
        title={t('me.deleteAccount')}
        testID="delete-account"
        onPress={async () => {
          if (!(await confirmAsk(t('me.deleteConfirm')))) return;
          await del('/me');
          await authClient.signOut().catch(() => {});
          await clearCache();
        }}
      />}
    </Screen>
  );
}
