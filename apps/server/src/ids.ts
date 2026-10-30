import { randomBytes, randomUUID } from 'node:crypto';

export const newId = () => randomUUID();

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Human-friendly code without look-alike characters (no 0/O, 1/I). */
export function newCode(length = 8): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export const newToken = (bytes = 24) => randomBytes(bytes).toString('base64url');
