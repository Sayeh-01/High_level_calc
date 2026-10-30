import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { usePrefs } from '@/lib/prefs';

export const colors = {
  bg: '#F5F4F0',
  card: '#FFFFFF',
  text: '#1C1C1E',
  muted: '#66666D',
  faint: '#9A9AA1',
  border: '#E4E2DC',
  primary: '#2F6F62',
  primaryText: '#FFFFFF',
  danger: '#B3261E',
  warn: '#9A5B00',
  good: '#1E7A3A',
  chip: '#ECEAE4',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export function Screen({
  title,
  children,
  scroll = true,
  right,
  back,
  testID,
  accent,
  footer,
}: {
  title?: string;
  children: ReactNode;
  scroll?: boolean;
  right?: ReactNode;
  back?: boolean;
  testID?: string;
  accent?: string;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const body = scroll ? (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3 }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1 }}>{children}</View>
  );
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} testID={testID}>
      {title !== undefined && (
        <View style={[styles.header, { paddingTop: insets.top + space.sm, borderBottomColor: accent ?? colors.border }]}>
          {back && (
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={styles.iconBtn} hitSlop={8}>
              <Chevron dir="back" />
            </Pressable>
          )}
          <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>{right}</View>
        </View>
      )}
      {body}
      {footer}
    </KeyboardAvoidingView>
  );
}

/** Chevrons point the reading direction and flip in Arabic (B7 #5). */
export function Chevron({ dir = 'forward', color = colors.muted }: { dir?: 'forward' | 'back'; color?: string }) {
  const { rtl } = usePrefs();
  const pointsRight = (dir === 'forward') !== rtl;
  return <Text style={{ fontSize: 22, color, lineHeight: 24 }}>{pointsRight ? '›' : '‹'}</Text>;
}

export function Card({ children, style, testID, onPress, accent }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string; onPress?: () => void; accent?: string }) {
  const content = (
    <View style={[styles.card, accent ? { borderStartWidth: 4, borderStartColor: accent } : null, style]} testID={onPress ? undefined : testID}>
      {children}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      {content}
    </Pressable>
  );
}

export function Section({ title, children, right, testID }: { title?: string; children: ReactNode; right?: ReactNode; testID?: string }) {
  return (
    <View style={{ marginBottom: space.lg }} testID={testID}>
      {title ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm }}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {title}
          </Text>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Row({
  title,
  subtitle,
  left,
  right,
  onPress,
  testID,
  chevron = !!onPress,
  strike,
}: {
  title: string;
  subtitle?: string | null;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  testID?: string;
  chevron?: boolean;
  strike?: boolean;
}) {
  const content = (
    <>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={[styles.rowTitle, strike ? { textDecorationLine: 'line-through', color: colors.faint } : null]} numberOfLines={2}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt style={styles.rowSub} numberOfLines={2}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right}
      {chevron ? <Chevron /> : null}
    </>
  );
  // A row without onPress must not be a disabled pressable: aria-disabled would also disable the buttons inside it.
  if (!onPress) {
    return (
      <View testID={testID} style={styles.row}>
        {content}
      </View>
    );
  }
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed ? { backgroundColor: '#F0EFEA' } : null]}>
      {content}
    </Pressable>
  );
}

export function Txt({ style, children, ...rest }: { style?: StyleProp<TextStyle>; children: ReactNode; numberOfLines?: number; testID?: string; accessibilityRole?: any }) {
  return (
    <Text style={[{ color: colors.text, fontSize: 15, textAlign: 'auto', writingDirection: 'auto' }, style]} {...rest}>
      {children}
    </Text>
  );
}

export const Muted = ({ children, style, testID }: { children: ReactNode; style?: StyleProp<TextStyle>; testID?: string }) => <Txt style={[{ color: colors.muted, fontSize: 13 }, style]} testID={testID}>{children}</Txt>;

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  loading,
  testID,
  small,
  color,
  style,
  accessibilityLabel,
}: {
  title: string;
  accessibilityLabel?: string;
  onPress?: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  small?: boolean;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = kind === 'primary' ? color ?? colors.primary : kind === 'danger' ? colors.danger : kind === 'secondary' ? colors.chip : 'transparent';
  const fg = kind === 'primary' || kind === 'danger' ? colors.primaryText : kind === 'ghost' ? color ?? colors.primary : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!(disabled || loading) }}
      style={({ pressed }) => [styles.btn, small && styles.btnSmall, { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: '600', fontSize: small ? 14 : 16, textAlign: 'center' }}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, hint, style, ...props }: TextInputProps & { label?: string; hint?: string; style?: StyleProp<TextStyle> }) {
  return (
    <View style={{ marginBottom: space.md }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.faint} style={[styles.input, props.multiline ? { minHeight: 80, textAlignVertical: 'top' } : null, style]} accessibilityLabel={label} {...props} />
      {hint ? <Muted style={{ marginTop: 4 }}>{hint}</Muted> : null}
    </View>
  );
}

