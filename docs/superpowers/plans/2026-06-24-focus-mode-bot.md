# Focus Mode Bot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a group focus session Discord bot with leaderboard for the study-yap land server, deployable on an Oracle Cloud VM.

**Architecture:** pnpm monorepo with two packages — `apps/bot` (discord.js worker) and `packages/db` (Prisma schema + client). The bot handles all Discord events and manages in-memory timers for session countdowns. PostgreSQL is the only persistence layer. Docker Compose for local dev; PM2 for production on Oracle Cloud.

**Tech Stack:** Node.js 20, TypeScript, discord.js v14, Prisma, PostgreSQL 16, Vitest, pnpm workspaces, Docker Compose (local), PM2 (prod)

---

## File Map

```
discord-bot-main/
├── apps/bot/
│   ├── src/
│   │   ├── index.ts              # entry point — creates client, registers handlers, logs in
│   │   ├── env.ts                # zod-validated env vars
│   │   ├── client.ts             # discord.js Client factory (intents, partials)
│   │   ├── commands/
│   │   │   ├── index.ts          # registers all slash commands with Discord API
│   │   │   ├── focus.ts          # /focus command handler
│   │   │   ├── leaderboard.ts    # /leaderboard command handler
│   │   │   └── mystats.ts        # /mystats command handler
│   │   ├── handlers/
│   │   │   ├── guild.ts          # guildCreate / guildDelete → upsert Guild row
│   │   │   └── interactions.ts   # routes button customIds to focus/* handlers
│   │   └── focus/
│   │       ├── breaks.ts         # pure fn: durationMins → break suggestion string
│   │       ├── breaks.test.ts
│   │       ├── embed.ts          # builds the session Discord embed + buttons
│   │       ├── session.ts        # DB ops: create, start, end, cancel, getByChannel
│   │       ├── session.test.ts
│   │       ├── participants.ts   # DB ops: join, leave, computeMinutes
│   │       ├── participants.test.ts
│   │       ├── stats.ts          # DB queries: leaderboard, mystats
│   │       ├── stats.test.ts
│   │       └── timer.ts          # in-memory Map<sessionId, Timeout>
│   ├── package.json
│   └── tsconfig.json
├── packages/db/
│   ├── prisma/schema.prisma
│   ├── src/index.ts              # exports prisma client singleton
│   └── package.json
├── docker-compose.yml
├── .env.example
├── package.json                  # root — workspace + scripts
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `docker-compose.yml`
- Create: `.env.example`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "yap-bot",
  "private": true,
  "scripts": {
    "dev:bot": "pnpm --filter @yap/bot dev",
    "build:bot": "pnpm --filter @yap/bot build",
    "db:generate": "pnpm --filter @yap/db db:generate",
    "db:migrate": "pnpm --filter @yap/db db:migrate",
    "db:push": "pnpm --filter @yap/db db:push"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: yap
      POSTGRES_PASSWORD: yap
      POSTGRES_DB: yap
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

- [ ] **Step 5: Create `.env.example`**

```env
# Discord — get from discord.com/developers/applications
DISCORD_TOKEN=
DISCORD_CLIENT_ID=

# PostgreSQL — local: postgresql://yap:yap@localhost:5432/yap
DATABASE_URL=
```

- [ ] **Step 6: Commit**

```bash
git init
git add package.json pnpm-workspace.yaml tsconfig.base.json docker-compose.yml .env.example
git commit -m "chore: monorepo scaffold"
```

---

## Task 2: DB package — Prisma schema

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/index.ts`

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@yap/db",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "scripts": {
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:push": "prisma db push"
  },
  "dependencies": {
    "@prisma/client": "^5.22.0"
  },
  "devDependencies": {
    "prisma": "^5.22.0"
  }
}
```

- [ ] **Step 2: Create `packages/db/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Guild {
  id       String   @id
  name     String
  joinedAt DateTime @default(now())

  sessions FocusSession[]
}

model User {
  id       String  @id
  username String
  avatar   String?

  ownedSessions  FocusSession[]     @relation("SessionOwner")
  participations FocusParticipant[]
}

model FocusSession {
  id           String        @id @default(cuid())
  guildId      String
  channelId    String
  ownerId      String
  durationMins Int
  status       SessionStatus @default(LOBBY)
  startedAt    DateTime?
  endedAt      DateTime?
  messageId    String        @default("")

  guild        Guild              @relation(fields: [guildId], references: [id], onDelete: Cascade)
  owner        User               @relation("SessionOwner", fields: [ownerId], references: [id])
  participants FocusParticipant[]

  @@index([guildId, status])
  @@index([channelId, status])
}

enum SessionStatus {
  LOBBY
  ACTIVE
  DONE
  CANCELLED
}

model FocusParticipant {
  id             String    @id @default(cuid())
  sessionId      String
  userId         String
  joinedAt       DateTime  @default(now())
  leftAt         DateTime?
  minutesFocused Int       @default(0)

  session FocusSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  user    User         @relation(fields: [userId], references: [id])

  @@unique([sessionId, userId])
  @@index([userId])
}
```

- [ ] **Step 3: Create `packages/db/src/index.ts`**

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export * from '@prisma/client';
```

- [ ] **Step 4: Start Docker, install deps, run migration**

```bash
docker compose up -d
cp .env.example .env
# Fill in DATABASE_URL=postgresql://yap:yap@localhost:5432/yap in .env
pnpm install
pnpm db:generate
pnpm db:migrate
# When prompted for migration name: initial
```

Expected: Migration applied, `prisma generate` completes with no errors.

- [ ] **Step 5: Verify schema applied**

```bash
docker exec -it $(docker ps -qf "name=postgres") psql -U yap -d yap -c "\dt"
```

