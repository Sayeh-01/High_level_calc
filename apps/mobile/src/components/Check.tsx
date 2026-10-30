import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { colors } from './ui';

/** Round checkbox with a 44pt touch target. Haptics on native when completing. */
export function Check({ checked, onPress, label, testID, color = colors.primary }: { checked?: boolean; onPress?: () => void; label: string; testID?: string; color?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!checked, busy }}
      accessibilityLabel={label}
      testID={testID}
      hitSlop={6}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      onPress={async () => {
        if (busy) return;
        setBusy(true);
        try {
          if (!checked && Platform.OS !== 'web') {
            const Haptics = await import('expo-haptics').catch(() => null);
            Haptics?.notificationAsync?.(Haptics.NotificationFeedbackType.Success).catch?.(() => {});
          }
          await onPress?.();
        } finally {
          setBusy(false);
        }
      }}>
      <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: checked ? color : colors.faint, backgroundColor: checked ? color : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {checked ? <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>✓</Text> : null}
      </View>
    </Pressable>
  );
}
