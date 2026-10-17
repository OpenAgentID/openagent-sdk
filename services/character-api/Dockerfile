FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
WORKDIR /app/sdks/typescript
COPY sdks/typescript/package.json sdks/typescript/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY sdks/typescript/src ./src
COPY sdks/typescript/tsconfig.json sdks/typescript/tsup.config.ts sdks/typescript/tsup.browser.config.ts ./
COPY sdks/typescript/scripts ./scripts
COPY sdks/typescript/LICENSE-APACHE sdks/typescript/LICENSE-MIT ./
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app/sdks/typescript/dist ./sdks/typescript/dist
COPY --from=build --chown=node:node /app/sdks/typescript/node_modules ./sdks/typescript/node_modules
COPY --from=build --chown=node:node /app/sdks/typescript/package.json ./sdks/typescript/package.json
COPY --from=build --chown=node:node /app/sdks/typescript/LICENSE-APACHE /app/sdks/typescript/LICENSE-MIT ./sdks/typescript/
COPY --chown=node:node services/character-api/server.mjs services/character-api/demo.html services/character-api/demo.js services/character-api/demo.css ./services/character-api/
USER node
EXPOSE 8080
CMD ["node", "services/character-api/server.mjs"]
