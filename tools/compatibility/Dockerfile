FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS node
FROM rust:1.98-bookworm@sha256:93ce27a88655056a51dbdd8f5f2d7ddc071c7b0070fb288a37b5a285fc83971e AS qualification
COPY --from=node /usr/local /usr/local
# npm 10 Arborist crashes on Vitest optional development peers.
RUN npm install --global npm@11.21.0 --ignore-scripts --no-audit --no-fund
RUN rustup target add wasm32-unknown-unknown \
 && rustup component add clippy rustfmt \
 && cargo install wasm-pack --version 0.13.1 --locked
WORKDIR /source
COPY . .
ARG OAID_SOURCE_SHA
ENV OAID_SOURCE_SHA=$OAID_SOURCE_SHA
ENV NEXT_TELEMETRY_DISABLED=1
RUN cd crates/openagent-crypto-wasm \
 && cargo fmt --all -- --check \
 && cargo clippy --locked --all-targets --all-features \
 && cargo test --locked --all-features \
 && node scripts/build-wasm.mjs \
 && cargo run --locked --example mint_act --quiet > scripts/act_fixture.hex \
 && node scripts/smoke-test.mjs
RUN node tools/compatibility/verify.mjs
RUN cd deploy && npm ci --ignore-scripts --no-audit --no-fund \
 && npm run typecheck && npm test && npm run build:node \
 && npm run build:worker && npm run test:worker \
 && npm run build:vercel && npm run test:vercel
FROM scratch AS evidence
COPY --from=qualification /source/.compatibility-artifacts /compatibility
