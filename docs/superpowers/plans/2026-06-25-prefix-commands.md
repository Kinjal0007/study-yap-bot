# Prefix Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support `.focus`, `.leaderboard`, and `.mystats` as text prefix commands alongside existing slash commands.

**Architecture:** A `messageCreate` listener routes `.`-prefixed messages to a new `prefix.ts` handler. `.focus` sends a duration picker (5 buttons); clicking one fires a `focus_create_{duration}` button interaction handled by a new `create` action in the existing `interactions.ts`. `.leaderboard` and `.mystats` call the service layer directly and reply with the same embeds as the slash commands.

**Tech Stack:** discord.js v14 `Message`, `ActionRowBuilder`, `ButtonBuilder`, `GatewayIntentBits.MessageContent`, TypeScript ESM, vitest

---

## Prefix syntax

```
.focus                        → sends duration picker (30/45/60/90/120 min buttons)
.leaderboard                  → all-time leaderboard
.leaderboard week             → this-week leaderboard
.leaderboard month            → this-month leaderboard
.mystats                      → caller's focus stats
```

## Button customId for duration picker

```
focus_create_30   → 30 min
focus_create_45   → 45 min
focus_create_60   → 60 min (1 hour)
focus_create_90   → 90 min
focus_create_120  → 120 min (2 hours)
```

The existing customId parser (`parts[1]` = action, `parts.slice(2).join('_')` = "sessionId") gives:
- action = `'create'`
- sessionId = `'30'` (the duration, reusing the sessionId slot)

---

## File Map

```
apps/bot/src/
├── client.ts                    MODIFY — add MessageContent intent
├── index.ts                     MODIFY — register messageCreate handler
└── handlers/
    ├── prefix.ts                CREATE — .focus picker, .leaderboard, .mystats
    ├── prefix.test.ts           CREATE — tests for parsePrefix helper
    └── interactions.ts          MODIFY — add 'create' action before session lookup
```

---

## Task 1: Add MessageContent intent + wire messageCreate

**Files:**
- Modify: `apps/bot/src/client.ts`
- Modify: `apps/bot/src/index.ts`

Without `MessageContent`, Discord sends empty string as message content for bot-registered apps — the prefix check would never match.

- [ ] **Step 1: Edit `apps/bot/src/client.ts`**

Current intents array:
```typescript
intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildVoiceStates,
],
```

Replace with:
```typescript
intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.MessageContent,
],
```

- [ ] **Step 2: Edit `apps/bot/src/index.ts`**

Add import after the existing imports:
```typescript
import { handlePrefixCommand } from './handlers/prefix.js';
```

Add event listener after the `VoiceStateUpdate` block:
```typescript
client.on(Events.MessageCreate, (message) => handlePrefixCommand(message));
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main/apps/bot && npx tsc --noEmit 2>&1 | head -10
```

Expected: may error on missing `prefix.ts` module — that's fine, it will be created in Task 2.

- [ ] **Step 4: Commit**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main && git add apps/bot/src/client.ts apps/bot/src/index.ts && git commit -m "feat: add MessageContent intent and wire messageCreate"
```

---

## Task 2: Create `prefix.ts` with TDD

**Files:**
- Create: `apps/bot/src/handlers/prefix.ts`
- Create: `apps/bot/src/handlers/prefix.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/bot/src/handlers/prefix.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parsePrefix } from './prefix.js';

describe('parsePrefix', () => {
  it('returns null for non-prefixed messages', () => {
    expect(parsePrefix('hello world', '.')).toBeNull();
  });

  it('returns null for bot messages (empty content)', () => {
    expect(parsePrefix('', '.')).toBeNull();
  });

  it('parses a bare command', () => {
    expect(parsePrefix('.focus', '.')).toEqual({ command: 'focus', args: [] });
  });

  it('parses a command with one arg', () => {
    expect(parsePrefix('.leaderboard week', '.')).toEqual({ command: 'leaderboard', args: ['week'] });
  });

  it('parses a command with multiple args', () => {
    expect(parsePrefix('.leaderboard this month', '.')).toEqual({ command: 'leaderboard', args: ['this', 'month'] });
  });

  it('is case-insensitive on the command', () => {
    expect(parsePrefix('.FOCUS', '.')).toEqual({ command: 'focus', args: [] });
  });

  it('trims extra whitespace', () => {
    expect(parsePrefix('.focus   ', '.')).toEqual({ command: 'focus', args: [] });
  });
});
```

- [ ] **Step 2: Run tests — verify FAIL**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main/apps/bot && DATABASE_URL=postgresql://yap:yap@localhost:5432/yap pnpm test -- prefix 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module './prefix.js'"

- [ ] **Step 3: Create `apps/bot/src/handlers/prefix.ts`**

```typescript
import type { Message } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getActiveSessionForChannel } from '../focus/session.js';
import { getLeaderboard, getMyStats, type TimeRange } from '../focus/stats.js';

const PREFIX = '.';

export function parsePrefix(
  content: string,
  prefix: string,
): { command: string; args: string[] } | null {
  if (!content.startsWith(prefix)) return null;
  const [rawCommand, ...args] = content.slice(prefix.length).trim().split(/\s+/);
  if (!rawCommand) return null;
  return { command: rawCommand.toLowerCase(), args: args.filter(Boolean) };
}

export async function handlePrefixCommand(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guildId) return;

  const parsed = parsePrefix(message.content, PREFIX);
  if (!parsed) return;

  const { command, args } = parsed;

  if (command === 'focus') {
    await handleFocus(message);
  } else if (command === 'leaderboard') {
    await handleLeaderboard(message, args);
  } else if (command === 'mystats') {
    await handleMystats(message);
  }
}

