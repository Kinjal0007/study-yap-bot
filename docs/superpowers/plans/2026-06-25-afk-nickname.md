# AFK Nickname Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a focus session starts, prepend `[AFK] ` to every participant's nickname; restore the exact original nickname when they leave or the session ends.

**Architecture:** A new `nickname.ts` module handles the pure logic (building the AFK string, truncating to Discord's 32-char limit). The original nickname is stored in a new `originalNickname` column on `FocusParticipant` so it survives bot restarts and truncation. `interactions.ts` calls apply/restore at the four lifecycle points: session start, individual leave, owner cancel, owner end + timer.

**Tech Stack:** discord.js v14 `GuildMember.setNickname`, Prisma migration, TypeScript ESM, vitest

---

## Nickname rules

```
prefix   = "[AFK] "          →  6 chars
max nick = 32 chars (Discord limit)
max name = 32 - 6 = 26 chars

user has nickname  → store it, display "[AFK] " + nick.slice(0, 26)
user has no nick   → store "" (empty string sentinel), display "[AFK] " + username.slice(0, 26)
guild owner        → skip silently (Discord blocks bots from changing owner nick)

on restore:
  originalNickname === ""    → setNickname(null)   (remove the bot-set nick)
  originalNickname === "foo" → setNickname("foo")
  originalNickname === null  → skip (never stored — old record)
```

---

## File Map

```
packages/db/prisma/
└── schema.prisma              MODIFY — add originalNickname to FocusParticipant

apps/bot/src/focus/
├── nickname.ts                CREATE — buildAFKNickname(), applyAFKNickname(), restoreNickname()
└── nickname.test.ts           CREATE — tests for pure nickname logic

apps/bot/src/handlers/
└── interactions.ts            MODIFY — wire apply on start; restore on leave/end/cancel/timer
```

---

## Task 1: Add `originalNickname` to the database schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Edit `packages/db/prisma/schema.prisma`**

Find the `FocusParticipant` model and add one field:

```prisma
model FocusParticipant {
  id             String    @id @default(cuid())
  sessionId      String
  userId         String
  joinedAt       DateTime  @default(now())
  leftAt         DateTime?
  minutesFocused Int       @default(0)
  originalNickname String?

  session FocusSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  user    User         @relation(fields: [userId], references: [id])

  @@unique([sessionId, userId])
  @@index([userId])
}
```

- [ ] **Step 2: Run migration**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main && DATABASE_URL=postgresql://yap:yap@localhost:5432/yap pnpm --filter @yap/db db:migrate
```

When prompted for a migration name, enter: `add_original_nickname`

Expected output:
```
✔ Enter a name for the new migration: add_original_nickname
Applying migration `..._add_original_nickname`
Your database is now in sync with your schema.
Generated Prisma Client
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main/apps/bot && npx tsc --noEmit 2>&1 | head -10
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main && git add packages/db/prisma/ packages/db/src/ && git commit -m "feat: add originalNickname field to FocusParticipant"
```

---

## Task 2: Implement `nickname.ts` with TDD

**Files:**
- Create: `apps/bot/src/focus/nickname.ts`
- Create: `apps/bot/src/focus/nickname.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/bot/src/focus/nickname.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildAFKNickname } from './nickname.js';

