import { createElement } from 'react';

/** Web: the browser's own player (same-origin cookie sends the session). */
export function VoiceNote({ uri }: { uri: string; ms?: number | null; color: string }) {
  return createElement('audio', { controls: true, preload: 'none', src: uri, style: { width: 220, height: 40 }, 'data-testid': 'voice-note' });
}