Expected output includes: `FocusSession`, `FocusParticipant`, `Guild`, `User`

- [ ] **Step 6: Commit**

```bash
git add packages/
git commit -m "feat: prisma schema — Guild, User, FocusSession, FocusParticipant"
```

---

## Task 3: Bot package scaffold + env validation

**Files:**
- Create: `apps/bot/package.json`
- Create: `apps/bot/tsconfig.json`
- Create: `apps/bot/src/env.ts`

- [ ] **Step 1: Create `apps/bot/package.json`**

```json
{
  "name": "@yap/bot",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "dev": "node --env-file=../../.env --watch --loader ts-node/esm src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@yap/db": "workspace:*",
    "discord.js": "^14.16.3"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: Create `apps/bot/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/bot/src/env.ts`**

```typescript
import { z } from 'zod';

const schema = z.object({
  DISCORD_TOKEN:     z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  DATABASE_URL:      z.string().min(1, 'DATABASE_URL is required'),
  NODE_ENV:          z.enum(['development', 'production', 'test']).default('development'),
});

const result = schema.safeParse(process.env);

if (!result.success) {
  console.error('❌ Invalid environment variables:');
  console.error(result.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = result.data;
```

- [ ] **Step 4: Install bot deps**

```bash
pnpm install
```

Expected: No errors. `node_modules` populated under `apps/bot/`.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/
git commit -m "feat: bot package scaffold with env validation"
```

---

## Task 4: Break suggestions (TDD)

**Files:**
- Create: `apps/bot/src/focus/breaks.ts`
- Create: `apps/bot/src/focus/breaks.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/bot/src/focus/breaks.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getBreakSuggestion, VALID_DURATIONS } from './breaks.js';

describe('getBreakSuggestion', () => {
  it('returns 5 min break for 30 min session', () => {
    const result = getBreakSuggestion(30);
    expect(result).toContain('5');
  });

  it('returns 10 min break for 45 min session', () => {
    const result = getBreakSuggestion(45);
    expect(result).toContain('10');
  });

  it('returns 15 min break for 60 min session', () => {
    const result = getBreakSuggestion(60);
    expect(result).toContain('15');
  });

  it('returns 20 min break for 90 min session', () => {
    const result = getBreakSuggestion(90);
    expect(result).toContain('20');
  });

  it('returns 30 min break for 120 min session', () => {
    const result = getBreakSuggestion(120);
    expect(result).toContain('30');
  });

  it('returns a non-empty string for any valid duration', () => {
    VALID_DURATIONS.forEach(d => {
      expect(getBreakSuggestion(d).length).toBeGreaterThan(0);
    });
  });
});

describe('VALID_DURATIONS', () => {
  it('contains exactly 5 options', () => {
    expect(VALID_DURATIONS).toHaveLength(5);
  });

  it('contains 30, 45, 60, 90, 120', () => {
    expect(VALID_DURATIONS).toEqual(expect.arrayContaining([30, 45, 60, 90, 120]));
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd apps/bot && pnpm test -- breaks
```

Expected: FAIL with "Cannot find module './breaks.js'"

- [ ] **Step 3: Implement `breaks.ts`**

Create `apps/bot/src/focus/breaks.ts`:

```typescript
export const VALID_DURATIONS = [30, 45, 60, 90, 120] as const;
export type ValidDuration = (typeof VALID_DURATIONS)[number];

const BREAK_MAP: Record<ValidDuration, { breakMins: number; message: string }> = {
  30:  { breakMins: 5,  message: "30 minutes locked in — solid sprint. Take a 5-minute breather and come back." },
  45:  { breakMins: 10, message: "45 minutes focused. Rest your eyes for 10 minutes before the next one." },
  60:  { breakMins: 15, message: "A full hour of focus. Take a proper 15-minute break — touch some grass." },
  90:  { breakMins: 20, message: "90 minutes of deep work. That earns a 20-minute break, no guilt." },
  120: { breakMins: 30, message: "Two full hours. Take 30 minutes off — you've genuinely earned it." },
};

export function getBreakSuggestion(durationMins: number): string {
  const entry = BREAK_MAP[durationMins as ValidDuration];
  if (!entry) return 'Great session! Take a break before the next one.';
  return `${entry.message} (suggested break: ${entry.breakMins} min)`;
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd apps/bot && pnpm test -- breaks
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/focus/
git commit -m "feat: break suggestions with tests"
```

---

## Task 5: In-memory timer

**Files:**
- Create: `apps/bot/src/focus/timer.ts`

No tests — this is a side-effect wrapper around `setTimeout`. Tested implicitly via integration.

- [ ] **Step 1: Create `apps/bot/src/focus/timer.ts`**

```typescript
const timers = new Map<string, NodeJS.Timeout>();

export function scheduleSessionEnd(
  sessionId: string,
  delayMs: number,
  onEnd: () => Promise<void>,
): void {
  const existing = timers.get(sessionId);
  if (existing) clearTimeout(existing);

  const t = setTimeout(async () => {
    timers.delete(sessionId);
    await onEnd();
  }, delayMs);

  timers.set(sessionId, t);
}

export function cancelSessionTimer(sessionId: string): void {
  const t = timers.get(sessionId);
  if (t) {
    clearTimeout(t);
    timers.delete(sessionId);
  }
}

export function hasActiveTimer(sessionId: string): boolean {
  return timers.has(sessionId);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/bot/src/focus/timer.ts
git commit -m "feat: in-memory session timer"
```

---

## Task 6: Session DB operations (TDD)

**Files:**
- Create: `apps/bot/src/focus/session.ts`
- Create: `apps/bot/src/focus/session.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/bot/src/focus/session.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@yap/db';
import {
  createSession,
  getActiveSessionForChannel,
  startSession,
  endSession,
  cancelSession,
  setSessionMessageId,
} from './session.js';

const GUILD_ID = 'test-guild-1';
const CHANNEL_ID = 'test-channel-1';
const OWNER_ID = 'test-owner-1';

beforeEach(async () => {
  await prisma.focusParticipant.deleteMany({ where: { session: { guildId: GUILD_ID } } });
  await prisma.focusSession.deleteMany({ where: { guildId: GUILD_ID } });
  await prisma.user.deleteMany({ where: { id: OWNER_ID } });
  await prisma.guild.deleteMany({ where: { id: GUILD_ID } });

  await prisma.guild.create({ data: { id: GUILD_ID, name: 'Test Guild' } });
  await prisma.user.create({ data: { id: OWNER_ID, username: 'testowner' } });
});

describe('createSession', () => {
  it('creates a session with LOBBY status', async () => {
    const session = await createSession({
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      ownerId: OWNER_ID,
      durationMins: 60,
    });

    expect(session.status).toBe('LOBBY');
    expect(session.durationMins).toBe(60);
    expect(session.startedAt).toBeNull();
  });

  it('also joins the owner as a participant', async () => {
    const session = await createSession({
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      ownerId: OWNER_ID,
      durationMins: 60,
    });

    const participant = await prisma.focusParticipant.findUnique({
      where: { sessionId_userId: { sessionId: session.id, userId: OWNER_ID } },
    });
    expect(participant).not.toBeNull();
  });
});

describe('getActiveSessionForChannel', () => {
  it('returns null when no session exists', async () => {
    const result = await getActiveSessionForChannel(CHANNEL_ID);
    expect(result).toBeNull();
  });

  it('returns a LOBBY session', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    const result = await getActiveSessionForChannel(CHANNEL_ID);
    expect(result?.id).toBe(session.id);
  });

  it('returns an ACTIVE session', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    await startSession(session.id);
    const result = await getActiveSessionForChannel(CHANNEL_ID);
    expect(result?.status).toBe('ACTIVE');
  });

  it('returns null for a DONE session', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    await startSession(session.id);
    await endSession(session.id);
    const result = await getActiveSessionForChannel(CHANNEL_ID);
    expect(result).toBeNull();
  });
});

describe('startSession', () => {
  it('sets status to ACTIVE and records startedAt', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    const started = await startSession(session.id);
    expect(started.status).toBe('ACTIVE');
    expect(started.startedAt).not.toBeNull();
  });
});

describe('endSession', () => {
  it('sets status to DONE and records endedAt', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    await startSession(session.id);
    const ended = await endSession(session.id);
    expect(ended.status).toBe('DONE');
    expect(ended.endedAt).not.toBeNull();
  });
});

describe('cancelSession', () => {
  it('sets status to CANCELLED', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    const cancelled = await cancelSession(session.id);
    expect(cancelled.status).toBe('CANCELLED');
  });
});
```

- [ ] **Step 2: Run — verify fails**

```bash
cd apps/bot && pnpm test -- session
```

Expected: FAIL with "Cannot find module './session.js'"

- [ ] **Step 3: Implement `session.ts`**

Create `apps/bot/src/focus/session.ts`:

```typescript
import { prisma, SessionStatus } from '@yap/db';

interface CreateSessionInput {
  guildId: string;
  channelId: string;
  ownerId: string;
  durationMins: number;
}

export async function createSession(input: CreateSessionInput) {
  return prisma.focusSession.create({
    data: {
      guildId:      input.guildId,
      channelId:    input.channelId,
      ownerId:      input.ownerId,
      durationMins: input.durationMins,
      participants: {
        create: { userId: input.ownerId },
      },
    },
    include: { participants: true },
  });
}

export async function setSessionMessageId(sessionId: string, messageId: string) {
  return prisma.focusSession.update({
    where: { id: sessionId },
    data:  { messageId },
  });
}

export async function getActiveSessionForChannel(channelId: string) {
  return prisma.focusSession.findFirst({
    where: {
      channelId,
      status: { in: [SessionStatus.LOBBY, SessionStatus.ACTIVE] },
    },
    include: { participants: { include: { user: true } }, owner: true },
  });
}

export async function startSession(sessionId: string) {
  return prisma.focusSession.update({
    where: { id: sessionId },
    data:  { status: SessionStatus.ACTIVE, startedAt: new Date() },
  });
}

export async function endSession(sessionId: string) {
  return prisma.focusSession.update({
    where: { id: sessionId },
    data:  { status: SessionStatus.DONE, endedAt: new Date() },
  });
}

export async function cancelSession(sessionId: string) {
  return prisma.focusSession.update({
    where: { id: sessionId },
    data:  { status: SessionStatus.CANCELLED, endedAt: new Date() },
  });
}
```

- [ ] **Step 4: Run — verify passes**

```bash
cd apps/bot && pnpm test -- session
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/focus/session.ts apps/bot/src/focus/session.test.ts
git commit -m "feat: session DB operations with tests"
```

---

## Task 7: Participant DB operations (TDD)

**Files:**
- Create: `apps/bot/src/focus/participants.ts`
- Create: `apps/bot/src/focus/participants.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/bot/src/focus/participants.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@yap/db';
import { createSession, startSession } from './session.js';
import { joinSession, leaveSession, closeAllParticipants } from './participants.js';

const GUILD_ID = 'test-guild-p';
const CHANNEL_ID = 'test-channel-p';
const OWNER_ID = 'test-owner-p';
const USER_ID = 'test-user-p';

beforeEach(async () => {
  await prisma.focusParticipant.deleteMany({ where: { session: { guildId: GUILD_ID } } });
  await prisma.focusSession.deleteMany({ where: { guildId: GUILD_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [OWNER_ID, USER_ID] } } });
  await prisma.guild.deleteMany({ where: { id: GUILD_ID } });

  await prisma.guild.create({ data: { id: GUILD_ID, name: 'Test Guild' } });
  await prisma.user.create({ data: { id: OWNER_ID, username: 'owner' } });
  await prisma.user.create({ data: { id: USER_ID,  username: 'joiner' } });
});

describe('joinSession', () => {
  it('creates a participant row for the user', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    await joinSession(session.id, USER_ID);

    const p = await prisma.focusParticipant.findUnique({
      where: { sessionId_userId: { sessionId: session.id, userId: USER_ID } },
    });
    expect(p).not.toBeNull();
    expect(p?.leftAt).toBeNull();
  });

  it('is idempotent — joining twice does not throw', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    await joinSession(session.id, USER_ID);
    await expect(joinSession(session.id, USER_ID)).resolves.not.toThrow();
  });
});

describe('leaveSession', () => {
  it('sets leftAt and computes minutesFocused for an active session', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    await joinSession(session.id, USER_ID);
    const started = await startSession(session.id);

    // Simulate 10 minutes having passed by back-dating startedAt
    await prisma.focusSession.update({
      where: { id: session.id },
      data: { startedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    const p = await leaveSession(session.id, USER_ID);
    expect(p.leftAt).not.toBeNull();
    expect(p.minutesFocused).toBeGreaterThanOrEqual(10);
  });

  it('sets minutesFocused to 0 if session has not started', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    await joinSession(session.id, USER_ID);
    const p = await leaveSession(session.id, USER_ID);
    expect(p.minutesFocused).toBe(0);
  });
});

describe('closeAllParticipants', () => {
  it('sets leftAt on all participants still in session', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    await joinSession(session.id, USER_ID);
    await startSession(session.id);
    await prisma.focusSession.update({
      where: { id: session.id },
      data: { startedAt: new Date(Date.now() - 5 * 60 * 1000) },
    });

    await closeAllParticipants(session.id);

    const participants = await prisma.focusParticipant.findMany({
      where: { sessionId: session.id },
    });
    participants.forEach(p => {
      expect(p.leftAt).not.toBeNull();
      expect(p.minutesFocused).toBeGreaterThanOrEqual(0);
    });
  });
});
```

- [ ] **Step 2: Run — verify fails**

```bash
cd apps/bot && pnpm test -- participants
```

Expected: FAIL with "Cannot find module './participants.js'"

- [ ] **Step 3: Implement `participants.ts`**

Create `apps/bot/src/focus/participants.ts`:

```typescript
import { prisma } from '@yap/db';

export async function joinSession(sessionId: string, userId: string) {
  return prisma.focusParticipant.upsert({
    where:  { sessionId_userId: { sessionId, userId } },
    update: {},
    create: { sessionId, userId },
  });
}

export async function leaveSession(sessionId: string, userId: string) {
  const session = await prisma.focusSession.findUnique({
    where: { id: sessionId },
    select: { startedAt: true },
  });

  const now = new Date();
  const minutesFocused =
    session?.startedAt
      ? Math.floor((now.getTime() - session.startedAt.getTime()) / 60_000)
      : 0;

  return prisma.focusParticipant.update({
    where: { sessionId_userId: { sessionId, userId } },
    data:  { leftAt: now, minutesFocused },
  });
}

export async function closeAllParticipants(sessionId: string) {
  const session = await prisma.focusSession.findUnique({
    where: { id: sessionId },
    select: { startedAt: true },
  });

  const openParticipants = await prisma.focusParticipant.findMany({
    where: { sessionId, leftAt: null },
  });

  const now = new Date();

  await Promise.all(
    openParticipants.map(p => {
      const minutesFocused =
        session?.startedAt
          ? Math.floor((now.getTime() - session.startedAt.getTime()) / 60_000)
          : 0;
      return prisma.focusParticipant.update({
        where: { id: p.id },
        data:  { leftAt: now, minutesFocused },
      });
    }),
  );
}
```

- [ ] **Step 4: Run — verify passes**

```bash
cd apps/bot && pnpm test -- participants
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/focus/participants.ts apps/bot/src/focus/participants.test.ts
git commit -m "feat: participant join/leave DB operations with tests"
```

---

## Task 8: Leaderboard & mystats queries (TDD)

**Files:**
- Create: `apps/bot/src/focus/stats.ts`
- Create: `apps/bot/src/focus/stats.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/bot/src/focus/stats.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@yap/db';
import { getLeaderboard, getMyStats, TimeRange } from './stats.js';

const GUILD_ID = 'test-guild-s';
const USER_A = 'user-a';
const USER_B = 'user-b';

beforeEach(async () => {
  await prisma.focusParticipant.deleteMany({ where: { session: { guildId: GUILD_ID } } });
  await prisma.focusSession.deleteMany({ where: { guildId: GUILD_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } });
  await prisma.guild.deleteMany({ where: { id: GUILD_ID } });

  await prisma.guild.create({ data: { id: GUILD_ID, name: 'Test Guild' } });
  await prisma.user.create({ data: { id: USER_A, username: 'alice' } });
  await prisma.user.create({ data: { id: USER_B, username: 'bob' } });

  // Seed: alice has 120 total minutes across 2 sessions, bob has 45
  const s1 = await prisma.focusSession.create({
    data: {
      guildId: GUILD_ID, channelId: 'ch1', ownerId: USER_A,
      durationMins: 60, status: 'DONE',
      startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      endedAt:   new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
      messageId: 'msg1',
    },
  });
  const s2 = await prisma.focusSession.create({
    data: {
      guildId: GUILD_ID, channelId: 'ch1', ownerId: USER_A,
      durationMins: 60, status: 'DONE',
      startedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      endedAt:   new Date(Date.now() - 1 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
      messageId: 'msg2',
    },
  });
  const s3 = await prisma.focusSession.create({
    data: {
      guildId: GUILD_ID, channelId: 'ch1', ownerId: USER_B,
      durationMins: 45, status: 'DONE',
      startedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      endedAt:   new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000),
      messageId: 'msg3',
    },
  });

  await prisma.focusParticipant.createMany({
    data: [
      { sessionId: s1.id, userId: USER_A, minutesFocused: 60, leftAt: s1.endedAt },
      { sessionId: s2.id, userId: USER_A, minutesFocused: 60, leftAt: s2.endedAt },
      { sessionId: s3.id, userId: USER_B, minutesFocused: 45, leftAt: s3.endedAt },
    ],
  });
});

describe('getLeaderboard', () => {
  it('ranks users by total minutesFocused descending', async () => {
    const lb = await getLeaderboard(GUILD_ID, 'all-time');
    expect(lb[0].userId).toBe(USER_A);
    expect(lb[0].totalMinutes).toBe(120);
    expect(lb[1].userId).toBe(USER_B);
    expect(lb[1].totalMinutes).toBe(45);
  });

  it('limits results to top 10', async () => {
    const lb = await getLeaderboard(GUILD_ID, 'all-time');
    expect(lb.length).toBeLessThanOrEqual(10);
  });

  it('filters by this-week correctly', async () => {
    // USER_B session was 3 days ago, still within a week
    const lb = await getLeaderboard(GUILD_ID, 'this-week');
    const userB = lb.find(r => r.userId === USER_B);
    expect(userB?.totalMinutes).toBe(45);
  });
});

describe('getMyStats', () => {
  it('returns correct total minutes and session count for a user', async () => {
    const stats = await getMyStats(GUILD_ID, USER_A);
    expect(stats.totalMinutes).toBe(120);
    expect(stats.sessionCount).toBe(2);
  });

  it('returns zeros for a user with no sessions', async () => {
    const stats = await getMyStats(GUILD_ID, 'no-such-user');
    expect(stats.totalMinutes).toBe(0);
    expect(stats.sessionCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run — verify fails**

```bash
cd apps/bot && pnpm test -- stats
```

Expected: FAIL with "Cannot find module './stats.js'"

- [ ] **Step 3: Implement `stats.ts`**

Create `apps/bot/src/focus/stats.ts`:

```typescript
import { prisma } from '@yap/db';

export type TimeRange = 'all-time' | 'this-week' | 'this-month';

function getStartDate(range: TimeRange): Date | undefined {
  if (range === 'all-time') return undefined;
  const now = new Date();
  if (range === 'this-week') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function getLeaderboard(guildId: string, range: TimeRange) {
  const since = getStartDate(range);

  const rows = await prisma.focusParticipant.groupBy({
    by: ['userId'],
    where: {
      session: {
        guildId,
        status: 'DONE',
        ...(since ? { startedAt: { gte: since } } : {}),
      },
    },
    _sum:   { minutesFocused: true },
    _count: { sessionId: true },
    orderBy: { _sum: { minutesFocused: 'desc' } },
    take: 10,
  });

  const userIds = rows.map(r => r.userId);
  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
  const userMap = new Map(users.map(u => [u.id, u]));

  return rows.map(r => ({
    userId:       r.userId,
    username:     userMap.get(r.userId)?.username ?? 'Unknown',
    totalMinutes: r._sum.minutesFocused ?? 0,
    sessionCount: r._count.sessionId,
  }));
}

export async function getMyStats(guildId: string, userId: string) {
  const rows = await prisma.focusParticipant.aggregate({
    where: {
      userId,
      session: { guildId, status: 'DONE' },
    },
    _sum:   { minutesFocused: true },
    _count: { sessionId: true },
  });

  return {
    totalMinutes: rows._sum.minutesFocused ?? 0,
    sessionCount: rows._count.sessionId,
  };
}
```

- [ ] **Step 4: Run — verify passes**

```bash
cd apps/bot && pnpm test -- stats
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/focus/stats.ts apps/bot/src/focus/stats.test.ts
git commit -m "feat: leaderboard and mystats queries with tests"
```

---

## Task 9: Session embed builder

**Files:**
- Create: `apps/bot/src/focus/embed.ts`

No unit tests — embed construction is visual; tested manually when the bot runs.

- [ ] **Step 1: Create `apps/bot/src/focus/embed.ts`**

```typescript
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type APIEmbedField,
} from 'discord.js';
import type { FocusSession, FocusParticipant, User } from '@yap/db';

type SessionWithParticipants = FocusSession & {
  participants: (FocusParticipant & { user: User })[];
  owner: User;
};

export function buildSessionEmbed(session: SessionWithParticipants): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const isLobby  = session.status === 'LOBBY';
  const isActive = session.status === 'ACTIVE';

  const participantList = session.participants
    .filter(p => p.leftAt === null)
    .map(p => `<@${p.userId}>`)
    .join(' · ') || 'No participants yet';

  const endsAt = isActive && session.startedAt
    ? new Date(session.startedAt.getTime() + session.durationMins * 60_000)
    : null;

  const fields: APIEmbedField[] = [
    { name: 'Duration',     value: formatDuration(session.durationMins), inline: true },
    { name: 'Status',       value: isLobby ? '⏳ Waiting to start' : '🔥 In progress', inline: true },
    { name: `Participants (${session.participants.filter(p => !p.leftAt).length})`, value: participantList },
  ];

  if (endsAt) {
    fields.push({ name: 'Ends', value: `<t:${Math.floor(endsAt.getTime() / 1000)}:R>`, inline: true });
  }

  const embed = new EmbedBuilder()
    .setTitle('📚 Focus Session')
    .setColor(isActive ? 0xa8ff3e : 0x7c6af7)
    .addFields(fields)
    .setFooter({ text: `Session · ${session.id.slice(0, 8)}` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`focus_join_${session.id}`)
      .setLabel('Join Session')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isActive),
    new ButtonBuilder()
      .setCustomId(`focus_leave_${session.id}`)
      .setLabel('Leave')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`focus_start_${session.id}`)
      .setLabel('▶ Start')
      .setStyle(ButtonStyle.Success)
      .setDisabled(isActive),
    new ButtonBuilder()
      .setCustomId(`focus_end_${session.id}`)
      .setLabel('End Session')
      .setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row] };
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins} minutes`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h} hour${h > 1 ? 's' : ''}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/bot/src/focus/embed.ts
git commit -m "feat: session embed builder"
```

