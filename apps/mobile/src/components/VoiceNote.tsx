import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Pressable, Text } from 'react-native';
import { authHeaders } from '@/lib/api';

export function VoiceNote({ uri, ms, color }: { uri: string; ms?: number | null; color: string }) {
  const player = useAudioPlayer({ uri, headers: authHeaders() });
  const status = useAudioPlayerStatus(player);
  return (
    <Pressable onPress={() => (status.playing ? player.pause() : (player.seekTo(0), player.play()))} accessibilityRole="button" accessibilityLabel="voice note" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
      <Text style={{ fontSize: 22, color }}>{status.playing ? '⏸' : '▶️'}</Text>
      <Text style={{ color }}>{Math.round((ms ?? 0) / 1000)}s</Text>
    </Pressable>
  );
}
