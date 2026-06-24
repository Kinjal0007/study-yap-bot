import { env } from './env.js';

console.log('Bot starting with environment:', {
  NODE_ENV: env.NODE_ENV,
  DISCORD_CLIENT_ID: env.DISCORD_CLIENT_ID,
});
