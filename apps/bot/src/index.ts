import { Events } from 'discord.js';
import { createClient } from './client.js';
import { env } from './env.js';
import { registerCommands } from './commands/index.js';
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