async function handleFocus(message: Message): Promise<void> {
  const existing = await getActiveSessionForChannel(message.channelId);
  if (existing) {
    await message.reply('There is already an active session in this channel. End it before starting a new one.');
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('focus_create_30').setLabel('30 min').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('focus_create_45').setLabel('45 min').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('focus_create_60').setLabel('1 hour').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('focus_create_90').setLabel('90 min').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('focus_create_120').setLabel('2 hours').setStyle(ButtonStyle.Secondary),
  );

  await message.reply({ content: 'Choose a duration for your focus session:', components: [row] });
}

async function handleLeaderboard(message: Message, args: string[]): Promise<void> {
  const rangeMap: Record<string, TimeRange> = {
    week:  'this-week',
    month: 'this-month',
  };
  const range: TimeRange = rangeMap[args[0]?.toLowerCase() ?? ''] ?? 'all-time';
  const rows = await getLeaderboard(message.guildId!, range);

  const rangeLabel: Record<TimeRange, string> = {
    'all-time':   'All Time',
    'this-week':  'This Week',
    'this-month': 'This Month',
  };

  const description = rows.length === 0
    ? 'No focus sessions recorded yet. Start one with `.focus`!'
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

  await message.reply({ embeds: [embed] });
}

async function handleMystats(message: Message): Promise<void> {
  const stats = await getMyStats(message.guildId!, message.author.id);

  const timeStr = stats.totalMinutes >= 60
    ? `${Math.floor(stats.totalMinutes / 60)}h ${stats.totalMinutes % 60}m`
    : `${stats.totalMinutes} minutes`;

  const embed = new EmbedBuilder()
    .setTitle('Your Focus Stats')
    .setDescription(
      stats.sessionCount === 0
        ? "You haven't completed a focus session yet. Start one with `.focus`!"
        : `You've focused for **${timeStr}** across **${stats.sessionCount} sessions**.`,
    )
    .setColor(0x7c6af7);

  await message.reply({ embeds: [embed] });
}
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main/apps/bot && DATABASE_URL=postgresql://yap:yap@localhost:5432/yap pnpm test -- prefix 2>&1 | tail -10
```

Expected: 7 tests PASS.

- [ ] **Step 5: Verify full TypeScript**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main/apps/bot && npx tsc --noEmit 2>&1 | head -10
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main && git add apps/bot/src/handlers/prefix.ts apps/bot/src/handlers/prefix.test.ts && git commit -m "feat: prefix command handler with duration picker"
```

---

## Task 3: Add `create` action to `interactions.ts`

**Files:**
- Modify: `apps/bot/src/handlers/interactions.ts`

The `create` action must be handled **before** the existing `session` DB lookup, since there is no session yet when the user is picking a duration.

- [ ] **Step 1: Read current `apps/bot/src/handlers/interactions.ts`**

Confirm the current top of the file and the structure around the session lookup. The relevant section looks like:

```typescript
const session = await prisma.focusSession.findUnique({
  where: { id: sessionId },
  include: { participants: { include: { user: true } }, owner: true },
});

if (!session) {
  await interaction.reply({ content: 'This session no longer exists.', ephemeral: true });
  return;
}
```

- [ ] **Step 2: Add `create` action block before the session lookup**

Insert this block immediately before `const session = await prisma.focusSession.findUnique(...)`:

```typescript
  if (action === 'create') {
    const durationMins = parseInt(sessionId, 10);
    if (!interaction.guildId || !interaction.channelId) return;

    const existing = await getActiveSessionForChannel(interaction.channelId);
    if (existing) {
      await interaction.reply({ content: 'There is already an active session in this channel.', ephemeral: true });
      return;
    }

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

    const newSession = await createSession({
      guildId:      interaction.guildId,
      channelId:    interaction.channelId,
      ownerId:      interaction.user.id,
      durationMins,
    });

    const fullSession = await prisma.focusSession.findUniqueOrThrow({
      where: { id: newSession.id },
      include: { participants: { include: { user: true } }, owner: true },
    });

    const { embeds, components } = buildSessionEmbed(fullSession);
    const msg = await interaction.reply({ embeds, components, fetchReply: true });
    await setSessionMessageId(newSession.id, msg.id);
    return;
  }
```

Also add `getActiveSessionForChannel` and `setSessionMessageId` to the existing session import line if not already present:

```typescript
import { startSession, endSession, cancelSession, getActiveSessionForChannel, setSessionMessageId } from '../focus/session.js';
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main/apps/bot && npx tsc --noEmit 2>&1 | head -10
```

Expected: no output.

- [ ] **Step 4: Run full test suite**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main/apps/bot && DATABASE_URL=postgresql://yap:yap@localhost:5432/yap pnpm test 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/kinjalkumar/Development/discord-bot-main && git add apps/bot/src/handlers/interactions.ts && git commit -m "feat: handle focus_create action from prefix duration picker"
```

---

## Manual test checklist

After starting the bot with `pnpm dev:bot`:

- [ ] Type `.focus` → bot replies with 5 duration buttons (30 min / 45 min / 1 hour / 90 min / 2 hours)
- [ ] Click a duration button → focus session lobby appears (same as `/focus`)
- [ ] Type `.focus` when a session is already active → bot replies with "already an active session"
- [ ] Type `.leaderboard` → all-time leaderboard embed
- [ ] Type `.leaderboard week` → this-week leaderboard embed
- [ ] Type `.leaderboard month` → this-month leaderboard embed
- [ ] Type `.mystats` → your personal stats embed
- [ ] Type `focus` (no dot) → bot ignores it
- [ ] Slash commands still work normally
