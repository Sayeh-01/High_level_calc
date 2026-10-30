import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';

// Native: Better Auth's Expo plugin keeps the session cookie in the keychain/keystore (B7 #7).
const plugin = expoClient({ scheme: 'circleapp', storagePrefix: 'circle', storage: SecureStore });
export const platformAuthPlugins = [plugin] as const;

let getter: (() => string) | null = null;
export function bindCookieGetter(fn: () => string) {
  getter = fn;
}
export function getAuthCookie(): string | null {
  return getter ? getter() : null;
}