export function Toggle({ label, value, onChange, testID }: { label: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  return (
    <View style={[styles.row, { paddingHorizontal: 0 }]}>
      <Txt style={{ flex: 1 }}>{label}</Txt>
      {/* react-native-web draws the thumb outside the track under dir=rtl; native switches mirror on their own */}
      <View style={{ direction: 'ltr' }}>
        <Switch value={value} onValueChange={onChange} testID={testID} accessibilityLabel={label} trackColor={{ true: colors.primary }} />
      </View>
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange, testID }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; testID?: string }) {
  return (
    <View style={styles.segment} testID={testID} accessibilityRole="tablist">
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          testID={testID ? `${testID}-${o.value}` : undefined}
          accessibilityRole="tab"
          accessibilityState={{ selected: o.value === value }}
          style={[styles.segmentItem, o.value === value && styles.segmentActive]}>
          <Text style={{ fontWeight: o.value === value ? '700' : '500', color: colors.text, textAlign: 'center' }} numberOfLines={1}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Chip({ label, active, onPress, testID, color }: { label: string; active?: boolean; onPress?: () => void; testID?: string; color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={[styles.chip, active && { backgroundColor: color ?? colors.primary }]}>
      <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '600', fontSize: 14 }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const AVATAR_COLORS = ['#E8875B', '#6C8EEF', '#4BA3A0', '#3FA34D', '#7A6FD0', '#C2577A', '#B98A2F'];
export function Avatar({ name, size = 32, color }: { name: string; size?: number; color?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  const c = color ?? AVATAR_COLORS[[...name].reduce((s, ch) => s + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={name}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.4 }}>{initials || '?'}</Text>
    </View>
  );
}

export function GroupTag({ emoji, name, color }: { emoji: string; name: string; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
        {emoji} {name}
      </Text>
    </View>
  );
}

export function Badge({ count, color = colors.danger }: { count: number; color?: string }) {
  if (!count) return null;
  return (
    <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: color, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

export function Empty({ title, hint, action, testID }: { title: string; hint?: string; action?: ReactNode; testID?: string }) {
  return (
    <View style={{ alignItems: 'center', padding: space.xl, gap: space.sm }} testID={testID}>
      <Txt style={{ fontSize: 16, fontWeight: '600', textAlign: 'center' }}>{title}</Txt>
      {hint ? <Muted style={{ textAlign: 'center' }}>{hint}</Muted> : null}
      {action}
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ padding: space.xl, alignItems: 'center' }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  return <Empty title={t('common.error')} hint={String((error as Error)?.message ?? '')} action={onRetry ? <Button small kind="secondary" title={t('common.retry')} onPress={onRetry} /> : null} />;
}

/** Bottom sheet for forms (RN Modal works on web too). */
export function Sheet({ visible, onClose, title, children, testID }: { visible: boolean; onClose: () => void; title: string; children: ReactNode; testID?: string }) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel={t('common.close')} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} testID={testID}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.md }}>
            <Txt style={{ flex: 1, fontSize: 18, fontWeight: '700' }}>{title}</Txt>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} style={styles.iconBtn} hitSlop={8}>
              <Text style={{ fontSize: 20, color: colors.muted }}>✕</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 560 }}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function useSheet() {
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), hide: () => setOpen(false) };
}

export function HScroll({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: 2 }}>
      {children}
    </ScrollView>
  );
}

export const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    backgroundColor: colors.card,
    borderBottomWidth: 2,
    gap: space.sm,
  },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'auto' },
  iconBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: space.lg, marginBottom: space.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'auto' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.sm, minHeight: 52, borderRadius: 10 },
  rowTitle: { fontSize: 16, fontWeight: '500' },
  rowSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  btn: { minHeight: 48, borderRadius: 12, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { minHeight: 44, paddingHorizontal: space.md, borderRadius: 10 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: 6, textAlign: 'auto' },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', paddingHorizontal: space.md, fontSize: 16, color: colors.text, textAlign: 'auto' },
  segment: { flexDirection: 'row', backgroundColor: colors.chip, borderRadius: 12, padding: 3, marginBottom: space.md },
  segmentItem: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingHorizontal: 6 },
  segmentActive: { backgroundColor: '#fff' },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.chip, alignItems: 'center', justifyContent: 'center' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: space.lg },
});
