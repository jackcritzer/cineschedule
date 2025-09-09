# syntax=docker/dockerfile:1

# ---- base ----
FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl ca-certificates wget
# Optional: useful if you ever use pnpm/yarn
RUN corepack enable

# ---- deps (installs dev deps too) ----
FROM base AS deps
ENV NODE_ENV=development
COPY package*.json ./
RUN npm ci

# ---- dev stage (hot reload for local DX) ----
FROM deps AS dev
WORKDIR /app
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---- build (compile TS, generate Prisma) ----
FROM deps AS builder
WORKDIR /app
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate
RUN npm run build

# ---- production runner (lean) ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install needed tools while root
RUN apk add --no-cache openssl ca-certificates wget

# Copy manifests and install prod deps as root
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Bring compiled app & prisma artifacts; set ownership to 'node'
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=node:node /app/node_modules/@prisma ./node_modules/@prisma

# Drop privileges for runtime
USER node

# Health + port (Render sets PORT; default to 3000)
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/v1/health || exit 1

CMD ["node", "dist/index.js"]