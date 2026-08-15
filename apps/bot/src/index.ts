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
import { handleVoiceStateUpdate, WARNING_CHANNEL_ID, AFK_CHANNEL_ID } from './handlers/voiceState.js';
import { loadTierRoles, updateMemberTierRole } from './focus/roles.js';
import { handlePrefixCommand } from './handlers/prefix.js';
import { startStatusUpdater } from './botStatus.js';
import { registerAfkHandler } from './afk.js';
import { prisma } from '@yap/db';

const client = createClient();

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  await registerCommands();
  await reconcileActiveSessions(c);
  const guild = c.guilds.cache.first();
  if (guild) await loadTierRoles(guild);
  startStatusUpdater(c);
});

client.on(Events.GuildCreate, onGuildCreate);
client.on(Events.GuildDelete, onGuildDelete);

// Requires the GuildMembers privileged intent — both in client.ts and enabled in the
// Discord developer portal. Without it this event never fires at all.
const MEMBER_ROLE_ID = '1538180699062935664';

client.on(Events.GuildMemberAdd, async (member) => {
  // Kept separate from the tier lookup below: a DB failure must not stop
  // every new joiner from getting the base Member role.
  try {
    await member.roles.add(MEMBER_ROLE_ID, 'Auto-assigned on join');
  } catch (err) {
    console.error(`Failed to assign Member role to ${member.id}:`, err);
  }

  try {
    const { _sum } = await prisma.vcSession.aggregate({
      where: { userId: member.id, leftAt: { not: null } },
      _sum: { durationSecs: true },
    });
    const hours = (_sum.durationSecs ?? 0) / 3600;
    if (hours > 0) await updateMemberTierRole(member.guild, member.id, hours);
  } catch (err) {
    console.error('Failed to assign tier role on member join:', err);
  }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guild = client.guilds.cache.first();
  await handleVoiceStateUpdate(
    oldState,
    newState,
    async (userId) => {
      try {
        const ch = await client.channels.fetch(WARNING_CHANNEL_ID).catch(() => null);
        if (ch instanceof TextChannel) {
          await ch.send(
            `<@${userId}> please turn on your camera or screenshare within 4 minutes, or you'll be moved to the AFK channel.`,
          );
        }
      } catch (err) {
        console.error('Failed to send cam warning:', err);
      }
    },
    async (userId) => {
      try {
        if (!guild) return;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member?.voice.channelId) return;
        await member.voice.setChannel(AFK_CHANNEL_ID);
      } catch (err) {
        console.error('Failed to move user to AFK:', err);
      }
    },
    guild,
  );
});

client.on(Events.MessageCreate, (message) => handlePrefixCommand(message));
registerAfkHandler(client);

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