---

## Task 10: Discord client + guild handler

**Files:**
- Create: `apps/bot/src/client.ts`
- Create: `apps/bot/src/handlers/guild.ts`

- [ ] **Step 1: Create `apps/bot/src/client.ts`**

```typescript
import { Client, GatewayIntentBits, Partials } from 'discord.js';

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel],
  });
}
```

- [ ] **Step 2: Create `apps/bot/src/handlers/guild.ts`**

```typescript
import type { Guild } from 'discord.js';
import { prisma } from '@yap/db';

export async function onGuildCreate(guild: Guild): Promise<void> {
  await prisma.guild.upsert({
    where:  { id: guild.id },
    update: { name: guild.name },
    create: { id: guild.id, name: guild.name },
  });
  console.log(`Joined guild: ${guild.name} (${guild.id})`);
}

export async function onGuildDelete(guild: Guild): Promise<void> {
  await prisma.guild.deleteMany({ where: { id: guild.id } });
  console.log(`Left guild: ${guild.name} (${guild.id})`);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/bot/src/client.ts apps/bot/src/handlers/guild.ts
git commit -m "feat: discord client and guild lifecycle handlers"
```

---

## Task 11: Slash commands — /focus, /leaderboard, /mystats

**Files:**
- Create: `apps/bot/src/commands/focus.ts`
- Create: `apps/bot/src/commands/leaderboard.ts`
- Create: `apps/bot/src/commands/mystats.ts`
- Create: `apps/bot/src/commands/index.ts`

