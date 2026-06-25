FROM node:22-alpine
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@10.32.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bot/package.json ./apps/bot/
COPY packages/db/package.json ./packages/db/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @yap/db db:generate
RUN pnpm --filter @yap/db build
RUN pnpm --filter @yap/bot build

ENV NODE_ENV=production

CMD ["sh", "-c", "node_modules/.pnpm/node_modules/.bin/prisma migrate deploy --schema=packages/db/prisma/schema.prisma && node apps/bot/dist/index.js"]
