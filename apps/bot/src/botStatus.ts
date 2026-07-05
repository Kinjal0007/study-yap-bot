import type { Client } from 'discord.js';
import { ActivityType } from 'discord.js';
import { STUDY_CHANNELS } from './handlers/voiceState.js';

export function startStatusUpdater(client: Client): void {
  const update = () => {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    let count = 0;
    for (const [, channel] of guild.channels.cache) {
      if (STUDY_CHANNELS.has(channel.id) && channel.isVoiceBased()) {
        count += channel.members.size;
      }
    }

    const text = count === 0 ? 'the study space' : `${count} ${count === 1 ? 'person' : 'people'} studying`;
    client.user?.setActivity(text, { type: ActivityType.Watching });
  };

  update();
  setInterval(update, 60_000);
}
