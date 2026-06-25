# Cam-On Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn users in a text channel if they've been in a cam-required voice channel for 8 minutes without their camera on (and aren't screen-sharing).

**Architecture:** A `voiceStateUpdate` event handler maintains an in-memory Map of pending warning timers keyed by userId. When a user joins a cam-required channel without camera or stream, an 8-minute timer is scheduled. The timer is cancelled if the user turns on camera, starts streaming, or leaves before 8 minutes. On fire, the bot checks the user's current voice state one more time before posting the warning.

**Tech Stack:** discord.js v14 (`VoiceState`, `GatewayIntentBits.GuildVoiceStates`), Node.js in-memory Map, TypeScript ESM

---

## Config

```
CAM_REQUIRED_CHANNELS = ['1506364304486830163', '1506430267735277598']
WARNING_CHANNEL_ID    = '1519444487259164926'
GRACE_PERIOD_MS       = 8 * 60 * 1000   (8 minutes)
```

---

## File Map

```
apps/bot/src/
├── handlers/
│   └── voiceState.ts        ← NEW: schedules/cancels cam warning timers, posts warning
├── client.ts                ← MODIFY: add GuildVoiceStates intent
└── index.ts                 ← MODIFY: register voiceStateUpdate event
```

---

## Task 1: Add GuildVoiceStates intent to the Discord client

**Files:**
- Modify: `apps/bot/src/client.ts`

The bot needs the `GuildVoiceStates` intent to receive voice state events. Without it, `voiceStateUpdate` never fires.

- [ ] **Step 1: Edit `apps/bot/src/client.ts`**

Current content:
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

Replace with:
```typescript
import { Client, GatewayIntentBits, Partials } from 'discord.js';

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Message, Partials.Channel],
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main/apps/bot && npx tsc --noEmit 2>&1 | head -10
```

Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main && git add apps/bot/src/client.ts && git commit -m "feat: add GuildVoiceStates intent for cam warning"
```

---

## Task 2: Voice state handler — cam warning timer logic (TDD)

**Files:**
- Create: `apps/bot/src/handlers/voiceState.ts`
- Create: `apps/bot/src/handlers/voiceState.test.ts`

This file owns the in-memory timer Map and all the logic for deciding when to schedule/cancel a warning. The Discord API call (posting to the warning channel) is injected as a callback so it can be tested without a real Discord client.

- [ ] **Step 1: Write failing tests**

Create `apps/bot/src/handlers/voiceState.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleVoiceStateUpdate,
  cancelCamWarning,
  hasPendingCamWarning,
} from './voiceState.js';

// Fake VoiceState shape — only the fields our handler reads
function makeState(opts: {
  userId: string;
  channelId: string | null;
  selfVideo: boolean;
  streaming: boolean;
}): any {
  return {
    member: { id: opts.userId },
    channelId: opts.channelId,
    selfVideo: opts.selfVideo,
    streaming: opts.streaming,
  };
}

const CAM_CHANNEL = '1506364304486830163';
const OTHER_CHANNEL = '9999999999999999999';
const USER = 'user-123';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cancelCamWarning(USER);
  vi.useRealTimers();
});

