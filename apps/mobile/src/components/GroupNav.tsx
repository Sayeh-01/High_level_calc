import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useGroup } from '@/lib/hooks';
import { Chip, ErrorView, Loading, Screen, colors } from './ui';

/** Route segment for each module screen. Later versions add entries here; no per-template branching. */
export const MODULE_ROUTES: Record<string, string> = {
  tasks: 'tasks',
  events: 'events',
  lists: 'lists',
  expenses: 'expenses',
  polls: 'polls',
  chat: 'chat',
  points: 'points',
  teams: 'teams',
  focus: 'focus',
  flashcards: 'flashcards',
  notes: 'notes',
  meals: 'meals',
  memories: 'memories',
  vault: 'vault',
  meds: 'meds',
  safety: 'safety',
  dues: 'dues',
  budgets: 'budgets',
  contacts: 'contacts',
  guests: 'guests',
  gameya: 'gameya',
  challenges: 'challenges',
  forms: 'forms',
  standups: 'standups',
  meetings: 'meetings',
  leave: 'leave',
  checklists: 'checklists',
  shifts: 'shifts',
  clock: 'clock',
  inventory: 'inventory',
  assets: 'assets',
  approvals: 'approvals',
};

const PINNED = 5;

/** Group header + top tab bar of the group's modules (template vocabulary replaces module names). Up to 5 pinned, rest under More. */
export function GroupScreen({ id, active, children, scroll = true, right, title, footer }: { id: string; active?: string; children: ReactNode; scroll?: boolean; right?: ReactNode; title?: string; footer?: ReactNode }) {
  const g = useGroup(id);
  const router = useRouter();
  const { t } = useTranslation();
  const [more, setMore] = useState(false);
  if (g.isLoading) return <Screen title="" back><Loading /></Screen>;
  if (g.error || !g.group) return <Screen title="" back><ErrorView error={g.error} onRetry={() => g.refetch()} /></Screen>;
  const group = g.group;
  const mods = group.modules.filter((m) => MODULE_ROUTES[m]);
  const pinned = mods.slice(0, PINNED);
  const rest = mods.slice(PINNED);
  const go = (seg: string) => router.replace(`/g/${id}${seg ? '/' + seg : ''}` as any);
  return (
    <Screen
      title={title ?? `${g.group.emoji} ${g.group.name}`}
      back
      accent={g.group.color}
      scroll={scroll}
      testID={`group-screen-${active ?? 'home'}`}
      footer={footer}
      right={
        <>
          {right}
          <Pressable onPress={() => router.push(`/g/${id}/settings`)} accessibilityRole="button" accessibilityLabel={t('group.settings')} testID="group-settings" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 20 }}>⚙️</Text>
          </Pressable>
        </>
      }>
      <View style={{ backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border, marginHorizontal: scroll ? -16 : 0, marginTop: scroll ? -16 : 0, marginBottom: scroll ? 16 : 0 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, padding: 10 }}>
          <Chip label={t('group.home')} active={!active} onPress={() => go('')} color={group.color} testID="tab-home" />
          {pinned.map((m) => (
            <Chip key={m} label={g.moduleLabel(m)} active={active === m} onPress={() => go(MODULE_ROUTES[m])} color={group.color} testID={`tab-${m}`} />
          ))}
          {rest.length > 0 && <Chip label={`${t('common.more')} ▾`} active={more || rest.includes(active ?? '')} onPress={() => setMore(!more)} color={group.color} testID="tab-more" />}
        </ScrollView>
        {more && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 10, paddingBottom: 10 }}>
            {rest.map((m) => (
              <Chip key={m} label={g.moduleLabel(m)} active={active === m} onPress={() => go(MODULE_ROUTES[m])} color={group.color} testID={`tab-${m}`} />
            ))}
          </View>
        )}
      </View>
      {children}
    </Screen>
  );
}
