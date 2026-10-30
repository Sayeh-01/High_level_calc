import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SignInForm } from '@/components/SignIn';
import { colors } from '@/components/ui';

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 24, paddingTop: insets.top + 48, maxWidth: 520, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
      <SignInForm />
    </ScrollView>
  );
}
