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
