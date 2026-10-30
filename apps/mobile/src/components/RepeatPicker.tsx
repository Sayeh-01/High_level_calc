import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Chip, Field, Txt, styles } from './ui';

const PRESETS: Record<string, (d: Date | null) => string | null> = {
  none: () => null,
  daily: () => 'FREQ=DAILY',
  weekly: (d) => `FREQ=WEEKLY;BYDAY=${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][(d ?? new Date()).getDay()]}`,
  monthly: () => 'FREQ=MONTHLY',
};

/** daily / weekly / monthly / custom RRULE */
export function RepeatPicker({ value, onChange, date, testID }: { value: string | null; onChange: (r: string | null) => void; date: Date | null; testID?: string }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<string>(value ? (value.startsWith('FREQ=DAILY') ? 'daily' : value.startsWith('FREQ=WEEKLY') ? 'weekly' : value === 'FREQ=MONTHLY' ? 'monthly' : 'custom') : 'none');
  return (
    <View style={{ marginBottom: 12 }}>
      <Txt style={styles.label}>{t('tasks.repeat')}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(['none', 'daily', 'weekly', 'monthly', 'custom'] as const).map((k) => (
          <Chip
            key={k}
            label={t(`repeat.${k}`)}
            active={mode === k}
            testID={testID ? `${testID}-${k}` : undefined}
            onPress={() => {
              setMode(k);
              if (k !== 'custom') onChange(PRESETS[k](date));
            }}
          />
        ))}
      </View>
      {mode === 'custom' && <Field value={value ?? ''} onChangeText={(s) => onChange(s || null)} placeholder="FREQ=WEEKLY;BYDAY=MO,TH" autoCapitalize="characters" style={{ marginTop: 8 }} />}
    </View>
  );
}