- [ ] **Step 1: Create `apps/bot/src/commands/focus.ts`**

```typescript
import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
} from 'discord.js';
import { VALID_DURATIONS } from '../focus/breaks.js';
import { getActiveSessionForChannel, createSession, setSessionMessageId } from '../focus/session.js';
import { buildSessionEmbed } from '../focus/embed.js';
import { prisma } from '@yap/db';

export const focusCommand = new SlashCommandBuilder()
  .setName('focus')
  .setDescription('Start a group focus session')
  .addIntegerOption(opt =>
    opt
      .setName('duration')
      .setDescription('How long to focus (minutes)')
      .setRequired(true)
      .addChoices(
        { name: '30 minutes',  value: 30  },
        { name: '45 minutes',  value: 45  },
        { name: '60 minutes',  value: 60  },
        { name: '90 minutes',  value: 90  },
        { name: '2 hours',     value: 120 },
      ),
  );

export async function handleFocusCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId || !interaction.channelId) {
    await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    return;
  }

  const existing = await getActiveSessionForChannel(interaction.channelId);
  if (existing) {
    await interaction.reply({
      content: 'There is already an active session in this channel. End it before starting a new one.',
      ephemeral: true,
    });
    return;
  }

  const durationMins = interaction.options.getInteger('duration', true);

  await prisma.guild.upsert({
    where:  { id: interaction.guildId },
    update: { name: interaction.guild?.name ?? 'Unknown' },
    create: { id: interaction.guildId, name: interaction.guild?.name ?? 'Unknown' },
  });

  await prisma.user.upsert({
    where:  { id: interaction.user.id },
    update: { username: interaction.user.username, avatar: interaction.user.avatar },
    create: { id: interaction.user.id, username: interaction.user.username, avatar: interaction.user.avatar },
  });

  const session = await createSession({
    guildId:      interaction.guildId,
    channelId:    interaction.channelId,
    ownerId:      interaction.user.id,
    durationMins,
  });

  const fullSession = await import('@yap/db').then(({ prisma }) =>
    prisma.focusSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { participants: { include: { user: true } }, owner: true },
    }),
  );

  const { embeds, components } = buildSessionEmbed(fullSession);
  const message = await interaction.reply({ embeds, components, fetchReply: true });
  await setSessionMessageId(session.id, message.id);
}
```

