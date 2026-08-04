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

# ── Rendu serveur (Remotion) ──────────────────────────────────────────────
# Le bundler Remotion compile la composition AU RUNTIME, depuis
# `process.cwd()/remotion/index.tsx` — soit `/app/remotion/index.tsx` ici.
#
# L'output standalone de Next ne contient que ce que le SERVEUR importe. La
# composition, elle, n'est jamais importee par du code serveur : elle est
# bundlee a la demande. Rien de ce qu'elle touche n'est donc trace, et il faut
# le copier a la main. Sans ces lignes, tout rendu serveur echoue — et
# seulement lui : la creation manuelle passe par le compositeur du navigateur,
# ce qui explique que la panne soit restee invisible.
COPY --from=builder --chown=nextjs:nodejs /app/remotion ./remotion
COPY --from=builder --chown=nextjs:nodejs /app/remotion.config.ts ./remotion.config.ts
# `src/` EN ENTIER. Next en trace bien quelques fichiers, mais seulement ceux
# que le serveur importe : sur les composants PARTAGES avec la composition
# (`SequenceCards`, `SequenceTitle`, `CardIcon`, `designSpec`…), un seul
# arrivait. Un `src/` a moitie present est le pire des cas — le bundling
# echoue sur un fichier different a chaque changement de code.
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
# Lu par le chargeur TypeScript du bundler.
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
# ⚠️ TOUT LE SCOPE `@remotion`, ET PAS SEULEMENT LES PAQUETS IMPORTES.
#
# Deux raisons, dont la seconde ne se devine pas :
#
# 1. `@remotion/transitions`, `shapes`, `paths` ne sont importes QUE par la
#    composition. Aucun code serveur ne les importe, donc le tracage de Next
#    ne les voit pas et ne les embarque pas.
# 2. Le tracage MUTILE les paquets qu'il garde : de
#    `@remotion/compositor-*`, il ne conserve que `index.js` et
#    `package.json` — les BINAIRES natifs (`remotion`, `ffmpeg`, `ffprobe`,
#    ~34 Mo) sont supprimes. Le dossier existe donc dans l'image, ce qui
#    donne l'illusion que la dependance est la, et le rendu echoue plus tard
#    sur `ENOENT … /compositor-linux-x64-gnu/remotion`.
#
# Copier le scope entier (~55 Mo) couvre les deux cas, et couvrira aussi les
# paquets ajoutes plus tard sans qu'il faille y repenser.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@remotion ./node_modules/@remotion
# Les icones des cartes. Importe par `CardIcon`, cote composition seulement.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/lucide-react ./node_modules/lucide-react

USER nextjs

EXPOSE 3000

# Healthcheck via Node.js (fetch global dispo en Node 20, pas besoin de wget/curl)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" || exit 1

CMD ["node", "server.js"]
