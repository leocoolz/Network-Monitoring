FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY public ./public
COPY vite.config.js ./
RUN npm run build

FROM node:22-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm pkg delete scripts.prepare \
    && npm ci --omit=dev \
    && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends iputils-ping ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY migrations ./migrations
COPY --from=build /app/dist ./dist
COPY src ./src
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