- [ ] **Step 2: Create `apps/bot/src/commands/leaderboard.ts`**

```typescript
import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getLeaderboard, type TimeRange } from '../focus/stats.js';

export const leaderboardCommand = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('See the focus time leaderboard')
  .addStringOption(opt =>
    opt
      .setName('range')
      .setDescription('Time range')
      .setRequired(false)
      .addChoices(
        { name: 'All time',   value: 'all-time'   },
        { name: 'This week',  value: 'this-week'  },
        { name: 'This month', value: 'this-month' },
      ),
  );

export async function handleLeaderboardCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    return;
  }

  const range = (interaction.options.getString('range') ?? 'all-time') as TimeRange;
  const rows  = await getLeaderboard(interaction.guildId, range);

  const rangeLabel: Record<TimeRange, string> = {
    'all-time':   'All Time',
    'this-week':  'This Week',
    'this-month': 'This Month',
  };

  const description = rows.length === 0
    ? 'No focus sessions recorded yet. Start one with `/focus`!'
    : rows.map((r, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        const time  = r.totalMinutes >= 60
          ? `${Math.floor(r.totalMinutes / 60)}h ${r.totalMinutes % 60}m`
          : `${r.totalMinutes}m`;
        return `${medal} <@${r.userId}> — **${time}** (${r.sessionCount} sessions)`;
      }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`📊 Focus Leaderboard — ${rangeLabel[range]}`)
    .setDescription(description)
    .setColor(0xa8ff3e);

  await interaction.reply({ embeds: [embed] });
}
```

