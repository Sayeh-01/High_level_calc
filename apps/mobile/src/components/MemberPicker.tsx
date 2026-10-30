import { View } from 'react-native';
import type { Member } from '@/lib/hooks';
import { Chip, Txt, styles } from './ui';

export function MemberPicker({ members, selected, onToggle, label, multi, color, testID }: { members: Member[]; selected: string[]; onToggle: (id: string) => void; label?: string; multi?: boolean; color?: string; testID?: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? <Txt style={styles.label}>{label}</Txt> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {members.map((m) => (
          <Chip key={m.userId} label={m.displayName} active={selected.includes(m.userId)} onPress={() => onToggle(m.userId)} color={color} testID={testID ? `${testID}-${m.userId}` : undefined} />
        ))}
      </View>
    </View>
  );
}
