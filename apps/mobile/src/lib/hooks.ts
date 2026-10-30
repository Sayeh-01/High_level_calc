import { can, moduleName, roleName, vocab, type Permission, type Role, type VocabKey } from '@circle/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { Alert, Platform } from 'react-native';
import { ApiError, get } from './api';
import i18n from './i18n';
import { usePrefs } from './prefs';

export interface Member {
  userId: string;
  role: Role;
  customRoleId: string | null;
  displayName: string;
  away: boolean;
  joinedAt: string;
  image: string | null;
}
export interface Group {
  id: string;
  type: string;
  name: string;
  emoji: string;
  color: string;
  photo: string | null;
  modules: string[];
  currency: string;
  timezone: string;
  /** v3.2: a department of this group */
  parentId: string | null;
  settings: Record<string, any>;
  createdBy: string;
}

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => get('/me') });
export const useGroups = () => useQuery({ queryKey: ['groups'], queryFn: () => get<any[]>('/groups') });

export function useGroup(id: string | undefined) {
  const { lang } = usePrefs();
  const q = useQuery({
    queryKey: ['group', id, 'detail'],
    queryFn: () => get<{ group: Group; me: Member; members: Member[] }>(`/groups/${id}`),
    enabled: !!id,
  });
  const data = q.data;
  const helpers = useMemo(() => {
    const type = data?.group.type ?? 'custom';
    const role = (data?.me.role ?? 'member') as Role;
    return {
      v: (key: VocabKey) => vocab(type, key, lang),
      roleLabel: (r: Role) => roleName(type, r, lang),
      moduleLabel: (m: string) => moduleName(type, m, lang),
      memberName: (uid: string | null | undefined) => (uid ? data?.members.find((m) => m.userId === uid)?.displayName ?? '—' : '—'),
      can: (p: Permission) => can(role, p, (data?.group.settings ?? {}) as any, data?.me.customRoleId),
      has: (m: string) => !!data?.group.modules.includes(m),
    };
  }, [data, lang]);
  return { ...q, group: data?.group, me: data?.me, members: data?.members ?? [], ...helpers };
}

export function errorMessage(e: unknown) {
  if (e instanceof ApiError) return e.message && e.message !== e.code ? e.message : e.code.replace(/_/g, ' ');
  return String((e as Error)?.message ?? e);
}

export function notifyError(e: unknown) {
  const msg = errorMessage(e);
  if (Platform.OS === 'web') window.alert(msg);
  else Alert.alert(i18n.t('common.error'), msg);
}

export function confirmAsk(message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(message));
  return new Promise((resolve) =>
    Alert.alert('', message, [
      { text: i18n.t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
      { text: i18n.t('common.confirm'), style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

/** Run a write, then refetch what it touched. */
export function useAct(groupId?: string) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      if (groupId) qc.invalidateQueries({ queryKey: ['group', groupId] });
      qc.invalidateQueries({ queryKey: ['today'] });
      qc.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: notifyError,
  });
  const run = useCallback(<T,>(fn: () => Promise<T>) => m.mutateAsync(fn) as Promise<T>, [m]);
  return { run, pending: m.isPending };
}

/** Server feature flags (AI on/off, social providers). AI UI is hidden when the server has no model (B4). */
export const useConfig = () => useQuery({ queryKey: ['config'], queryFn: () => get<{ ai: boolean; google: boolean; apple: boolean; phone: boolean; payments: boolean; fee: { bps: number; fixedMinor: number } }>('/config'), staleTime: 5 * 60_000 });