- [ ] **Step 3: Create `apps/bot/src/commands/mystats.ts`**

```typescript
import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getMyStats } from '../focus/stats.js';

export const mystatsCommand = new SlashCommandBuilder()
  .setName('mystats')
  .setDescription('See your own focus stats');

export async function handleMystatsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    return;
  }

  const stats = await getMyStats(interaction.guildId, interaction.user.id);

  const timeStr = stats.totalMinutes >= 60
    ? `${Math.floor(stats.totalMinutes / 60)}h ${stats.totalMinutes % 60}m`
    : `${stats.totalMinutes} minutes`;

  const embed = new EmbedBuilder()
    .setTitle('Your Focus Stats')
    .setDescription(
      stats.sessionCount === 0
        ? "You haven't completed a focus session yet. Start one with `/focus`!"
        : `You've focused for **${timeStr}** across **${stats.sessionCount} sessions**.`,
    )
    .setColor(0x7c6af7);

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
```

- [ ] **Step 4: Create `apps/bot/src/commands/index.ts`**

```typescript
import { REST, Routes } from 'discord.js';
import { env } from '../env.js';
import { focusCommand } from './focus.js';
import { leaderboardCommand } from './leaderboard.js';
import { mystatsCommand } from './mystats.js';

export const commands = [focusCommand, leaderboardCommand, mystatsCommand];

