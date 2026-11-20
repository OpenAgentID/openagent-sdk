FROM node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS build
WORKDIR /app/sdks/typescript
COPY sdks/typescript/package.json sdks/typescript/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY sdks/typescript/src ./src
COPY sdks/typescript/tsconfig.json sdks/typescript/tsup.config.ts sdks/typescript/tsup.browser.config.ts ./
COPY sdks/typescript/scripts ./scripts
COPY sdks/typescript/LICENSE-APACHE sdks/typescript/LICENSE-MIT ./
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS runtime
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
