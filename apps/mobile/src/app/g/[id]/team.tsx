import { PERMISSIONS, type Permission, type Role } from '@circle/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Field, Muted, Row, Screen, Section, Sheet, Txt, colors, useSheet } from '@/components/ui';
import { get, patch, post, put } from '@/lib/api';
import { useAct, useGroup } from '@/lib/hooks';
import { useFormat } from '@/lib/prefs';

const PERMS = Object.keys(PERMISSIONS).filter((p) => p !== 'group.delete' && p !== 'group.transfer') as Permission[];
const BASES: Role[] = ['manager', 'member', 'vendor', 'admin'];

/** Custom roles and departments (Company template, v3.2). */
export default function Team() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const fmt = useFormat();
  const router = useRouter();
  const { run, pending } = useAct(id);
  const roles = useQuery({ queryKey: ['group', id, 'roles'], queryFn: () => get(`/groups/${id}/roles`) });
  const subs = useQuery({ queryKey: ['group', id, 'subgroups'], queryFn: () => get(`/groups/${id}/subgroups`) });
  const roleSheet = useSheet();
  const deptSheet = useSheet();
  const color = g.group?.color ?? colors.primary;
  const admin = g.can('group.settings');
  const [role, setRole] = useState({ name: '', base: 'member' as Role, grant: [] as Permission[], deny: [] as Permission[] });
  const [dept, setDept] = useState({ name: '', memberIds: [] as string[] });
  const label = (p: Permission) => t(`company.perm_${p.replace('.', '_')}`);
  const toggle = (list: Permission[], p: Permission) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]);
  const roleName = (rid: string | null | undefined) => roles.data?.find((r: any) => r.id === rid)?.name ?? t('company.none');

  return (
    <Screen title={t('company.team')} back accent={color} testID="team-screen">
      <Section title={t('company.departments')}>
        {admin && <Button small color={color} title={`＋ ${t('company.newDepartment')}`} onPress={deptSheet.show} testID="new-department" style={{ alignSelf: 'flex-start', marginBottom: 8 }} />}
        {subs.data?.map((s: any) => (
          <Card key={s.id} onPress={s.member ? () => router.push(`/g/${s.id}`) : undefined} testID={`department-${s.id}`}>
            <Row title={`${s.emoji} ${s.name}`} subtitle={t('company.members', { n: fmt.number(s.members) })} />
          </Card>
        ))}
      </Section>
      <Section title={t('company.roles')}>
        {admin && <Button small color={color} title={`＋ ${t('company.newRole')}`} onPress={roleSheet.show} testID="new-role" style={{ alignSelf: 'flex-start', marginBottom: 8 }} />}
        {roles.data?.map((r: any) => (
          <Card key={r.id} testID={`role-${r.id}`}>
            <Txt style={{ fontWeight: '700' }}>{`🎭 ${r.name}`}</Txt>
            <Muted>{`${t('company.base')}: ${g.roleLabel(r.base)}`}</Muted>
            {r.grant.length > 0 && <Muted>{`✓ ${r.grant.map(label).join('، ')}`}</Muted>}
            {r.deny.length > 0 && <Muted>{`✕ ${r.deny.map(label).join('، ')}`}</Muted>}
          </Card>
        ))}
        {admin && (roles.data?.length ?? 0) > 0 && (
          <Card>
            {g.members.filter((m) => m.role !== 'owner').map((m) => (
              <View key={m.userId} style={{ paddingVertical: 6 }}>
                <Txt style={{ fontWeight: '600' }}>{`${m.displayName} · ${roleName(m.customRoleId)}`}</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  <Chip label={t('company.none')} active={!m.customRoleId} color={color} onPress={() => run(() => patch(`/groups/${id}/members/${m.userId}`, { customRoleId: null }))} />
                  {roles.data.map((r: any) => (
                    <Chip key={r.id} label={r.name} active={m.customRoleId === r.id} color={color} onPress={() => run(() => patch(`/groups/${id}/members/${m.userId}`, { customRoleId: r.id }))} testID={`assign-${m.userId}-${r.id}`} />
                  ))}
                </View>
              </View>
            ))}
          </Card>
        )}
      </Section>

      <Sheet visible={roleSheet.open} onClose={roleSheet.hide} title={t('company.newRole')} testID="role-sheet">
        <Field label={t('company.roleName')} value={role.name} onChangeText={(s) => setRole({ ...role, name: s })} testID="role-name" />
        <Muted>{t('company.base')}</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 }}>
          {BASES.map((b) => (
            <Chip key={b} label={g.roleLabel(b)} active={role.base === b} color={color} onPress={() => setRole({ ...role, base: b })} />
          ))}
        </View>
        <Muted>{t('company.grant')}</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 }}>
          {PERMS.map((p) => (
            <Chip key={p} label={label(p)} active={role.grant.includes(p)} color={colors.good} onPress={() => setRole({ ...role, grant: toggle(role.grant, p), deny: role.deny.filter((x) => x !== p) })} testID={`grant-${p}`} />
          ))}
        </View>
        <Muted>{t('company.deny')}</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 }}>
          {PERMS.map((p) => (
            <Chip key={p} label={label(p)} active={role.deny.includes(p)} color={colors.danger} onPress={() => setRole({ ...role, deny: toggle(role.deny, p), grant: role.grant.filter((x) => x !== p) })} testID={`deny-${p}`} />
          ))}
        </View>
        <Button
          title={t('common.save')}
          color={color}
          loading={pending}
          disabled={!role.name.trim()}
          testID="role-save"
          onPress={async () => {
            const rid = role.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `role-${Date.now().toString(36)}`;
            await run(() => put(`/groups/${id}/roles/${rid}`, { ...role, name: role.name.trim() }));
            setRole({ name: '', base: 'member', grant: [], deny: [] });
            roleSheet.hide();
          }}
        />
      </Sheet>

      <Sheet visible={deptSheet.open} onClose={deptSheet.hide} title={t('company.newDepartment')} testID="department-sheet">
        <Field label={t('company.departmentName')} value={dept.name} onChangeText={(s) => setDept({ ...dept, name: s })} testID="department-name" />
        <Muted>{t('company.whoIn')}</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 }}>
          {g.members.filter((m) => m.role !== 'owner' && m.role !== 'admin').map((m) => {
            const on = dept.memberIds.includes(m.userId);
            return <Chip key={m.userId} label={m.displayName} active={on} color={color} onPress={() => setDept({ ...dept, memberIds: on ? dept.memberIds.filter((x) => x !== m.userId) : [...dept.memberIds, m.userId] })} testID={`dept-member-${m.userId}`} />;
          })}
        </View>
        <Muted style={{ marginBottom: 12 }}>{t('company.leadsJoin')}</Muted>
        <Button
          title={t('common.create')}
          color={color}
          loading={pending}
          disabled={!dept.name.trim()}
          testID="department-save"
          onPress={async () => {
            await run(() => post(`/groups/${id}/subgroups`, { name: dept.name.trim(), memberIds: dept.memberIds }));
            setDept({ name: '', memberIds: [] });
            deptSheet.hide();
          }}
        />
      </Sheet>
    </Screen>
  );
}