export async function registerCommands(): Promise<void> {
  const rest = new REST().setToken(env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), {
    body: commands.map(c => c.toJSON()),
  });
  console.log('Slash commands registered.');
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/commands/
git commit -m "feat: /focus, /leaderboard, /mystats slash commands"
```

---

## Task 12: Button interaction handler

**Files:**
- Create: `apps/bot/src/handlers/interactions.ts`

- [ ] **Step 1: Create `apps/bot/src/handlers/interactions.ts`**

```typescript
import type { ButtonInteraction, Client } from 'discord.js';
import { prisma } from '@yap/db';
import { getActiveSessionForChannel, startSession, endSession, cancelSession } from '../focus/session.js';
import { joinSession, leaveSession, closeAllParticipants } from '../focus/participants.js';
import { buildSessionEmbed } from '../focus/embed.js';
import { getBreakSuggestion } from '../focus/breaks.js';
import { scheduleSessionEnd, cancelSessionTimer } from '../focus/timer.js';

export async function handleButtonInteraction(interaction: ButtonInteraction, client: Client): Promise<void> {
  const { customId } = interaction;

  if (!customId.startsWith('focus_')) return;

  const [, action, sessionId] = customId.split('_');
  if (!sessionId) return;

  const session = await prisma.focusSession.findUnique({
    where: { id: sessionId },
    include: { participants: { include: { user: true } }, owner: true },
  });

  if (!session) {
    await interaction.reply({ content: 'This session no longer exists.', ephemeral: true });
    return;
  }

  if (session.status === 'DONE' || session.status === 'CANCELLED') {
    await interaction.reply({ content: 'This session has already ended.', ephemeral: true });
    return;
  }

  await prisma.user.upsert({
    where:  { id: interaction.user.id },
    update: { username: interaction.user.username, avatar: interaction.user.avatar },
    create: { id: interaction.user.id, username: interaction.user.username, avatar: interaction.user.avatar },
  });

  if (action === 'join') {
    if (session.status === 'ACTIVE') {
      await interaction.reply({ content: 'The session has already started — you cannot join now.', ephemeral: true });
      return;
    }
    await joinSession(sessionId, interaction.user.id);

  } else if (action === 'leave') {
    if (session.ownerId === interaction.user.id) {
      // Owner leaving cancels the session
      cancelSessionTimer(sessionId);
      await closeAllParticipants(sessionId);
      await cancelSession(sessionId);
      await interaction.update({ content: `Session ended — <@${interaction.user.id}> (the owner) left.`, embeds: [], components: [] });
      return;
    }
    await leaveSession(sessionId, interaction.user.id);

  } else if (action === 'start') {
    if (session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'Only the session owner can start it.', ephemeral: true });
      return;
    }
    if (session.status === 'ACTIVE') {
      await interaction.reply({ content: 'Session is already running.', ephemeral: true });
      return;
    }
    await startSession(sessionId);
    scheduleSessionEnd(sessionId, session.durationMins * 60_000, async () => {
      await closeAllParticipants(sessionId);
      await endSession(sessionId);
      const ch = await client.channels.fetch(session.channelId).catch(() => null);
      if (ch?.isTextBased()) {
        await ch.send(getBreakSuggestion(session.durationMins));
      }
      // Update embed to show session is done
      const msg = await ch?.isTextBased()
        ? await (ch as any).messages.fetch(session.messageId).catch(() => null)
        : null;
      if (msg) await msg.edit({ content: '✅ Session complete!', embeds: [], components: [] });
    });

  } else if (action === 'end') {
    if (session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'Only the session owner can end it.', ephemeral: true });
      return;
    }
    cancelSessionTimer(sessionId);
    await closeAllParticipants(sessionId);
    await endSession(sessionId);
    await interaction.update({ content: '✅ Session ended early.', embeds: [], components: [] });
    return;

  } else {
    return;
  }

  // Refresh embed after join/leave/start
  const updated = await prisma.focusSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { participants: { include: { user: true } }, owner: true },
  });
  const { embeds, components } = buildSessionEmbed(updated);
  await interaction.update({ embeds, components });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/bot/src/handlers/interactions.ts
