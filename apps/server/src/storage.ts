import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** S3-compatible in production (Cloudflare R2); local disk or memory in dev and tests. */
export interface FileStorage {
  put(key: string, data: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

export function createMemoryStorage(): FileStorage {
  const files = new Map<string, Uint8Array>();
  return {
    async put(key, data) {
      files.set(key, data);
    },
    async get(key) {
      return files.get(key) ?? null;
    },
  };
}

export function createDiskStorage(root: string): FileStorage {
  const safe = (key: string) => join(root, key.replace(/\.\./g, '_'));
  return {
    async put(key, data) {
      const path = safe(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(safe(key)));
      } catch {
        return null;
      }
    },
  };
}
