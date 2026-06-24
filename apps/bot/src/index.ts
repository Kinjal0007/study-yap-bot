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
