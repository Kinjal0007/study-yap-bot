import { z } from 'zod';

const schema = z.object({
  DISCORD_TOKEN:     z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  DATABASE_URL:      z.string().min(1, 'DATABASE_URL is required'),
  NODE_ENV:          z.enum(['development', 'production', 'test']).default('development'),
});

const result = schema.safeParse(process.env);

if (!result.success) {
  console.error('❌ Invalid environment variables:');
  console.error(result.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = result.data;