describe('handleVoiceStateUpdate', () => {
  it('schedules a warning when user joins cam-required channel without camera', async () => {
    const warn = vi.fn();
    const old = makeState({ userId: USER, channelId: null,        selfVideo: false, streaming: false });
    const next = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: false, streaming: false });

    await handleVoiceStateUpdate(old, next, warn);
    expect(hasPendingCamWarning(USER)).toBe(true);
  });

  it('does NOT schedule when user is streaming', async () => {
    const warn = vi.fn();
    const old = makeState({ userId: USER, channelId: null,        selfVideo: false, streaming: false });
    const next = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: false, streaming: true });

    await handleVoiceStateUpdate(old, next, warn);
    expect(hasPendingCamWarning(USER)).toBe(false);
  });

  it('does NOT schedule when user has camera on', async () => {
    const warn = vi.fn();
    const old = makeState({ userId: USER, channelId: null,        selfVideo: false, streaming: false });
    const next = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: true,  streaming: false });

    await handleVoiceStateUpdate(old, next, warn);
    expect(hasPendingCamWarning(USER)).toBe(false);
  });

  it('cancels pending warning when user turns camera on', async () => {
    const warn = vi.fn();
    const join  = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: false, streaming: false });
    const camOn = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: true,  streaming: false });

    await handleVoiceStateUpdate(makeState({ userId: USER, channelId: null, selfVideo: false, streaming: false }), join, warn);
    expect(hasPendingCamWarning(USER)).toBe(true);

    await handleVoiceStateUpdate(join, camOn, warn);
    expect(hasPendingCamWarning(USER)).toBe(false);
  });

  it('cancels pending warning when user starts streaming', async () => {
    const warn = vi.fn();
    const join      = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: false, streaming: false });
    const streaming = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: false, streaming: true });

    await handleVoiceStateUpdate(makeState({ userId: USER, channelId: null, selfVideo: false, streaming: false }), join, warn);
    await handleVoiceStateUpdate(join, streaming, warn);
    expect(hasPendingCamWarning(USER)).toBe(false);
  });

  it('cancels pending warning when user leaves the channel', async () => {
    const warn = vi.fn();
    const join  = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: false, streaming: false });
    const leave = makeState({ userId: USER, channelId: null,         selfVideo: false, streaming: false });

    await handleVoiceStateUpdate(makeState({ userId: USER, channelId: null, selfVideo: false, streaming: false }), join, warn);
    await handleVoiceStateUpdate(join, leave, warn);
    expect(hasPendingCamWarning(USER)).toBe(false);
  });

  it('fires the warn callback after 8 minutes', async () => {
    const warn = vi.fn();
    const old  = makeState({ userId: USER, channelId: null,        selfVideo: false, streaming: false });
    const next = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: false, streaming: false });

    await handleVoiceStateUpdate(old, next, warn);
    expect(warn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(8 * 60 * 1000);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(USER, CAM_CHANNEL);
  });

  it('does NOT fire warn callback if camera turned on before 8 minutes', async () => {
    const warn  = vi.fn();
    const join  = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: false, streaming: false });
    const camOn = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: true,  streaming: false });

    await handleVoiceStateUpdate(makeState({ userId: USER, channelId: null, selfVideo: false, streaming: false }), join, warn);
    vi.advanceTimersByTime(5 * 60 * 1000);
    await handleVoiceStateUpdate(join, camOn, warn);
    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(warn).not.toHaveBeenCalled();
  });

  it('does NOT schedule for a non-cam-required channel', async () => {
    const warn = vi.fn();
    const old  = makeState({ userId: USER, channelId: null,         selfVideo: false, streaming: false });
    const next = makeState({ userId: USER, channelId: OTHER_CHANNEL, selfVideo: false, streaming: false });

    await handleVoiceStateUpdate(old, next, warn);
    expect(hasPendingCamWarning(USER)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main/apps/bot && DATABASE_URL=postgresql://yap:yap@localhost:5432/yap pnpm test -- voiceState
```

Expected: FAIL with "Cannot find module './voiceState.js'"

- [ ] **Step 3: Implement `apps/bot/src/handlers/voiceState.ts`**

```typescript
import type { VoiceState } from 'discord.js';

const CAM_REQUIRED_CHANNELS = new Set([
  '1506364304486830163',
  '1506430267735277598',
]);

export const WARNING_CHANNEL_ID = '1519444487259164926';
export const GRACE_PERIOD_MS    = 8 * 60 * 1000;

const pendingWarnings = new Map<string, NodeJS.Timeout>();

export type WarnFn = (userId: string, channelId: string) => void;

export function hasPendingCamWarning(userId: string): boolean {
  return pendingWarnings.has(userId);
}

export function cancelCamWarning(userId: string): void {
  const t = pendingWarnings.get(userId);
  if (t) {
    clearTimeout(t);
    pendingWarnings.delete(userId);
  }
}

function scheduleCamWarning(userId: string, channelId: string, warn: WarnFn): void {
  cancelCamWarning(userId);
  const t = setTimeout(() => {
    pendingWarnings.delete(userId);
    warn(userId, channelId);
  }, GRACE_PERIOD_MS);
  pendingWarnings.set(userId, t);
}

function needsCamera(state: Pick<VoiceState, 'channelId' | 'selfVideo' | 'streaming'>): boolean {
  return (
    state.channelId !== null &&
    CAM_REQUIRED_CHANNELS.has(state.channelId) &&
    !state.selfVideo &&
    !state.streaming
  );
}

function isClear(state: Pick<VoiceState, 'channelId' | 'selfVideo' | 'streaming'>): boolean {
  return (
    state.channelId === null ||
    !CAM_REQUIRED_CHANNELS.has(state.channelId) ||
    state.selfVideo ||
    state.streaming
  );
}

export async function handleVoiceStateUpdate(
  oldState: Pick<VoiceState, 'channelId' | 'selfVideo' | 'streaming'> & { member: { id: string } | null },
  newState: Pick<VoiceState, 'channelId' | 'selfVideo' | 'streaming'> & { member: { id: string } | null },
  warn: WarnFn,
): Promise<void> {
  const userId = newState.member?.id ?? oldState.member?.id;
  if (!userId) return;

  if (needsCamera(newState)) {
    scheduleCamWarning(userId, newState.channelId!, warn);
  } else if (isClear(newState)) {
    cancelCamWarning(userId);
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main/apps/bot && DATABASE_URL=postgresql://yap:yap@localhost:5432/yap pnpm test -- voiceState
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main && git add apps/bot/src/handlers/voiceState.ts apps/bot/src/handlers/voiceState.test.ts && git commit -m "feat: cam-on warning handler with 8-minute grace period"
```

---

## Task 3: Wire voiceStateUpdate into the bot entry point

**Files:**
- Modify: `apps/bot/src/index.ts`

This wires the Discord `voiceStateUpdate` event to the handler. The `warn` callback is defined here, where we have access to the Discord `client` to fetch and send to the warning channel.

- [ ] **Step 1: Edit `apps/bot/src/index.ts`**

Add these two imports after the existing import block:

```typescript
import { handleVoiceStateUpdate, WARNING_CHANNEL_ID } from './handlers/voiceState.js';
import { TextChannel } from 'discord.js';
```

Then add this event listener after the `GuildDelete` line:

```typescript
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  await handleVoiceStateUpdate(oldState, newState, async (userId, channelId) => {
    try {
      const ch = await client.channels.fetch(WARNING_CHANNEL_ID).catch(() => null);
      if (ch instanceof TextChannel) {
        await ch.send(
          `Hey <@${userId}>, you've been in <#${channelId}> for 8 minutes — please turn on your camera! 📸`,
        );
      }
    } catch (err) {
      console.error('Failed to send cam warning:', err);
    }
  });
});
```

- [ ] **Step 2: Verify full file looks correct**

The full `apps/bot/src/index.ts` after edits:

```typescript
import { Events, TextChannel } from 'discord.js';
import { createClient } from './client.js';
import { env } from './env.js';
import { registerCommands } from './commands/index.js';
import { onGuildCreate, onGuildDelete } from './handlers/guild.js';
import { handleButtonInteraction } from './handlers/interactions.js';
import { handleFocusCommand } from './commands/focus.js';
import { handleLeaderboardCommand } from './commands/leaderboard.js';
import { handleMystatsCommand } from './commands/mystats.js';
import { reconcileActiveSessions } from './recovery.js';
import { handleVoiceStateUpdate, WARNING_CHANNEL_ID } from './handlers/voiceState.js';

const client = createClient();

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  await registerCommands();
  await reconcileActiveSessions(c);
});

client.on(Events.GuildCreate, onGuildCreate);
client.on(Events.GuildDelete, onGuildDelete);

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  await handleVoiceStateUpdate(oldState, newState, async (userId, channelId) => {
    try {
      const ch = await client.channels.fetch(WARNING_CHANNEL_ID).catch(() => null);
      if (ch instanceof TextChannel) {
        await ch.send(
          `Hey <@${userId}>, you've been in <#${channelId}> for 8 minutes — please turn on your camera! 📸`,
        );
      }
    } catch (err) {
      console.error('Failed to send cam warning:', err);
    }
  });
});

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

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main/apps/bot && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main && git add apps/bot/src/index.ts && git commit -m "feat: wire cam-on warning to voiceStateUpdate event"
```

---

## Manual test checklist (after bot is running)

- Join one of the cam-required channels (`1506364304486830163` or `1506430267735277598`) **without** camera on → wait 8 minutes → verify warning appears in `1519444487259164926`
- Join without camera → turn camera on within 8 minutes → verify no warning is sent
- Join without camera → start screen-sharing → verify no warning is sent
- Join without camera → leave within 8 minutes → verify no warning is sent
- Join a different voice channel (not in the cam-required list) → wait 8+ minutes → verify no warning is sent
