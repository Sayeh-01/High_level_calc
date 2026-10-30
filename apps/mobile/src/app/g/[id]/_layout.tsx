import { Stack } from 'expo-router';
import { colors } from '@/components/ui';

export default function GroupLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
