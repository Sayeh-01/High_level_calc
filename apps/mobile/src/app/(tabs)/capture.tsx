import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Chip, Field, HScroll, Muted, Screen, Segmented, Txt, styles } from '@/components/ui';
import { DateTimeField } from '@/components/DateTimeField';
import { get, post } from '@/lib/api';
import { parseQuickCapture } from '@circle/shared';
import { useAct, useConfig, useGroups } from '@/lib/hooks';
import { usePrefs } from '@/lib/prefs';
import { useQuery } from '@tanstack/react-query';

type Kind = 'task' | 'event' | 'item';

/** Quick capture (A9): rule-based in 1.0. One sentence → item; the date is parsed, the group is picked by hand. */
export default function Capture() {
  const { t } = useTranslation();
  const router = useRouter();
  const { tz } = usePrefs();
  const groups = useGroups();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Kind>('task');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [when, setWhen] = useState<Date | null>(null);
  const [listId, setListId] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const config = useConfig();
  const [aiTitle, setAiTitle] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const { run, pending } = useAct(groupId ?? undefined);
  const parsed = useMemo(() => parseQuickCapture(text, new Date(), tz), [text, tz]);
  const moduleFor = kind === 'task' ? 'tasks' : kind === 'event' ? 'events' : 'lists';
  const candidates = (groups.data ?? []).filter((g: any) => g.modules.includes(moduleFor) && g.role !== 'guest');
  const lists = useQuery({ queryKey: ['group', groupId, 'lists'], queryFn: () => get(`/groups/${groupId}/lists`), enabled: !!groupId && kind === 'item' });
  const date = when ?? parsed.when;

  async function save() {
    if (!groupId) return;
    const title = aiTitle ?? (parsed.title || text.trim());
    if (kind === 'task') await run(() => post(`/groups/${groupId}/tasks`, { title, dueAt: date?.toISOString() ?? null, assigneeId: assignees[0] ?? null }));
    if (kind === 'event') await run(() => post(`/groups/${groupId}/events`, { title, startsAt: (date ?? new Date(Date.now() + 86_400_000)).toISOString() }));
    if (kind === 'item' && listId) await run(() => post(`/groups/${groupId}/lists/${listId}/items`, { title }));
    const g = candidates.find((x: any) => x.id === groupId);
    setSaved(t('capture.saved', { group: g?.name ?? '' }));
    setText('');
    setWhen(null);
    setAiTitle(null);
    setAssignees([]);
  }

  /** AI fills the form (group, type, date, assignees); the user still reviews and presses Save. */
  async function smart() {
    setThinking(true);
    try {
      const { draft } = await run(() => post('/ai/capture', { text }));
      setKind(draft.kind === 'list_item' ? 'item' : draft.kind);
      if (draft.groupId) setGroupId(draft.groupId);
      if (draft.listId) setListId(draft.listId);
      setWhen(draft.when ? new Date(draft.when) : null);
      setAiTitle(draft.title);
      setAssignees(draft.assigneeIds);
    } finally {
      setThinking(false);
    }
  }

  return (
    <Screen title={t('capture.title')} testID="capture-screen">
      <Muted style={{ marginBottom: 12 }}>{t('capture.hint')}</Muted>
      <Field value={text} onChangeText={(s) => (setText(s), setSaved(null), setAiTitle(null))} placeholder={t('capture.placeholder')} testID="capture-input" autoFocus />
      {config.data?.ai && <Button kind="secondary" title={t('life.smart')} onPress={smart} loading={thinking} disabled={!text.trim()} testID="capture-smart" style={{ marginBottom: 12 }} />}
      {aiTitle && <Muted style={{ marginBottom: 8 }} testID="capture-draft">{`${t('life.draft')}: ${aiTitle}`}</Muted>}
      <Segmented<Kind>
        value={kind}
        onChange={setKind}
        testID="capture-kind"
        options={[
          { value: 'task', label: t('capture.task') },
          { value: 'event', label: t('capture.event') },
          { value: 'item', label: t('capture.listItem') },
        ]}
      />
      <Txt style={styles.label}>{t('capture.group')}</Txt>
      <HScroll>
        {candidates.map((g: any) => (
          <Chip key={g.id} label={`${g.emoji} ${g.name}`} active={groupId === g.id} color={g.color} onPress={() => (setGroupId(g.id), setListId(null))} testID={`capture-group-${g.id}`} />
        ))}
      </HScroll>
      {kind === 'item' && groupId ? (
        <View style={{ marginTop: 12 }}>
          <Txt style={styles.label}>{t('capture.list')}</Txt>
          <HScroll>
            {(lists.data ?? []).map((l: any) => (
              <Chip key={l.id} label={l.title} active={listId === l.id} onPress={() => setListId(l.id)} />
            ))}
          </HScroll>
        </View>
      ) : null}
      {kind !== 'item' && (
        <View style={{ marginTop: 12 }}>
          <DateTimeField value={date} onChange={setWhen} tz={tz} allowNone={kind === 'task'} testID="capture-when" />
        </View>
      )}
      <Button title={t('common.save')} onPress={save} loading={pending} disabled={!text.trim() || !groupId || (kind === 'item' && !listId)} testID="capture-save" style={{ marginTop: 12 }} />
      {saved ? (
        <Button kind="ghost" title={`✓ ${saved}`} onPress={() => router.push(`/g/${groupId}`)} style={{ marginTop: 8 }} />
      ) : null}
    </Screen>
  );
}
