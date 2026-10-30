import { Platform } from 'react-native';

/** Web is served from the same origin as the API (guest pages, E2E); native talks to EXPO_PUBLIC_API_URL. */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4100');

export const isWeb = Platform.OS === 'web';