describe('buildAFKNickname', () => {
  it('prepends [AFK] to a short name', () => {
    expect(buildAFKNickname('Kinjal')).toBe('[AFK] Kinjal');
  });

  it('truncates to exactly 32 chars when base name is long', () => {
    const result = buildAFKNickname('A'.repeat(40));
    expect(result).toBe('[AFK] ' + 'A'.repeat(26));
    expect(result.length).toBe(32);
  });

  it('does not truncate a 26-char name', () => {
    const name = 'B'.repeat(26);
    expect(buildAFKNickname(name)).toBe('[AFK] ' + name);
    expect(buildAFKNickname(name).length).toBe(32);
  });

  it('handles a 27-char name by trimming one character', () => {
    const name = 'C'.repeat(27);
    expect(buildAFKNickname(name)).toBe('[AFK] ' + 'C'.repeat(26));
  });

  it('handles an empty string base name', () => {
    expect(buildAFKNickname('')).toBe('[AFK] ');
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main/apps/bot && DATABASE_URL=postgresql://yap:yap@localhost:5432/yap pnpm test -- nickname 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module './nickname.js'"

- [ ] **Step 3: Implement `apps/bot/src/focus/nickname.ts`**

```typescript
import type { GuildMember } from 'discord.js';
import { prisma } from '@yap/db';

const PREFIX  = '[AFK] ';
const MAX_LEN = 32;
const MAX_BASE = MAX_LEN - PREFIX.length; // 26

export function buildAFKNickname(baseName: string): string {
  return PREFIX + baseName.slice(0, MAX_BASE);
}

export async function applyAFKNickname(
  member: GuildMember,
  sessionId: string,
): Promise<void> {
  if (member.id === member.guild.ownerId) return;

  const original = member.nickname;
  const baseName = original ?? member.user.username;

  await prisma.focusParticipant.update({
    where: { sessionId_userId: { sessionId, userId: member.id } },
    data:  { originalNickname: original ?? '' },
  });

  await member.setNickname(buildAFKNickname(baseName)).catch(() => {});
}

export async function restoreNickname(
  member: GuildMember,
  originalNickname: string | null,
): Promise<void> {
  if (member.id === member.guild.ownerId) return;
  if (originalNickname === null) return;

  const restoreTo = originalNickname === '' ? null : originalNickname;
  await member.setNickname(restoreTo).catch(() => {});
}
```

- [ ] **Step 4: Run — verify PASS**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main/apps/bot && DATABASE_URL=postgresql://yap:yap@localhost:5432/yap pnpm test -- nickname 2>&1 | tail -10
```

Expected: 5 tests PASS.

- [ ] **Step 5: Verify TypeScript**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main/apps/bot && npx tsc --noEmit 2>&1 | head -10
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main && git add apps/bot/src/focus/nickname.ts apps/bot/src/focus/nickname.test.ts && git commit -m "feat: AFK nickname builder with truncation logic"
```

---

## Task 3: Wire nickname into `interactions.ts`

**Files:**
- Modify: `apps/bot/src/handlers/interactions.ts`

There are four lifecycle points where nicknames must change. Read the current file at `apps/bot/src/handlers/interactions.ts` before editing — the line numbers below are approximate.

**Current file for reference:**
```typescript
// Top imports (add these two):
import { GuildMember } from 'discord.js';
import { applyAFKNickname, restoreNickname } from '../focus/nickname.js';
```

- [ ] **Step 1: Add imports to `interactions.ts`**

Replace the existing import block top line:
```typescript
import type { ButtonInteraction, Client } from 'discord.js';
import { TextChannel } from 'discord.js';
```
with:
```typescript
import type { ButtonInteraction, Client } from 'discord.js';
import { GuildMember, TextChannel } from 'discord.js';
import { applyAFKNickname, restoreNickname } from '../focus/nickname.js';
```

- [ ] **Step 2: Apply AFK on `start`**

Find the `start` block. After `await startSession(sessionId);`, add the AFK apply loop:

```typescript
  } else if (action === 'start') {
    if (session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'Only the session owner can start it.', ephemeral: true });
      return;
    }
    if (session.status !== 'LOBBY') {
      await interaction.reply({ content: 'Session is already running.', ephemeral: true });
      return;
    }
    await startSession(sessionId);

    // Apply [AFK] nickname to all participants
    if (interaction.guild) {
      for (const p of session.participants) {
        const member = await interaction.guild.members.fetch(p.userId).catch(() => null);
        if (member) await applyAFKNickname(member, sessionId);
      }
    }

    scheduleSessionEnd(sessionId, session.durationMins * 60_000, async () => {
      try {
        await closeAllParticipants(sessionId);
        await endSession(sessionId);
        // Restore nicknames for all participants
        const ended = await prisma.focusSession.findUnique({
          where: { id: sessionId },
          include: { participants: true },
        });
        if (ended && interaction.guild) {
          for (const p of ended.participants) {
            const member = await interaction.guild.members.fetch(p.userId).catch(() => null);
            if (member) await restoreNickname(member, p.originalNickname ?? null);
          }
        }
        const ch = await client.channels.fetch(session.channelId).catch(() => null);
        if (ch instanceof TextChannel) {
          await ch.send(getBreakSuggestion(session.durationMins));
          const msg = await ch.messages.fetch(session.messageId).catch(() => null);
          if (msg) await msg.edit({ content: '✅ Session complete!', embeds: [], components: [] });
        }
      } catch (err) {
        console.error(`Timer callback failed for session ${sessionId}:`, err);
      }
    });
```

- [ ] **Step 3: Restore nickname on individual `leave`**

Find the `leave` block for non-owner participants. After `await leaveSession(...)`, add restore:

```typescript
  } else if (action === 'leave') {
    if (session.ownerId === interaction.user.id) {
      cancelSessionTimer(sessionId);
      // Restore all participants' nicknames before cancelling
      if (interaction.guild) {
        for (const p of session.participants) {
          const member = await interaction.guild.members.fetch(p.userId).catch(() => null);
          if (member) await restoreNickname(member, p.originalNickname ?? null);
        }
      }
      await closeAllParticipants(sessionId);
      await cancelSession(sessionId);
      await interaction.update({ content: `Session ended — <@${interaction.user.id}> (the owner) left.`, embeds: [], components: [] });
      return;
    }
    await leaveSession(sessionId, interaction.user.id);
    // Restore only this user's nickname
    if (interaction.member instanceof GuildMember) {
      const participant = session.participants.find(p => p.userId === interaction.user.id);
      await restoreNickname(interaction.member, participant?.originalNickname ?? null);
    }
```

- [ ] **Step 4: Restore all nicknames on owner `end`**

Find the `end` block. Before `await closeAllParticipants(sessionId)`, add restore:

```typescript
  } else if (action === 'end') {
    if (session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'Only the session owner can end it.', ephemeral: true });
      return;
    }
    cancelSessionTimer(sessionId);
    // Restore all participants' nicknames
    if (interaction.guild) {
      for (const p of session.participants) {
        const member = await interaction.guild.members.fetch(p.userId).catch(() => null);
        if (member) await restoreNickname(member, p.originalNickname ?? null);
      }
    }
    await closeAllParticipants(sessionId);
    await endSession(sessionId);
    await interaction.update({ content: '✅ Session ended early.', embeds: [], components: [] });
    return;
```

- [ ] **Step 5: Show complete final `interactions.ts` for reference**

After all edits, the full file should look like this:

```typescript
import type { ButtonInteraction, Client } from 'discord.js';
import { GuildMember, TextChannel } from 'discord.js';
import { prisma } from '@yap/db';
import { startSession, endSession, cancelSession } from '../focus/session.js';
import { joinSession, leaveSession, closeAllParticipants } from '../focus/participants.js';
import { buildSessionEmbed } from '../focus/embed.js';
import { getBreakSuggestion } from '../focus/breaks.js';
import { scheduleSessionEnd, cancelSessionTimer } from '../focus/timer.js';
import { applyAFKNickname, restoreNickname } from '../focus/nickname.js';

export async function handleButtonInteraction(interaction: ButtonInteraction, client: Client): Promise<void> {
  const { customId } = interaction;

  if (!customId.startsWith('focus_')) return;

  const parts = customId.split('_');
  const action = parts[1];
  const sessionId = parts.slice(2).join('_');
  if (!action || !sessionId) return;

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
      cancelSessionTimer(sessionId);
      if (interaction.guild) {
        for (const p of session.participants) {
          const member = await interaction.guild.members.fetch(p.userId).catch(() => null);
          if (member) await restoreNickname(member, p.originalNickname ?? null);
        }
      }
      await closeAllParticipants(sessionId);
      await cancelSession(sessionId);
      await interaction.update({ content: `Session ended — <@${interaction.user.id}> (the owner) left.`, embeds: [], components: [] });
      return;
    }
    await leaveSession(sessionId, interaction.user.id);
    if (interaction.member instanceof GuildMember) {
      const participant = session.participants.find(p => p.userId === interaction.user.id);
      await restoreNickname(interaction.member, participant?.originalNickname ?? null);
    }

  } else if (action === 'start') {
    if (session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'Only the session owner can start it.', ephemeral: true });
      return;
    }
    if (session.status !== 'LOBBY') {
      await interaction.reply({ content: 'Session is already running.', ephemeral: true });
      return;
    }
    await startSession(sessionId);

    if (interaction.guild) {
      for (const p of session.participants) {
        const member = await interaction.guild.members.fetch(p.userId).catch(() => null);
        if (member) await applyAFKNickname(member, sessionId);
      }
    }

    scheduleSessionEnd(sessionId, session.durationMins * 60_000, async () => {
      try {
        await closeAllParticipants(sessionId);
        await endSession(sessionId);
        const ended = await prisma.focusSession.findUnique({
          where: { id: sessionId },
          include: { participants: true },
        });
        if (ended && interaction.guild) {
          for (const p of ended.participants) {
            const member = await interaction.guild.members.fetch(p.userId).catch(() => null);
            if (member) await restoreNickname(member, p.originalNickname ?? null);
          }
        }
        const ch = await client.channels.fetch(session.channelId).catch(() => null);
        if (ch instanceof TextChannel) {
          await ch.send(getBreakSuggestion(session.durationMins));
          const msg = await ch.messages.fetch(session.messageId).catch(() => null);
          if (msg) await msg.edit({ content: '✅ Session complete!', embeds: [], components: [] });
        }
      } catch (err) {
        console.error(`Timer callback failed for session ${sessionId}:`, err);
      }
    });

  } else if (action === 'end') {
    if (session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'Only the session owner can end it.', ephemeral: true });
      return;
    }
    cancelSessionTimer(sessionId);
    if (interaction.guild) {
      for (const p of session.participants) {
        const member = await interaction.guild.members.fetch(p.userId).catch(() => null);
        if (member) await restoreNickname(member, p.originalNickname ?? null);
      }
    }
    await closeAllParticipants(sessionId);
    await endSession(sessionId);
    await interaction.update({ content: '✅ Session ended early.', embeds: [], components: [] });
    return;

  } else {
    return;
  }

  const updated = await prisma.focusSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { participants: { include: { user: true } }, owner: true },
  });
  const { embeds, components } = buildSessionEmbed(updated);
  await interaction.update({ embeds, components });
}
```

- [ ] **Step 6: Verify TypeScript**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main/apps/bot && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output.

- [ ] **Step 7: Run full test suite**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main/apps/bot && DATABASE_URL=postgresql://yap:yap@localhost:5432/yap pnpm test 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main && git add apps/bot/src/handlers/interactions.ts && git commit -m "feat: apply [AFK] nickname on focus start, restore on leave/end"
```

---

## Manual test checklist

After starting the bot with `pnpm dev:bot`:

- [ ] Start a focus session → all participants (including owner) get `[AFK] ` prefix
- [ ] User with no nickname gets `[AFK] {their_username}`
- [ ] User with a long nickname (>26 chars) gets truncated but restores to full original
- [ ] Participant leaves mid-session → their nickname restores, others keep `[AFK]`
- [ ] Owner ends session early → all nicknames restore
- [ ] Session timer fires naturally → all nicknames restore
- [ ] Owner leaves from LOBBY (cancels) → all nicknames restore (none were set yet since AFK applies on start, so this is a no-op — all `originalNickname` are null)

---

## Known limitation

Bot restart mid-session: the `[AFK]` nicknames are already set in Discord (Discord persists them). On restart, `recovery.ts` reschedules the timer but does not restore nicknames if the session ends cleanly after restart. The `originalNickname` values are in the DB so a future recovery enhancement can fix this.
