# Study-Yap Bot

A Discord bot for study servers. Tracks voice channel study time, runs timed focus sessions, assigns tier roles based on monthly hours, and handles DND status.

## Features

### Prefix Commands

| Command | Description |
|---|---|
| `-me` | Your personal study stats — weekly, monthly, all-time hours, rank, and current tier |
| `-lb -study` | Study VC leaderboard (monthly by default, add `week` for weekly) |
| `-lb -focus` | Focus session leaderboard — total focus time and session count |
| `-focus` | Opens a duration picker (30/45/60/90/120 min) to start a focus session. Picker expires after 2 minutes |
| `-dnd <reason>` | Sets you as DND — adds `[DND]` to your nickname, bot replies when you're mentioned. Clears automatically on your next message |
| `-updateroles` | Admin only — recalculates and reassigns tier roles for all users based on current month's hours |

### Voice Channel Tracking
- Automatically records time spent in study voice channels
- Assigns `[DND]` nickname prefix while in a focus session
- Warns users in camera-required channels after 8 minutes without camera/screenshare; moves them to AFK channel after 4 more minutes

### Tier System (monthly hours)

| Tier | Hours |
|---|---|
| Legend | 200+ |
| Voyager | 175–200 |
| Expedition | 140–175 |
| Pioneer | 100–140 |
| Cartographer | 75–100 |
| Navigator | 50–75 |
| Trailblazer | 30–50 |
| Wayfarer | 16–30 |
| Pathfinder | 8–16 |
| Scout | 3–8 |
| Wanderer | 0.5–3 |

Roles are assigned automatically when you run `-me` or when an admin runs `-updateroles`.

---

## Tech Stack

- **Discord.js v14** — bot framework
- **TypeScript** — compiled with `tsc`
- **Prisma** — ORM for PostgreSQL
- **PostgreSQL 16** — database
- **pnpm workspaces** — monorepo
- **Docker** — deployment via `docker compose`

---

## Project Structure

```
study-yap-bot/
├── apps/
│   └── bot/
│       └── src/
│           ├── index.ts              # Entry point, event wiring
│           ├── client.ts             # Discord client factory
│           ├── afk.ts                # DND state management
│           ├── botStatus.ts          # "X people studying" status updater
│           ├── recovery.ts           # Startup reconciliation (stale sessions, pickers)
│           ├── commands/             # Slash commands (/focus, /leaderboard, /mystats)
│           ├── handlers/
│           │   ├── prefix.ts         # Prefix command handler (- commands)
│           │   ├── interactions.ts   # Button interaction handler
│           │   ├── voiceState.ts     # VC join/leave tracking
│           │   └── guild.ts          # Guild create/delete
│           └── focus/
│               ├── stats.ts          # Leaderboard and stats queries
│               ├── focusStats.ts     # Focus session leaderboard queries
│               ├── roles.ts          # Tier role assignment
│               ├── nickname.ts       # [DND] nickname logic
│               ├── session.ts        # Focus session DB operations
│               ├── participants.ts   # Focus participant DB operations
│               ├── timer.ts          # Session end scheduling
│               └── breaks.ts         # Break suggestions
└── packages/
    └── db/
        ├── prisma/
        │   └── schema.prisma         # Database schema
        └── src/
            └── index.ts              # Prisma client export
```

---

## Environment Variables

Create `.env` in the project root (or in the deploy directory on the VM):

```env
DISCORD_TOKEN=        # Bot token from discord.com/developers/applications
DISCORD_CLIENT_ID=    # Application ID
DATABASE_URL=         # PostgreSQL connection string
```

For Docker deployment the `DATABASE_URL` is set directly in `docker-compose.yml`:
```
postgresql://yap:yap@postgres:5432/yap
```

---

## Database Schema

**`VcSession`** — one row per voice channel join/leave
- `userId`, `channelId`, `joinedAt`, `leftAt`, `durationSecs`
- `leftAt: null` means the session is still open (user is in VC)

**`FocusSession`** — a timed focus session created via `-focus`
- `guildId`, `channelId`, `ownerId`, `durationMins`, `status` (LOBBY/ACTIVE/DONE/CANCELLED)
- `startedAt`, `endedAt`, `completedNaturally`

**`FocusParticipant`** — join table for users in a focus session
- `sessionId`, `userId`, `joinedAt`, `leftAt`, `minutesFocused`, `originalNickname`

**`User`** — Discord user record
- `id`, `username`, `avatar`

**`Guild`** — Discord guild record
- `id`, `name`, `joinedAt`

---

## Local Development

**Prerequisites:** Node.js 20+, pnpm, PostgreSQL

```bash
# Install dependencies
pnpm install

# Set up .env
cp .env.example .env
# Fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, DATABASE_URL

# Run migrations
pnpm --filter @yap/db exec prisma migrate deploy

# Build and run
pnpm --filter @yap/bot build
pnpm --filter @yap/bot start
```

---

## Deployment (Oracle Cloud VM)

### Build and push image

Requires Colima (Mac) or Docker Desktop with buildx:

```bash
# Build for linux/amd64 (Oracle VM is AMD64)
docker buildx build --platform linux/amd64 \
  -t ghcr.io/kinjal0007/study-yap-bot:latest \
  --push .
```

### First-time VM setup

```bash
# Install Docker
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable docker && sudo systemctl start docker
sudo usermod -aG docker ubuntu
newgrp docker

# Create project directory
mkdir -p ~/study-yap-bot && cd ~/study-yap-bot
```

Create `docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: yap
      POSTGRES_PASSWORD: yap
      POSTGRES_DB: yap
    volumes:
      - postgres_data:/var/lib/postgresql/data
  bot:
    image: ghcr.io/kinjal0007/study-yap-bot:latest
    restart: unless-stopped
    depends_on:
      - postgres
    env_file: .env
    environment:
      DATABASE_URL: postgresql://yap:yap@postgres:5432/yap
volumes:
  postgres_data:
```

Create `.env` with your Discord credentials, then:
```bash
docker compose pull && docker compose up -d
```

### Deploy updates

```bash
# From local machine — build, push, then pull on VM
docker buildx build --platform linux/amd64 -t ghcr.io/kinjal0007/study-yap-bot:latest --push .

# On VM (or via SSH)
cd ~/study-yap-bot && docker compose pull && docker compose up -d
```

### SSH access

```bash
ssh -i ~/path/to/oracle-vm-key ubuntu@<vm-ip>
```

### Check logs

```bash
docker compose logs --tail=50 bot
docker compose logs --tail=50 postgres
```
