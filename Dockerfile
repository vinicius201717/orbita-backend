FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y openssl --no-install-recommends && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run prisma:generate && npm run build
FROM build AS migration
CMD ["npm", "run", "db:migrate"]
FROM build AS production-dependencies
RUN npm prune --omit=dev
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y openssl --no-install-recommends && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir -p /app/.data/documents && chown -R node:node /app/.data
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
