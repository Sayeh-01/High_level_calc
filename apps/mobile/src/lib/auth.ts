import { emailOTPClient, phoneNumberClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { Platform } from 'react-native';
import { platformAuthPlugins } from './auth-plugins';
import { API_URL } from './config';

export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: '/api/auth',
  plugins: [emailOTPClient(), phoneNumberClient(), ...(platformAuthPlugins as unknown as [])],
  fetchOptions: Platform.OS === 'web' ? { credentials: 'include' } : undefined,
});

if (Platform.OS !== 'web') {
  // the Expo plugin adds getCookie() for attaching the session to our own fetches
  const getCookie = (authClient as unknown as { getCookie?: () => string }).getCookie;
  if (getCookie) require('./auth-plugins').bindCookieGetter?.(getCookie);
}
