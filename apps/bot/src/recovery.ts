import type { Client } from 'discord.js';
import { TextChannel } from 'discord.js';
import { prisma } from '@yap/db';
import { closeAllParticipants } from './focus/participants.js';
import { endSession } from './focus/session.js';
import { scheduleSessionEnd } from './focus/timer.js';
import { getBreakSuggestion } from './focus/breaks.js';
import { restoreNickname } from './focus/nickname.js';

async function clearSessionMessage(client: Client, session: { channelId: string; messageId: string }): Promise<void> {
  try {
    const ch = await client.channels.fetch(session.channelId).catch(() => null);
    if (ch instanceof TextChannel) {
      const msg = await ch.messages.fetch(session.messageId).catch(() => null);
      if (msg) await msg.edit({ content: '✅ Session complete!', embeds: [], components: [] });
    }
  } catch {
    // message may already be deleted
  }
}

async function restoreSessionNicknames(client: Client, sessionId: string): Promise<void> {
  const participants = await prisma.focusParticipant.findMany({ where: { sessionId } });
  const guild = client.guilds.cache.first();
  if (!guild) return;
  for (const p of participants) {
    const member = await guild.members.fetch(p.userId).catch(() => null);
    if (member) await restoreNickname(member, p.originalNickname ?? null);
  }
}

async function closeStaleVcSessions(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stale = await prisma.vcSession.findMany({
    where: { leftAt: null, joinedAt: { lt: cutoff } },
    select: { id: true, joinedAt: true },
  });
  if (stale.length === 0) return;

  for (const s of stale) {
    const leftAt = new Date(s.joinedAt.getTime() + 12 * 60 * 60 * 1000); // cap at 12h
    const durationSecs = 12 * 3600;
    await prisma.vcSession.update({
      where: { id: s.id },
      data: { leftAt, durationSecs },
    });
  }
  console.log(`Closed ${stale.length} stale VC session(s) older than 24h`);
}

async function cleanupStalePickerMessages(client: Client): Promise<void> {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentChannels = await prisma.focusSession.findMany({
    where: { startedAt: { gte: cutoff } },
    select: { channelId: true },
    distinct: ['channelId'],
  });

  const channelIds = new Set(recentChannels.map(r => r.channelId));

  for (const channelId of channelIds) {
    try {
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (!(ch instanceof TextChannel)) continue;
      const messages = await ch.messages.fetch({ limit: 10 }).catch(() => null);
      if (!messages) continue;
      for (const msg of messages.values()) {
        if (!msg.author.bot) continue;
        const isRecent = Date.now() - msg.createdTimestamp < 5 * 60 * 1000;
        if (isRecent) continue;
        const hasPickerButton = msg.components.some(row =>
          'components' in row && (row as { components: { customId?: string }[] }).components.some(
            c => c.customId?.startsWith('focus_create_')
          )
        );
        if (hasPickerButton) {
          await msg.edit({
            embeds: [{ title: '📚 New Focus Session', description: 'No duration selected — this picker has expired.', color: 0x9e9e9e }],
            components: [],
          }).catch(() => null);
        }
      }
    } catch {
      // ignore
    }
  }
}

async function cleanupStaleDoneMessages(client: Client): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const doneSessions = await prisma.focusSession.findMany({
    where: {
      status: { in: ['DONE', 'CANCELLED'] },
      endedAt: { gte: cutoff },
      messageId: { not: '' },
    },
  });
  for (const session of doneSessions) {
    try {
      const ch = await client.channels.fetch(session.channelId).catch(() => null);
      if (!(ch instanceof TextChannel)) continue;
      const msg = await ch.messages.fetch(session.messageId).catch(() => null);
      if (!msg) continue;
      if (msg.components.length > 0) {
        await msg.edit({ content: '✅ Session complete!', embeds: [], components: [] });
      }
    } catch {
      // ignore
    }
  }
}

export async function reconcileActiveSessions(client: Client): Promise<void> {
  await closeStaleVcSessions();
  await cleanupStaleDoneMessages(client);
  await cleanupStalePickerMessages(client);

  const activeSessions = await prisma.focusSession.findMany({
    where: { status: 'ACTIVE' as const },
  });

  console.log(`Reconciling ${activeSessions.length} active session(s) on startup...`);

  for (const session of activeSessions) {
    if (!session.startedAt) {
      console.warn(`Session ${session.id} is ACTIVE but has no startedAt — skipping`);
      continue;
    }

    const endsAt    = new Date(session.startedAt.getTime() + session.durationMins * 60_000);
    const remaining = endsAt.getTime() - Date.now();

    if (remaining <= 0) {
      try {
        await closeAllParticipants(session.id);
        await endSession(session.id, true);
        await restoreSessionNicknames(client, session.id);
        await clearSessionMessage(client, session);
        console.log(`Closed expired session ${session.id}`);
      } catch (err) {
        console.error(`Failed to close expired session ${session.id}:`, err);
      }
    } else {
      scheduleSessionEnd(session.id, remaining, async () => {
        try {
          await closeAllParticipants(session.id);
          await endSession(session.id, true);
          await restoreSessionNicknames(client, session.id);
          await clearSessionMessage(client, session);
          const ch = await client.channels.fetch(session.channelId).catch(() => null);
          if (ch instanceof TextChannel) {
            await ch.send(getBreakSuggestion(session.durationMins));
          }
        } catch (err) {
          console.error(`Timer callback failed for session ${session.id}:`, err);
        }
      });
      console.log(`Rescheduled session ${session.id} — ${Math.round(remaining / 60_000)} min remaining`);
    }
  }
}
