# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app
# Optional but nice
RUN corepack enable

# Install deps (dev included for dev stage)
FROM base AS deps
COPY package*.json ./
RUN npm ci

# --- Dev image: hot reload via ts-node-dev
FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# --- Build for prod
FROM deps AS build
COPY . .
RUN npm run build

# --- Production runtime
FROM node:20-alpine AS prod
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY package*.json ./
RUN npm ci --omit=dev
EXPOSE 3000
CMD ["node", "dist/index.js"]