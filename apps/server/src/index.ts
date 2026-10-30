import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createDb } from './db/client';
import { startJobLoop } from './jobs';
import { createDevMailer, createSmtpMailer } from './mailer';
import { createExpoPushSender, createMemoryPushSender } from './push';
import { createDiskStorage } from './storage';

const port = Number(process.env.PORT ?? 4100);
const { db } = await createDb({ url: process.env.DATABASE_URL, dataDir: process.env.PGLITE_DIR });
const mailer = process.env.SMTP_URL ? createSmtpMailer(process.env.SMTP_URL, process.env.MAIL_FROM ?? 'Circle <no-reply@circle.app>') : createDevMailer();
const push = process.env.NODE_ENV === 'production' || process.env.EXPO_PUSH === '1' ? createExpoPushSender(undefined, process.env.EXPO_ACCESS_TOKEN) : createMemoryPushSender();

const { app, deps, injectWebSocket } = createApp({
  db,
  mailer,
  push,
  storage: createDiskStorage(process.env.FILES_DIR ?? '.data/files'),
  staticDir: process.env.STATIC_DIR,
  realtime: true,
});
const server = serve({ fetch: app.fetch, port }, (info) => console.log(`Circle server on http://localhost:${info.port}`));
injectWebSocket(server);
if (process.env.JOBS !== '0') startJobLoop(deps);
