import { PLANS, type PlanId, type Role } from '@circle/shared';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Card, Chip, Field, HScroll, Loading, Muted, Row, Screen, Section, Sheet, Toggle, useSheet } from '@/components/ui';
import { authHeaders, del, fileUrl, get, patch, post, put, uploadFile } from '@/lib/api';
import { confirmAsk, useAct, useGroup } from '@/lib/hooks';
import { availableModules } from '@/lib/modules';
import { usePrefs } from '@/lib/prefs';

export default function GroupSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroup(id);
  const { t } = useTranslation();
  const router = useRouter();
  const { run } = useAct(id);
  const [name, setName] = useState('');
  const [myName, setMyName] = useState('');
  const kidSheet = useSheet();
  const [kid, setKid] = useState({ name: '', pin: '' });
  const links = useQuery({ queryKey: ['group', id, 'guest-links'], queryFn: () => get(`/groups/${id}/guest-links`), enabled: g.can('items.create') });
  const plan = useQuery({ queryKey: ['group', id, 'plan'], queryFn: () => get(`/groups/${id}/plan`) });
  const { lang } = usePrefs();
  useEffect(() => {
    if (g.group) setName(g.group.name);
    if (g.me) setMyName(g.me.displayName);
  }, [g.group?.name, g.me?.displayName]);
  if (!g.group || !g.me) return <Screen title="" back><Loading /></Screen>;
  const admin = g.can('group.settings');
  const owner = g.me.role === 'owner';

  return (
    <Screen title={t('settings.title')} back accent={g.group.color} testID="settings-screen">
      <Card>
        <Field label={t('settings.myName')} value={myName} onChangeText={setMyName} onBlur={() => myName.trim() && run(() => patch(`/groups/${id}/me`, { displayName: myName.trim() }))} testID="my-display-name" />
        <Toggle label={t('settings.away')} value={g.me.away} onChange={(v) => run(() => patch(`/groups/${id}/members/${g.me!.userId}`, { away: v }))} />
      </Card>
      {admin && (
        <Card>
          <Field label={t('settings.name')} value={name} onChangeText={setName} onBlur={() => name.trim() && run(() => patch(`/groups/${id}`, { name: name.trim() }))} testID="group-rename" />
          <HScroll>
            {['⚽', '🏠', '🛋️', '📚', '💼', '✨', '🏀', '🎾', '🏃', '🍲', '🎮', '🎉', '✈️', '❤️', '🌙', '🏢'].map((e) => (
              <Chip key={e} label={e} active={g.group!.emoji === e} color={g.group!.color} onPress={() => run(() => patch(`/groups/${id}`, { emoji: e }))} />
            ))}
          </HScroll>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 12 }}>
            {g.group.photo ? <Image source={{ uri: fileUrl(id, g.group.photo), headers: authHeaders() }} style={{ width: 56, height: 56, borderRadius: 12 }} /> : null}
            <Button
              small
              kind="secondary"
              title={t('settings.photo')}
              onPress={async () => {
                const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5 });
                if (res.canceled || !res.assets[0]) return;
                await run(async () => patch(`/groups/${id}`, { photo: await uploadFile(id, res.assets[0].uri, res.assets[0].mimeType ?? 'image/jpeg') }));
              }}
            />
          </View>
          <Toggle label={t('settings.membersCanInvite')} value={g.group.settings.membersCanInvite !== false} onChange={(v) => run(() => patch(`/groups/${id}`, { membersCanInvite: v }))} />
        </Card>
      )}
      <Card onPress={() => router.push(`/paywall?plan=group_pro&groupId=${id}`)} testID="settings-plan">
        <Row
          title={`${t('plans.current')}: ${plan.data ? PLANS[plan.data.plan as PlanId]?.name[lang] ?? plan.data.plan : '…'}`}
          subtitle={plan.data ? t('plans.seats', { members: plan.data.members, limit: plan.data.limit }) : undefined}
        />
      </Card>
      {admin && (
        <Section title={t('settings.modules')}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {availableModules().map((m) => {
              const on = g.group!.modules.includes(m);
              return <Chip key={m} label={g.moduleLabel(m)} active={on} color={g.group!.color} testID={`toggle-module-${m}`} onPress={() => run(() => put(`/groups/${id}/modules`, { modules: on ? g.group!.modules.filter((x) => x !== m) : [...g.group!.modules, m] }))} />;
            })}
          </View>
        </Section>
      )}
      {admin && <Button kind="secondary" title={`🎭 ${t('company.team')}`} onPress={() => router.push(`/g/${id}/team`)} testID="open-team" style={{ marginBottom: 12 }} />}
      <Section title={t('settings.members')}>
        <Card style={{ paddingVertical: 4 }}>
          {g.members.map((m) => (
            <View key={m.userId}>
              <Row title={m.displayName} subtitle={`${g.roleLabel(m.role as Role)}${m.away ? ' · ✈️' : ''}`} left={<Avatar name={m.displayName} />} testID={`member-${m.userId}`} />
              {admin && m.role !== 'owner' && m.userId !== g.me!.userId && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 8, paddingStart: 52 }}>
                  {m.role === 'admin' ? (
                    <Button small kind="secondary" title={t('settings.makeMember')} onPress={() => run(() => patch(`/groups/${id}/members/${m.userId}`, { role: 'member' }))} />
                  ) : (
                    <Button small kind="secondary" title={t('settings.makeAdmin')} onPress={() => run(() => patch(`/groups/${id}/members/${m.userId}`, { role: 'admin' }))} testID={`make-admin-${m.userId}`} />
                  )}
                  {owner && <Button small kind="secondary" title={t('settings.transfer')} onPress={async () => (await confirmAsk(t('settings.transfer'))) && run(() => post(`/groups/${id}/transfer`, { userId: m.userId }))} />}
                  <Button small kind="ghost" title={t('settings.remove')} onPress={async () => (await confirmAsk(`${t('settings.remove')} ${m.displayName}?`)) && run(() => del(`/groups/${id}/members/${m.userId}`))} />
                </View>
              )}
            </View>
          ))}
        </Card>
      </Section>
      {links.data?.length > 0 && (
        <Section title={t('reach.guestLinks')}>
          <Card style={{ paddingVertical: 4 }} testID="guest-links">
            {links.data.map((l: any) => (
              <Row key={l.id} title={l.entity === 'event' ? `📅 ${g.v('event')}` : `📝 ${g.v('list')}`} subtitle={l.url} right={<Button small kind="ghost" title={t('reach.revoke')} onPress={() => run(() => del(`/groups/${id}/guest-links/${l.id}`))} testID={`revoke-${l.id}`} />} />
            ))}
          </Card>
        </Section>
      )}
      <View style={{ gap: 10 }}>
        {admin && <Button kind="secondary" title={`🧒 ${t('kids.add')}`} onPress={kidSheet.show} testID="add-child" />}
        <Button kind="secondary" title={t('group.invite')} onPress={() => router.push(`/g/${id}/invite`)} />
        {!owner && (
          <Button
            kind="secondary"
            title={t('settings.leave')}
            onPress={async () => {
              if (!(await confirmAsk(t('settings.leave')))) return;
              await run(() => post(`/groups/${id}/leave`));
              router.replace('/groups');
            }}
          />
        )}
        {owner && (
          <Button
            kind="danger"
            title={t('settings.delete')}
            testID="delete-group"
            onPress={async () => {
              if (!(await confirmAsk(t('settings.deleteConfirm')))) return;
              await run(() => del(`/groups/${id}`));
              router.replace('/groups');
            }}
          />
        )}
      </View>
      <Muted style={{ marginTop: 16, textAlign: 'center' }}>{g.group.type}</Muted>
      <Sheet visible={kidSheet.open} onClose={kidSheet.hide} title={t('kids.add')}>
        <Muted style={{ marginBottom: 12 }}>{t('kids.hint')}</Muted>
        <Field label={t('kids.name')} value={kid.name} onChangeText={(s) => setKid({ ...kid, name: s })} testID="child-name" />
        <Field label={t('kids.pin')} value={kid.pin} onChangeText={(s) => setKid({ ...kid, pin: s.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" secureTextEntry testID="child-pin" />
        <Button
          title={t('common.create')}
          disabled={!kid.name.trim() || kid.pin.length < 4}
          testID="child-save"
          onPress={async () => {
            await run(() => post(`/groups/${id}/children`, { name: kid.name.trim(), pin: kid.pin }));
            setKid({ name: '', pin: '' });
            kidSheet.hide();
          }}
        />
      </Sheet>
    </Screen>
  );
}
