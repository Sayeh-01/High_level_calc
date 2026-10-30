import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { get, post } from '@/lib/api';
import { authClient } from '@/lib/auth';
import { clearCache } from '@/lib/query';
import { Button, Card, Field, Muted, Row, Section, Sheet, Txt, colors, useSheet } from './ui';

/** Parent's phone: switch the device to a Child's PIN session (shared device, A11). */
export function KidsSwitcher() {
  const { t } = useTranslation();
  const kids = useQuery({ queryKey: ['children'], queryFn: () => get('/me/children') });
  const sheet = useSheet();
  const [kid, setKid] = useState<any>(null);
  const [pin, setPin] = useState('');
  const [mode, setMode] = useState<'switch' | 'reset'>('switch');
  const [error, setError] = useState<string | null>(null);
  if (!kids.data?.length) return null;
  const kidName: string = kid ? kid.name : '';
  const title = mode === 'switch' ? t('kids.switchTo', { name: kidName }) : `${t('kids.resetPin')} · ${kidName}`;
  return (
    <Section title={t('kids.onDevice')}>
      <Card style={{ paddingVertical: 4 }} testID="kids-switcher">
        <Muted style={{ padding: 8 }}>{t('kids.hint')}</Muted>
        {kids.data.map((k: any) => (
          <Row
            key={k.id}
            title={k.name}
            subtitle={k.groups.map((g: any) => `${g.emoji} ${g.name}`).join(' · ')}
            right={<Button small kind="ghost" title={t('kids.resetPin')} onPress={() => (setKid(k), setMode('reset'), setPin(''), setError(null), sheet.show())} />}
            onPress={() => (setKid(k), setMode('switch'), setPin(''), setError(null), sheet.show())}
            testID={`switch-kid-${k.id}`}
          />
        ))}
      </Card>
      <Sheet visible={sheet.open} onClose={sheet.hide} title={title}>
        <Field label={t('kids.enterPin')} value={pin} onChangeText={(s) => setPin(s.replace(/\D/g, '').slice(0, 6))} secureTextEntry inputMode="numeric" testID="kid-pin" style={{ fontSize: 28, letterSpacing: 8, textAlign: 'center' }} />
        {error ? <Txt style={{ color: colors.danger, marginBottom: 8 }}>{error}</Txt> : null}
        <Button
          title={t('common.confirm')}
          disabled={pin.length < 4}
          testID="kid-pin-submit"
          onPress={async () => {
            if (mode === 'reset') {
              await post(`/me/children/${kid.id}/pin`, { pin });
              sheet.hide();
              return;
            }
            const res = await authClient.$fetch('/child/sign-in', { method: 'POST', body: { childId: kid.id, pin } });
            if ((res as any).error) {
              setError((res as any).error.status === 429 ? t('kids.locked') : t('kids.wrongPin'));
              return;
            }
            await clearCache();
            sheet.hide();
            if (typeof window !== 'undefined' && (window as any).location) (window as any).location.assign('/');
            else await authClient.getSession();
          }}
        />
      </Sheet>
    </Section>
  );
}
