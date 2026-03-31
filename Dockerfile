# =============================================================================
# h4kscape-server — RuneScape 2 (2004Scape) Game Server Docker Image
# =============================================================================

FROM node:22-bookworm-slim

# Install Java 17 (needed for cache packing tools) + tini for proper PID 1
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        openjdk-17-jre-headless \
        tini \
        curl \
    && rm -rf /var/lib/apt/lists/*

RUN node --version && java -version

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install tsx prisma prisma-kysely

# Copy full server source
COPY . .

# Create persistent directories
RUN mkdir -p /app/data/players/main \
             /app/.db

# Generate Prisma client for SQLite
RUN npx prisma generate --schema prisma/singleworld/schema.prisma

# ── Ports ────────────────────────────────────────────────────
#   80    — HTTP server (game data files, OAuth routes, WebSocket upgrade)
#   43594 — TCP game server (Java client connections)
#   8898  — Prometheus metrics
EXPOSE 80 43594 8898

# ── Volumes ──────────────────────────────────────────────────
#   /app/data/players  — Player save files (persistent across deploys)
#   /app/.db           — SQLite database (persistent across deploys)
VOLUME ["/app/data/players", "/app/.db"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:80/ || exit 1

ENTRYPOINT ["tini", "--"]

CMD ["sh", "-c", "\
    npx prisma migrate deploy --schema prisma/singleworld/schema.prisma && \
    npx tsx src/app.ts \
"]
