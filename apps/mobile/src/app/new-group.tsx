import { MODULE_IDS, TEMPLATES, moduleName } from '@circle/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Chip, Field, HScroll, Muted, Screen, Txt, colors, styles } from '@/components/ui';
import { post } from '@/lib/api';
import { useAct } from '@/lib/hooks';
import { usePrefs } from '@/lib/prefs';

const EMOJIS = ['⚽', '🏠', '🛋️', '📚', '💼', '✨', '🏀', '🎾', '🏃', '🍲', '🎮', '🎉', '✈️', '❤️', '🌙', '🏢'];

/** 60-second onboarding: pick a type → name + emoji → invite. */
export default function NewGroup() {
  const { t } = useTranslation();
  const { lang, tz } = usePrefs();
  const router = useRouter();
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [modules, setModules] = useState<string[]>(['tasks', 'chat']);
  const { run, pending } = useAct();
  const tpl = TEMPLATES.find((x) => x.id === templateId);

  if (!tpl) {
    return (
      <Screen title={t('newGroup.whatFor')} back testID="new-group-screen">
        <Muted style={{ marginBottom: 12 }}>{t('newGroup.step', { n: 1 })}</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {TEMPLATES.map((x) => (
            <Pressable
              key={x.id}
              testID={`template-${x.id}`}
              accessibilityRole="button"
              accessibilityLabel={x.name[lang]}
              onPress={() => setTemplateId(x.id)}
              style={({ pressed }) => ({ width: '47%', minHeight: 120, backgroundColor: colors.card, borderRadius: 16, padding: 14, borderWidth: 2, borderColor: pressed ? x.color : colors.border, gap: 6 })}>
              <Text style={{ fontSize: 34 }}>{x.emoji}</Text>
              <Txt style={{ fontWeight: '700', fontSize: 16 }}>{x.name[lang]}</Txt>
              <Muted>{x.tagline[lang]}</Muted>
            </Pressable>
          ))}
        </View>
      </Screen>
    );
  }

  return (
    <Screen title={tpl.name[lang]} back testID="new-group-details" accent={tpl.color}>
      <Muted style={{ marginBottom: 12 }}>{t('newGroup.step', { n: 2 })}</Muted>
      <Field label={t('newGroup.name')} value={name} onChangeText={setName} placeholder={t('newGroup.namePlaceholder')} testID="group-name" autoFocus />
      <Txt style={styles.label}>{t('newGroup.emoji')}</Txt>
      <HScroll>
        {[tpl.emoji, ...EMOJIS.filter((e) => e !== tpl.emoji)].map((e) => (
          <Chip key={e} label={e} active={(emoji ?? tpl.emoji) === e} onPress={() => setEmoji(e)} color={tpl.color} />
        ))}
      </HScroll>
      {tpl.id === 'custom' && (
        <View style={{ marginTop: 16 }}>
          <Txt style={styles.label}>{t('newGroup.pickModules')}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {MODULE_IDS.map((m) => (
              <Chip key={m} label={moduleName('custom', m, lang)} active={modules.includes(m)} onPress={() => setModules((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))} testID={`module-${m}`} />
            ))}
          </View>
        </View>
      )}
      <Button
        title={t('newGroup.create')}
        style={{ marginTop: 24 }}
        disabled={!name.trim()}
        loading={pending}
        testID="create-group"
        color={tpl.color}
        onPress={async () => {
          const res = await run(() => post('/groups', { templateId: tpl.id, name: name.trim(), emoji: emoji ?? tpl.emoji, lang, timezone: tz, ...(tpl.id === 'custom' ? { modules } : {}) }));
          router.replace(`/g/${res.group.id}/invite?fresh=1`);
        }}
      />
    </Screen>
  );
}
