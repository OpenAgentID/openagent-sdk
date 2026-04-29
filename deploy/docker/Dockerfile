# OpenAgent Auth Server — minimal Node.js container
# Build: docker build -t openagent-auth .
# Run:   docker run -p 3100:3100 -e OPENAGENT_PARENT_DID=did:oas:l1fe:hmr:alice openagent-auth

FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --ignore-scripts
COPY server.ts ./
RUN npx tsup server.ts --format cjs --out-dir dist --target node20

FROM node:20-alpine AS runner

RUN addgroup --system --gid 1001 openagent && \
    adduser --system --uid 1001 openagent

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

USER openagent

ENV PORT=3100
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3100/health || exit 1

CMD ["node", "dist/server.cjs"]
