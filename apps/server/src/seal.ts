import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Sensitive data (health, IDs, vault files) is stored encrypted (A14). AES-256-GCM with a key derived from DATA_KEY
// (falls back to the auth secret in dev). Format: "v1:" + base64(iv | tag | ciphertext).

export function dataKey(secret: string): Buffer {
  return createHash('sha256').update(`circle-data:${process.env.DATA_KEY ?? secret}`).digest();
}

export function sealBytes(key: Buffer, plain: Uint8Array): Uint8Array {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return new Uint8Array(Buffer.concat([iv, c.getAuthTag(), body]));
}

export function openBytes(key: Buffer, sealed: Uint8Array): Uint8Array {
  const buf = Buffer.from(sealed);
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return new Uint8Array(Buffer.concat([d.update(buf.subarray(28)), d.final()]));
}

export function seal(key: Buffer, text: string | null | undefined): string | null {
  if (text === null || text === undefined || text === '') return null;
  return `v1:${Buffer.from(sealBytes(key, Buffer.from(text, 'utf8'))).toString('base64')}`;
}

export function open(key: Buffer, value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('v1:')) return value;
  return Buffer.from(openBytes(key, Buffer.from(value.slice(3), 'base64'))).toString('utf8');
}
