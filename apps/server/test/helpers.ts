import { createApp, type AppOptions } from '../src/app';
import { createDb } from '../src/db/client';
import { runDueJobs } from '../src/jobs';
import { createDevMailer } from '../src/mailer';
import { createMemoryPushSender } from '../src/push';

export interface Res<T = any> {
  status: number;
  body: T;
}

export interface Client {
  user: { id: string; email: string; name: string };
  cookie: string;
  req<T = any>(method: string, path: string, body?: unknown): Promise<Res<T>>;
  get<T = any>(path: string): Promise<Res<T>>;
  post<T = any>(path: string, body?: unknown): Promise<Res<T>>;
  patch<T = any>(path: string, body?: unknown): Promise<Res<T>>;
  put<T = any>(path: string, body?: unknown): Promise<Res<T>>;
  del<T = any>(path: string): Promise<Res<T>>;
}

export const ORIGIN = 'http://localhost:4100';

export async function setup(opts: Partial<AppOptions> = {}) {
  const { db, close } = await createDb();
  let now = new Date('2026-11-02T08:00:00Z');
  const clock = () => now;
  const mailer = createDevMailer(false);
  const push = createMemoryPushSender();
  const circle = createApp({ db, env: { nodeEnv: 'test', publicUrl: ORIGIN }, clock, mailer, push, ...opts });
  const { app } = circle;

  async function raw(method: string, path: string, body?: unknown, cookie?: string): Promise<Response> {
    return app.request(path, {
      method,
      headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function clientFor(cookie: string, user: Client['user']): Client {
    const req = async (method: string, path: string, body?: unknown) => {
      const res = await raw(method, path, body, cookie);
      const text = await res.text();
      let parsed: any = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {}
      return { status: res.status, body: parsed };
    };
    return {
      user,
      cookie,
      req,
      get: (p) => req('GET', p),
      post: (p, b) => req('POST', p, b ?? {}),
      patch: (p, b) => req('PATCH', p, b ?? {}),
      put: (p, b) => req('PUT', p, b ?? {}),
      del: (p) => req('DELETE', p),
    };
  }

  async function signIn(email: string, name = email.split('@')[0]): Promise<Client> {
    const sent = await raw('POST', '/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
    if (sent.status !== 200) throw new Error(`send otp failed: ${sent.status} ${await sent.text()}`);
    const otp = mailer.lastOtp!(email)!;
    const res = await raw('POST', '/api/auth/sign-in/email-otp', { email, otp });
    if (res.status !== 200) throw new Error(`sign in failed: ${res.status} ${await res.text()}`);
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const json = await res.json();
    const client = clientFor(cookie, { id: json.user.id, email, name });
    await client.patch('/api/me', { name });
    return client;
  }

  return {
    ...circle,
    db,
    push,
    mailer,
    close,
    raw,
    signIn,
    now: () => now,
    setNow(d: Date | string) {
      now = new Date(d);
    },
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    runJobs: () => runDueJobs(circle.deps, now),
  };
}

export type TestApp = Awaited<ReturnType<typeof setup>>;

/** Creates a group from a template and returns its id and invite code. */
export async function makeGroup(c: Client, templateId = 'sport', name = 'Thursday Football', extra: Record<string, unknown> = {}) {
  const res = await c.post('/api/groups', { templateId, name, lang: 'en', ...extra });
  if (res.status !== 200) throw new Error(`create group failed ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.group.id as string, code: res.body.invite.code as string, group: res.body.group };
}

export async function join(c: Client, code: string, displayName?: string) {
  const res = await c.post(`/api/invites/${code}/join`, displayName ? { displayName } : {});
  if (res.status !== 200) throw new Error(`join failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
