import type { Client } from 'discord.js';
import { TextChannel } from 'discord.js';
import { prisma, SessionStatus } from '@yap/db';
import { closeAllParticipants } from './focus/participants.js';
import { endSession } from './focus/session.js';
import { scheduleSessionEnd } from './focus/timer.js';
import { getBreakSuggestion } from './focus/breaks.js';

export async function reconcileActiveSessions(client: Client): Promise<void> {
  const activeSessions = await prisma.focusSession.findMany({
    where: { status: SessionStatus.ACTIVE },
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
        await endSession(session.id);
        console.log(`Closed expired session ${session.id}`);
      } catch (err) {
        console.error(`Failed to close expired session ${session.id}:`, err);
      }
    } else {
      scheduleSessionEnd(session.id, remaining, async () => {
        try {
          await closeAllParticipants(session.id);
          await endSession(session.id);
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
