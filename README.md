# Circle — one app for every group

Expo (iOS, Android, web) + Hono + PostgreSQL. Product spec and build contract: [`docs/SPEC.md`](docs/SPEC.md).
Build status: [`docs/PROGRESS.md`](docs/PROGRESS.md) · evidence and owner checklist: [`docs/REPORT.md`](docs/REPORT.md) ·
decisions: [`docs/NOTES.md`](docs/NOTES.md).

```
apps/mobile      Expo app (Expo Router, TanStack Query, i18next) + Playwright E2E on the web build
apps/server      Hono API, Drizzle ORM, Better Auth, jobs, realtime (WebSocket)
packages/shared  zod schemas, templates, permission matrix, money / rotation / recurrence logic
```

## Run it

```bash
pnpm install
pnpm check            # typecheck → Vitest (shared + server, on PGlite) → Playwright E2E on the Expo web build
pnpm dev:server       # API on http://localhost:4100 with an in-memory PGlite database; sign-in codes print to the console
pnpm dev:mobile       # Expo dev server; set EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:4100 for a phone
```
