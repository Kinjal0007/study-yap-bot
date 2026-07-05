import type { Guild } from 'discord.js';
import { TIERS } from './stats.js';

// Maps tier name (e.g. "Scout") to Discord role ID — populated on startup
const tierRoleIds = new Map<string, string>();

export async function loadTierRoles(guild: Guild): Promise<void> {
  const roles = await guild.roles.fetch();
  for (const [, role] of roles) {
    const firstName = role.name.split(/[\s|]/)[0];
    const tier = TIERS.find(t => t.name.split(' ')[0] === firstName);
    if (tier) tierRoleIds.set(tier.name, role.id);
  }
  console.log(`Loaded ${tierRoleIds.size} tier roles.`);
}

export async function updateMemberTierRole(guild: Guild, userId: string, monthlyHours: number): Promise<void> {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  const { getTier } = await import('./stats.js');
  const targetTier = getTier(monthlyHours);
  const targetRoleId = tierRoleIds.get(targetTier.name);
  if (!targetRoleId) return;

  // Remove all other tier roles, add the correct one
  const tierRoleIdSet = new Set(tierRoleIds.values());
  const toRemove = member.roles.cache.filter(r => tierRoleIdSet.has(r.id) && r.id !== targetRoleId);
  for (const [, role] of toRemove) {
    await member.roles.remove(role).catch(() => {});
  }
  if (!member.roles.cache.has(targetRoleId)) {
    await member.roles.add(targetRoleId).catch(() => {});
  }
}
