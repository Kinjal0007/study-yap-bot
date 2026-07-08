import type { Message } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Colors } from 'discord.js';
import { getLeaderboard, getMyStats, getTier, type TimeRange } from '../focus/stats.js';
import { formatTime } from '../commands/leaderboard.js';
import { buildStatsEmbed } from '../commands/mystats.js';
import { getLeaderboard as getFocusLeaderboard } from '../focus/focusStats.js';
import { loadTierRoles, updateMemberTierRole } from '../focus/roles.js';
import { setAfk } from '../afk.js';
import { prisma } from '@yap/db';

const PREFIX = '-';

export function parsePrefix(
  content: string,
  prefix: string,
): { command: string; args: string[] } | null {
  if (!content.startsWith(prefix)) return null;
  const [rawCommand, ...args] = content.slice(prefix.length).trim().split(/\s+/);
  if (!rawCommand) return null;
  return { command: rawCommand.toLowerCase(), args: args.filter(Boolean) };
}

export async function handlePrefixCommand(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guildId) return;

  const parsed = parsePrefix(message.content, PREFIX);
  if (!parsed) return;

  const { command, args } = parsed;

  if (command === 'afk') {
    const reason = args.join(' ') || 'AFK';
    await setAfk(message, reason);
  } else if (command === 'focus') {
    await handleFocus(message);
  } else if (command === 'lb') {
    const sub = args[0]?.toLowerCase();
    if (sub === '-study') {
      await handleStudyLeaderboard(message, args.slice(1));
    } else if (sub === '-focus') {
      await handleFocusLeaderboard(message, args.slice(1));
    } else {
      await message.reply('Use `.lb -study` for the study VC leaderboard or `.lb -focus` for the focus session leaderboard.');
    }
  } else if (command === 'me') {
    await handleMystats(message);
  } else if (command === 'updateroles') {
    const ADMIN_ROLE_ID = '1506387531405725758';
    if (!message.member?.roles.cache.has(ADMIN_ROLE_ID)) return;
    await handleUpdateRoles(message);
  }
}

async function handleFocus(message: Message): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle('📚 New Focus Session')
    .setDescription('Choose a duration to get started.')
    .setColor(0x7c6af7);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('focus_create_30').setLabel('30 min').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('focus_create_45').setLabel('45 min').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('focus_create_60').setLabel('1 hour').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('focus_create_90').setLabel('90 min').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('focus_create_120').setLabel('2 hours').setStyle(ButtonStyle.Secondary),
  );

  const sent = await message.reply({ embeds: [embed], components: [row] });

  setTimeout(async () => {
    try {
      const current = await sent.fetch();
      if (current.components.length > 0) {
        const expired = new EmbedBuilder()
          .setTitle('📚 New Focus Session')
          .setDescription('No duration selected — this picker has expired.')
          .setColor(Colors.Grey);
        await current.edit({ embeds: [expired], components: [] });
      }
    } catch {
      // message deleted or already updated
    }
  }, 2 * 60 * 1000);
}

async function handleStudyLeaderboard(message: Message, args: string[]): Promise<void> {
  const rangeMap: Record<string, TimeRange> = { week: 'this-week', month: 'this-month' };
  const range: TimeRange = rangeMap[args[0]?.toLowerCase() ?? ''] ?? 'this-month';
  const rangeLabel: Record<TimeRange, string> = {
    'all-time': 'All Time', 'this-week': 'This Week', 'this-month': 'This Month',
  };

  const rows = await getLeaderboard(range);

  const col1 = 4;
  const col2 = 22;
  const col3 = 10;
  const header = `${'#'.padEnd(col1)}${'User'.padEnd(col2)}${'Hours'.padEnd(col3)}Tier`;
  const sep    = '─'.repeat(header.length);
  const lines  = rows.length === 0
    ? ['No study time recorded yet.']
    : rows.map((r, i) => {
        const place = `${i + 1}.`.padEnd(col1);
        const name  = (r.username ?? 'Unknown').slice(0, col2 - 1).padEnd(col2);
        const hours = fmtH(r.totalSecs).padEnd(col3);
        const tier  = getTier(r.totalSecs / 3600);
        return `${place}${name}${hours}${tier.name}`;
      });

  const block = [header, sep, ...lines].join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`📊 Study Leaderboard — ${rangeLabel[range]}`)
    .setDescription(`\`\`\`\n${block}\n\`\`\``)
    .setColor(0xa8ff3e);

  await message.reply({ embeds: [embed] });
}

async function handleFocusLeaderboard(message: Message, args: string[]): Promise<void> {
  const rangeMap: Record<string, TimeRange> = { week: 'this-week', month: 'this-month' };
  const range: TimeRange = rangeMap[args[0]?.toLowerCase() ?? ''] ?? 'this-month';
  const rangeLabel: Record<TimeRange, string> = {
    'all-time': 'All Time', 'this-week': 'This Week', 'this-month': 'This Month',
  };

  const rows = await getFocusLeaderboard(message.guildId!, range);

  const col1 = 4;
  const col2 = 22;
  const col3 = 10;
  const header = `${'#'.padEnd(col1)}${'User'.padEnd(col2)}${'Time'.padEnd(col3)}Sessions`;
  const sep    = '─'.repeat(header.length);
  const lines  = rows.length === 0
    ? ['No focus sessions recorded yet.']
    : rows.map((r, i) => {
        const place    = `${i + 1}.`.padEnd(col1);
        const name     = (r.username ?? r.userId ?? 'Unknown').slice(0, col2 - 1).padEnd(col2);
        const time     = fmtH(r.totalMinutes * 60).padEnd(col3);
        return `${place}${name}${time}${r.sessionCount}`;
      });

  const block = [header, sep, ...lines].join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`🍅 Focus Leaderboard — ${rangeLabel[range]}`)
    .setDescription(`\`\`\`\n${block}\n\`\`\``)
    .setColor(0x7c6af7);

  await message.reply({ embeds: [embed] });
}

function fmtH(secs: number): string {
  const h = secs / 3600;
  return h >= 1 ? `${h.toFixed(1)}h` : `${Math.round(secs / 60)}m`;
}

async function handleMystats(message: Message): Promise<void> {
  const stats = await getMyStats(message.author.id);
  const embed = buildStatsEmbed(message.author.id, stats, message.author.displayName);
  await message.reply({ embeds: [embed] });

  if (message.guild) {
    await updateMemberTierRole(message.guild, message.author.id, stats.monthlySecs / 3600);
  }
}

async function handleUpdateRoles(message: Message): Promise<void> {
  if (!message.guild) return;

  await loadTierRoles(message.guild);

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const rows = await prisma.vcSession.groupBy({
    by: ['userId'],
    where: { leftAt: { not: null }, joinedAt: { gte: monthStart } },
    _sum: { durationSecs: true },
  });

  const statusMsg = await message.reply(`Updating roles for ${rows.length} users...`);
  let updated = 0;

  for (const row of rows) {
    const hours = (row._sum.durationSecs ?? 0) / 3600;
    await updateMemberTierRole(message.guild, row.userId, hours);
    updated++;
  }

  await statusMsg.edit(`Done! Updated roles for ${updated} users.`);
}
