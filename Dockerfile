# Build Observi from source into a minimal image.
#   docker build -t observi .
# Releases publish prebuilt multi-arch images: ghcr.io/mdenizay/observi

# ---- web UI ------------------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /src/web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

# ---- server (static musl binary) -------------------------------------------
FROM rust:1-alpine AS server
RUN apk add --no-cache build-base cmake perl
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src/ src/
COPY --from=web /src/web/dist web/dist
RUN cargo build --release --locked && strip target/release/observi
# Data dir owned by the distroless "nonroot" user (65532), copied below.
RUN mkdir -p /data && chown 65532:65532 /data

# ---- runtime ----------------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /src/target/release/observi /usr/local/bin/observi
COPY --from=server --chown=65532:65532 /data /data
ENV OBSERVI_DB=/data/observi.db \
    OBSERVI_LISTEN=0.0.0.0:3001 \
    OBSERVI_UPDATER=docker
VOLUME ["/data"]
EXPOSE 3001
USER nonroot
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["/usr/local/bin/observi", "health"]
ENTRYPOINT ["/usr/local/bin/observi"]
CMD ["serve"]
