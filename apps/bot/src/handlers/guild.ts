import type { Guild } from 'discord.js';
import { prisma } from '@yap/db';

export async function onGuildCreate(guild: Guild): Promise<void> {
  await prisma.guild.upsert({
    where:  { id: guild.id },
    update: { name: guild.name },
    create: { id: guild.id, name: guild.name },
  });
  console.log(`Joined guild: ${guild.name} (${guild.id})`);
}

export async function onGuildDelete(guild: Guild): Promise<void> {
  await prisma.guild.deleteMany({ where: { id: guild.id } });
  console.log(`Left guild: ${guild.name} (${guild.id})`);
}