git commit -m "feat: button interaction handler for focus sessions"
```

---

## Task 13: Bot restart recovery

**Files:**
- Create: `apps/bot/src/recovery.ts`

- [ ] **Step 1: Create `apps/bot/src/recovery.ts`**

```typescript
import type { Client } from 'discord.js';
import { prisma, SessionStatus } from '@yap/db';
import { closeAllParticipants } from './focus/participants.js';
import { endSession, cancelSession } from './focus/session.js';
import { scheduleSessionEnd } from './focus/timer.js';
import { getBreakSuggestion } from './focus/breaks.js';

export async function reconcileActiveSessions(client: Client): Promise<void> {
  const activeSessions = await prisma.focusSession.findMany({
    where: { status: SessionStatus.ACTIVE },
  });

  console.log(`Reconciling ${activeSessions.length} active session(s) on startup...`);

  for (const session of activeSessions) {
    if (!session.startedAt) continue;

    const endsAt  = new Date(session.startedAt.getTime() + session.durationMins * 60_000);
    const remaining = endsAt.getTime() - Date.now();

    if (remaining <= 0) {
      // Timer already expired while bot was offline — close it now
      await closeAllParticipants(session.id);
      await endSession(session.id);
      console.log(`Closed expired session ${session.id}`);
    } else {
      // Restart the timer for the remaining duration
      scheduleSessionEnd(session.id, remaining, async () => {
        await closeAllParticipants(session.id);
        await endSession(session.id);
        const ch = await client.channels.fetch(session.channelId).catch(() => null);
        if (ch?.isTextBased()) {
          await ch.send(getBreakSuggestion(session.durationMins));
        }
      });
      console.log(`Rescheduled session ${session.id} — ${Math.round(remaining / 60_000)} min remaining`);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/bot/src/recovery.ts
git commit -m "feat: bot restart recovery for active sessions"
```

---

## Task 14: Wire everything together — entry point

**Files:**
- Create: `apps/bot/src/index.ts`

- [ ] **Step 1: Create `apps/bot/src/index.ts`**

```typescript
import { Events } from 'discord.js';
import { createClient } from './client.js';
import { env } from './env.js';
import { registerCommands, commands } from './commands/index.js';
import { onGuildCreate, onGuildDelete } from './handlers/guild.js';
import { handleButtonInteraction } from './handlers/interactions.js';
import { handleFocusCommand } from './commands/focus.js';
import { handleLeaderboardCommand } from './commands/leaderboard.js';
import { handleMystatsCommand } from './commands/mystats.js';
import { reconcileActiveSessions } from './recovery.js';

const client = createClient();

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  await registerCommands();
  await reconcileActiveSessions(c);
});

client.on(Events.GuildCreate, onGuildCreate);
client.on(Events.GuildDelete, onGuildDelete);

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'focus')       return handleFocusCommand(interaction);
    if (interaction.commandName === 'leaderboard') return handleLeaderboardCommand(interaction);
    if (interaction.commandName === 'mystats')     return handleMystatsCommand(interaction);
  }

  if (interaction.isButton()) {
    return handleButtonInteraction(interaction, client);
  }
});

client.login(env.DISCORD_TOKEN);
```

- [ ] **Step 2: Fill in .env with real values**

```
DISCORD_TOKEN=<your bot token>
DISCORD_CLIENT_ID=<your application client id>
DATABASE_URL=postgresql://yap:yap@localhost:5432/yap
NODE_ENV=development
```

- [ ] **Step 3: Start the bot and verify it connects**

```bash
pnpm dev:bot
```

Expected output:
```
Logged in as YapBot#1234
Slash commands registered.
Reconciling 0 active session(s) on startup...
```

- [ ] **Step 4: Test in Discord**
  - Run `/focus` → select 30 minutes → verify embed appears with Join/Start/End buttons
  - Click **Join** as another user → verify participant list updates
  - Click **Start** as owner → verify embed shows "In progress" + ends at time
  - Let timer run out → verify break message appears in channel
  - Run `/leaderboard` → verify it shows completed session times
  - Run `/mystats` → verify your own stats are correct

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/index.ts
git commit -m "feat: wire bot entry point — focus mode complete"
```

---

## Oracle Cloud Deployment Notes

When ready to deploy to your Oracle Cloud VM:

1. **PostgreSQL**: Use a managed external database (Railway, Neon, or Supabase free tier). Don't run Postgres on the same VM in production — Oracle VMs restart.

2. **Install PM2** on the VM:
   ```bash
   npm install -g pm2
   ```

3. **Run the bot**:
   ```bash
   pnpm build:bot
   pm2 start apps/bot/dist/index.js --name yap-bot
   pm2 save
   pm2 startup   # follow the printed command to auto-start on reboot
   ```

4. **Environment on the VM**: Create `/etc/environment` or use a `.env` file. Make sure `DATABASE_URL` points to your external Postgres.

5. **Migrate DB before first run**:
   ```bash
   DATABASE_URL=<your-prod-url> pnpm db:migrate
   ```
