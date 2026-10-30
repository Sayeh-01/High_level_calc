// Web: the session lives in an httpOnly cookie on the API origin.
export const platformAuthPlugins = [] as const;
export function getAuthCookie(): string | null {
  return null;
}
