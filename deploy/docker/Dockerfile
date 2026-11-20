# Build from the deploy/ directory: docker build -f docker/Dockerfile -t openagent-receiver .
FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY aws-lambda/package.json aws-lambda/package.json
COPY cloudflare-worker/package.json cloudflare-worker/package.json
COPY docker/package.json docker/package.json
COPY vercel-edge/package.json vercel-edge/package.json
# Ignore workspace prepare hooks: this container does not build the Workers adapter.
RUN npm ci --ignore-scripts
COPY shared ./shared
COPY docker ./docker
RUN npm run build -w openagent-docker
RUN npm prune --omit=dev --ignore-scripts

FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5
WORKDIR /app
RUN addgroup -S openagent && adduser -S -G openagent openagent
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/docker/dist ./dist
COPY --from=builder /app/docker/package.json ./package.json
USER openagent
ENV PORT=3100
ENV HOST=0.0.0.0
ENV NODE_ENV=production
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q --spider http://localhost:3100/health || exit 1
CMD ["node", "dist/server.js"]
