# syntax=docker/dockerfile:1.6
# Studiio — Dockerfile multi-stage pour déploiement Coolify/Hetzner.
# Basé sur le template officiel Next.js standalone.

# ── Stage 1 : Install deps ────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# ffmpeg-static a besoin de build tools côté libc (Debian slim = glibc)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --include=optional

# ── Stage 2 : Build ───────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Vars d'env nécessaires au build (Supabase URL etc.) — placeholders OK,
# Coolify injectera les vraies au runtime.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder

RUN npm run build

# ── Stage 3 : Runner ──────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app

# ffmpeg natif pour les conversions vidéo (cron/publish, convert/to-mp4)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# User non-root (sécurité)
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# Copy de l'output standalone Next.js
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# Healthcheck via Node.js (fetch global dispo en Node 20, pas besoin de wget/curl)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" || exit 1

CMD ["node", "server.js"]
