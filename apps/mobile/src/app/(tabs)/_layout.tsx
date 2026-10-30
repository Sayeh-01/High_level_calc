import { Tabs } from 'expo-router/tabs';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '@/components/ui';
import { authClient } from '@/lib/auth';

const icon = (glyph: string) => ({ focused }: { focused: boolean }) => <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.55 }}>{glyph}</Text>;

export default function TabsLayout() {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const child = !!(session?.user as { isChild?: boolean } | undefined)?.isChild;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.primary, tabBarStyle: { minHeight: 60 }, tabBarLabelStyle: { fontSize: 12, fontWeight: '600' } }}>
      <Tabs.Screen name="index" options={{ title: t('tabs.today'), tabBarIcon: icon('☀️'), tabBarButtonTestID: 'tab-today' }} />
      <Tabs.Screen name="groups" options={{ title: t('tabs.groups'), tabBarIcon: icon('👥'), tabBarButtonTestID: 'tab-groups' }} />
      <Tabs.Screen
        name="capture"
        options={{
          href: child ? null : undefined,
          title: t('tabs.capture'),
          tabBarButtonTestID: 'tab-capture',
          tabBarIcon: () => (
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: -6 }}>
              <Text style={{ color: '#fff', fontSize: 26, lineHeight: 28 }}>+</Text>
            </View>
          ),
        }}
      />
      <Tabs.Screen name="inbox" options={{ title: t('tabs.inbox'), tabBarIcon: icon('🔔'), tabBarButtonTestID: 'tab-inbox' }} />
      <Tabs.Screen name="me" options={{ title: t('tabs.me'), tabBarIcon: icon('🙂'), tabBarButtonTestID: 'tab-me' }} />
    </Tabs>
  );
}
