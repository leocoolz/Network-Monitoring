FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY public ./public
COPY vite.config.js ./
RUN npm ci && npm run build && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY migrations ./migrations
COPY --from=dependencies /app/dist ./dist
COPY src ./src
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
