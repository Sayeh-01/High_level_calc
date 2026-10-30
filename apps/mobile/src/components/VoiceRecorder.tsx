import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { Pressable, Text } from 'react-native';
import { colors } from './ui';

/** Native: tap to start, tap to stop. The recording is uploaded by the caller. Device check in REPORT. */
export function VoiceRecorder({ onDone, label }: { onDone: (uri: string, ms: number) => void; label: string }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  async function toggle() {
    if (state.isRecording) {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      if (recorder.uri) onDone(recorder.uri, Math.round(state.durationMillis));
      return;
    }
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) return;
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }
  return (
    <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={label} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 22, color: state.isRecording ? colors.danger : colors.text }}>{state.isRecording ? `⏹ ${Math.round(state.durationMillis / 1000)}s` : '🎙️'}</Text>
    </Pressable>
  );
}
