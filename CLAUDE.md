# CLAUDE.md — Guide pour nouveau developpeur

Ce fichier est un prompt complet pour qu'un nouveau developpeur (ou un agent IA) puisse comprendre et travailler sur le projet Studiio sans poser de questions.

---

## Qu'est-ce que Studiio ?

Studiio (https://studiio.pro) est une plateforme SaaS de creation de videos et d'infographies animees pour les reseaux sociaux. L'utilisateur cree du contenu visuel (infographies, videos), ajoute de l'audio, planifie la publication sur un calendrier, et publie automatiquement sur Instagram, TikTok, Facebook et YouTube.

Le public cible est constitue de createurs de contenu, coachs fitness, entrepreneurs et marques qui veulent produire du contenu social video de maniere semi-automatisee.

---

## Stack technique

| Couche | Technologie | Version |
|--------|-------------|---------|
| Framework | Next.js (App Router) | 14.2 |
| Language | TypeScript (strict) | 5.x |
| Styling | Tailwind CSS | 3.x |
| Database | Supabase (PostgreSQL) | - |
| Storage | Supabase Storage | - |
| Auth | NextAuth v5 beta | 5.0.0-beta.19 |
| Paiements | Stripe | v15 |
| Video (client) | Canvas + MediaRecorder | - |
| Video (server) | Remotion | 4.0.441 |
| Audio | mp4-muxer, webm-muxer, FFmpeg WASM | - |
| TTS | msedge-tts | 2.x |
| Email | Resend (REST) | - |
| i18n | next-intl | 4.x |
| Deploiement | Vercel | auto-deploy main |
| Validation | Zod | 3.x |

**Path alias** : `@/*` mappe vers `./src/*` (configure dans tsconfig.json).

---

## Comment lancer le projet

```bash
git clone git@github.com:sambassi/studiio.git
cd studiio
npm install
cp .env.example .env.local    # remplir toutes les variables
npm run dev                    # http://localhost:3000
```

Le build (`npm run build`) a `ignoreBuildErrors: true` et `ignoreDuringBuilds: true` dans `next.config.js` — le projet compile meme avec des erreurs TS/ESLint. C'est intentionnel pour le moment.

---

## Architecture — Les 6 modules principaux

### 1. Infographie (creation de contenu visuel)

**Fichiers** : `src/app/dashboard/infographie/page.tsx`, `src/lib/video-composer.ts`, `src/lib/smart-content.ts`

L'utilisateur choisit un theme (fitness, sante, nutrition...), un template, et le systeme genere 5 cartes d'infographie via `smart-content.ts` (base de connaissances locale, pas d'API externe). Le branding (logo, couleurs, CTA) est configurable via `BrandingPanel.tsx`.

Le compositeur video (`video-composer.ts`, 839 lignes) est le coeur du systeme. Il dessine chaque frame sur un Canvas 2D et encode via MediaRecorder. Deux modes :

- **Mode Fast** (sans audio) : `captureStream(0)` + `requestFrame()` par batch de 4. Rendu ~10x temps reel. Produit du WebM (VP9 ou VP8).
- **Mode Normal** (avec audio) : `captureStream(fps)` + AudioContext pour mixer musique et voix. Rendu temps reel.

**ATTENTION** : Chrome produit des MP4 corrompus (metadonnees temporelles cassees) en mode fast avec MediaRecorder. C'est pourquoi le compositeur est configure pour preferer **WebM** (VP9/VP8). Ne jamais remettre MP4 en priorite pour le mode fast.

**Export** : Le fichier genere est uploade sur Supabase Storage (bucket `media`) via signed URL, et un post est cree dans `scheduled_posts` avec les metadonnees (sequences, branding, URLs).

### 2. Studio Son (audio)

**Fichier** : `src/app/dashboard/audio-studio/page.tsx`

Permet d'ajouter musique + voix (TTS ou upload) sur les videos. Preview en temps reel avec `requestAnimationFrame` (~60fps). Supporte le mode batch (plusieurs videos a la fois).

L'export recompose entierement la video avec l'audio embarque dans le fichier.

**Pieges connus** :
- L'autoplay video dans Chrome necessite l'attribut `muted`.
- La timeline utilise `requestAnimationFrame` et non `timeupdate` (qui ne donne que ~4fps).
- Les classes Tailwind arbitraires (`aspect-[9/16]`) sont purgees en production — utiliser des inline styles.

### 3. Calendrier IA (planification et preview)

**Fichier** : `src/app/dashboard/calendar/page.tsx`

Calendrier mensuel avec preview modale du montage. Le montage cycle entre les sequences (intro → cards → video → CTA) avec des transitions d'opacite de 800ms.

**Points critiques** :
- Le `<video autoPlay>` ne se relance PAS quand l'opacite CSS change. Il faut appeler `vid.play()` explicitement dans un `useEffect` qui watch `infoSeqIndex`.
- Les fichiers video casses (readyState reste a 0 apres 3s) sont detectes et leur sequence est automatiquement sautee.
- Le video element doit avoir `muted` en dur dans le JSX pour respecter la politique autoplay de Chrome. Le unmute se fait via un bouton utilisateur.
- Les erreurs `AbortError` (play interrupted by pause) sont normales quand une video ne charge pas — elles sont silencees dans le catch.

**Agent IA** : Peut generer automatiquement du contenu pour 7, 14 ou 30 jours via `/api/agent/generate`.

### 4. Publication sociale

**Fichiers** : `src/app/dashboard/social/page.tsx`, `src/lib/social/token-refresh.ts`, `src/app/api/social/*`, `src/app/api/cron/publish/route.ts`

Publication vers Instagram, TikTok, Facebook, YouTube. Les tokens OAuth sont rafraichis automatiquement avec un buffer de 5 min avant expiration.

Le cron job (`/api/cron/publish`) tourne sur Vercel, verifie le Bearer token (`CRON_SECRET`), recupere les posts dont l'heure est passee (timezone Europe/Paris), et publie.

### 5. Systeme de credits et facturation

**Fichiers** : `src/lib/credits/system.ts`, `src/lib/stripe/constants.ts`, `src/lib/stripe/client.ts`

Trois plans : Starter (29.99 EUR/mois, 300 credits), Pro (79.99 EUR, 1000), Enterprise (299.99 EUR, 5000). Packs one-shot : 50/150/500 credits.

Cout par rendu : 10 credits (reel 9:16), 15 credits (TV 16:9).

Chaque deduction est loguee dans `credit_transactions` avec un `type` (render, purchase, bonus, refund, subscription).

### 6. Administration

**Fichiers** : `src/app/admin/*`, `src/app/api/admin/*`, `src/lib/admin.ts`

Dashboard admin avec stats, gestion users/videos/paiements, CMS landing page, editeur CGU, emails en masse, audit trail.

Les admins sont definis par email dans `src/lib/admin.ts` : `contact.artboost@gmail.com` et `bassicustomshoes@gmail.com`.

---

## Arborescence complete des fichiers

```
src/
├── app/
│   ├── layout.tsx              # Root layout (Inter font, dark theme)
│   ├── providers.tsx           # SessionProvider + I18nProvider
│   ├── page.tsx                # Landing page marketing
│   ├── privacy/page.tsx        # Politique de confidentialite
│   ├── terms/page.tsx          # CGU
│   ├── auth/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── dashboard/
│   │   ├── layout.tsx          # Sidebar + navbar
│   │   ├── page.tsx            # Accueil stats
│   │   ├── creator/page.tsx    # Creation video
│   │   ├── infographic/page.tsx
│   │   ├── infographie/page.tsx # Page principale infographies
│   │   ├── audio-studio/page.tsx
│   │   ├── calendar/page.tsx
│   │   ├── library/page.tsx
│   │   ├── social/page.tsx
│   │   ├── objectives/page.tsx
│   │   └── billing/page.tsx
│   ├── admin/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── users/page.tsx
│   │   ├── videos/page.tsx
│   │   ├── payments/page.tsx
│   │   ├── subscriptions/page.tsx
│   │   ├── emails/page.tsx
│   │   ├── landing/page.tsx
│   │   ├── settings/page.tsx
│   │   ├── terms/page.tsx
│   │   └── logs/page.tsx
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── videos/              # CRUD + duplicate/export/repost
│       ├── render/              # render, batch, status
│       ├── posts/               # CRUD posts calendrier
│       ├── credits/             # balance, purchase
│       ├── stripe/              # checkout, portal, webhook
│       ├── social/              # connect, callback, publish, settings
│       ├── content/             # generate, ai-generate
│       ├── agent/generate       # Agent IA calendrier
│       ├── upload/              # media, signed-url
│       ├── cron/                # publish, debug
│       ├── tts/edge             # Text-to-Speech
│       ├── pexels/              # Recherche images
│       ├── user/                # profile, objectives
│       ├── admin/               # stats, users, videos, payments, etc.
│       ├── proxy-media          # Proxy CORS
│       ├── terms                # CGU
│       └── data-deletion        # Facebook compliance
├── components/
│   ├── BrandingPanel.tsx
│   ├── LanguageSelector.tsx
│   ├── admin/                  # ActivityFeed, PaymentTable, RevenueChart, etc.
│   ├── billing/                # CreditsDisplay, PricingCards
│   ├── dashboard/              # RecentVideos, StatsCard
│   ├── layout/                 # Navbar, Sidebar, AdminSidebar
│   └── ui/                     # Badge, Button, Card, Input, Modal, Select, Table
├── lib/
│   ├── db/supabase.ts          # supabase (client) + supabaseAdmin (server)
│   ├── auth/config.ts          # NextAuth config
│   ├── stripe/client.ts        # Stripe helpers
│   ├── stripe/constants.ts     # Plans et prix
│   ├── credits/system.ts       # Credit system
│   ├── video-composer.ts       # Composition video (839 lignes)
│   ├── render/worker.ts        # Remotion worker
│   ├── storage/upload.ts       # Upload Supabase
│   ├── smart-content.ts        # Generation contenu local
│   ├── clip-detector.ts        # Detection clips
│   ├── social/token-refresh.ts # Token refresh OAuth
│   ├── tts/edge-tts-client.ts  # TTS (14 voix)
│   ├── email/resend.ts         # Client Resend
│   ├── email/templates.ts      # Templates HTML
│   ├── email/notifications.ts  # Fire-and-forget
│   ├── admin.ts                # isAdmin, audit log
│   ├── hooks/useBranding.ts
│   ├── i18n-content.ts
│   └── types/
│       ├── database.ts         # User, Video, Post, etc.
│       └── api.ts              # Request/Response types
├── i18n/
│   ├── config.ts               # fr, en, de
│   ├── client.ts
│   └── provider.tsx
└── middleware.ts                # Protection routes
```

---

## Base de donnees — Tables Supabase

| Table | Role | Colonnes importantes |
|-------|------|---------------------|
| `users` | Comptes | `id`, `email`, `name`, `credits` (int), `plan` (free/starter/pro/enterprise) |
| `videos` | Videos | `id`, `user_id`, `title`, `format` (reel/tv), `status` (draft/rendering/completed/published/failed), `video_url`, `metadata` |
| `scheduled_posts` | Posts calendrier | `id`, `user_id`, `title`, `caption`, `media_url`, `media_type` (video/image), `platforms[]`, `scheduled_date`, `scheduled_time`, `status` (draft/scheduled/published/failed), `metadata` (JSON) |
| `social_accounts` | Comptes OAuth | `id`, `user_id`, `platform` (instagram/tiktok/facebook/youtube), `access_token`, `refresh_token`, `expires_at` |
| `subscriptions` | Abonnements | `id`, `user_id`, `plan`, `status`, `stripe_subscription_id`, `current_period_end` |
| `credit_transactions` | Credits | `id`, `user_id`, `amount`, `type` (purchase/render/refund/bonus/subscription) |
| `render_jobs` | Rendus | `id`, `status` (queued/rendering/completed/failed), `progress`, `output_url` |
| `objectives` | Objectifs | `id`, `user_id`, `platform`, `target_audience`, `tone` |
| `audit_log` | Admin | `id`, `admin_email`, `action`, `details` |

**Deux clients Supabase** :
```typescript
import { supabase } from '@/lib/db/supabase';       // client (RLS enforced)
import { supabaseAdmin } from '@/lib/db/supabase';  // server (RLS bypasse)
```

---

## Upload de fichiers

Les fichiers sont uploades via **signed URLs** pour contourner la limite de 4.5MB de Vercel :

```
1. Client appelle POST /api/upload/signed-url
2. API retourne une URL signee Supabase
3. Client fait un PUT direct vers Supabase Storage (pas de limite de taille)
4. Client sauvegarde l'URL publique dans les metadonnees du post
```

**Buckets** : `videos`, `images`, `audio`, `media`

Ne jamais uploader des fichiers video via les routes API normales (limite Vercel).

---

## Patterns de code importants

### Fire-and-forget (emails)

```typescript
// Ne JAMAIS await un email dans un flux critique
sendEmailSilent({ to, subject, html }); // pas de await, pas de try/catch
```

### Dynamic imports (Remotion)

```typescript
// Remotion est externalise via webpack. Toujours importer dynamiquement.
const { bundle } = await import('@remotion/bundler');
const { renderMedia } = await import('@remotion/renderer');
```

### VideoComposer — Interface

```typescript
const blob = await composeVideo({
  width: 1080,
  height: 1920,       // 9:16
  title: "Mon titre",
  subtitle: "Sous-titre",
  cards: [{ icon: "...", title: "Card", description: "...", value: "95%" }],
  posterUrl: "https://...",
  videoUrl: "https://...",   // optionnel
  logoUrl: "https://...",    // optionnel
  musicUrl: "https://...",   // optionnel — active le mode normal
  voiceUrl: "https://...",   // optionnel
  accentColor: "#7C3AED",
  onProgress: (percent, stage) => console.log(percent, stage),
});
```

Si `musicUrl` et `voiceUrl` sont absents → mode fast. Sinon → mode normal.

### Metadata d'un post (scheduled_posts.metadata)

```json
{
  "sequences": {
    "order": ["intro", "cards", "video", "cta"],
    "durations": { "intro": 5, "cards": 8, "video": 10, "cta": 7 }
  },
  "branding": {
    "logoUrl": "...",
    "accentColor": "#7C3AED",
    "ctaText": "Decouvrir",
    "watermarkText": "Afroboost"
  },
  "videoUrl": "https://supabase.../montage.webm",
  "posterUrl": "https://supabase.../poster.jpg",
  "musicUrl": "https://...",
  "voiceUrl": "https://...",
  "format": "reel",
  "cards": [{ "icon": "...", "title": "...", "description": "...", "value": "..." }]
}
```

---

## Variables d'environnement

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...

# NextAuth
AUTH_SECRET=random-secret-32-chars
NEXTAUTH_URL=https://studiio.pro
NEXT_PUBLIC_APP_URL=https://studiio.pro
AUTH_TRUST_HOST=true

# OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
FACEBOOK_CLIENT_ID=123456
FACEBOOK_CLIENT_SECRET=abc123
TIKTOK_CLIENT_KEY=xxx
TIKTOK_CLIENT_SECRET=xxx
YOUTUBE_CLIENT_ID=xxx
YOUTUBE_CLIENT_SECRET=xxx

# Stripe (EUR)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxx
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Email
RESEND_API_KEY=re_xxx
RESEND_FROM=Studiio <noreply@studiio.pro>

# Admin / Cron
ADMIN_SECRET_KEY=xxx
ADMIN_EMAIL=contact.artboost@gmail.com
CRON_SECRET=xxx
```

---

## Pieges et erreurs frequentes

### 1. Video illisible dans le Calendar preview

**Symptome** : Le `<video>` a un `readyState` qui reste a 0 indefiniment.
**Cause** : Le fichier a ete genere en MP4 par le MediaRecorder en mode fast. Chrome corrompt les metadonnees temporelles.
**Solution** : Le compositeur doit produire du **WebM** (VP9/VP8). Verifier que `video-composer.ts` a les mimeTypes WebM en priorite.

### 2. AbortError: play() interrupted by pause()

**Symptome** : Dizaines de warnings dans la console.
**Cause** : `play()` retourne une Promise. Si `pause()` est appele avant que la Promise resolve, Chrome leve un AbortError.
**Solution** : Toujours verifier `vid.readyState > 0` avant d'appeler `play()`. Silencer le `.catch()`.

### 3. Autoplay bloque par Chrome

**Symptome** : La video ne demarre pas automatiquement.
**Cause** : Politique Chrome — l'autoplay ne fonctionne que si la video est `muted`.
**Solution** : Toujours mettre `muted` en dur dans le JSX. Proposer un bouton pour unmute.

### 4. Classes Tailwind purgees en production

**Symptome** : Le layout est casse en prod mais fonctionne en dev.
**Cause** : Les classes arbitraires (`aspect-[9/16]`, `w-[calc(100%-20px)]`) sont purgees par Tailwind en prod.
**Solution** : Utiliser des inline styles pour les valeurs dynamiques.

### 5. Upload echoue (payload too large)

**Symptome** : Erreur 413 ou timeout sur l'upload.
**Cause** : Vercel limite les payloads API a 4.5MB.
**Solution** : Utiliser les signed URLs (`/api/upload/signed-url`) pour uploader directement vers Supabase.

### 6. Remotion crash au build

**Symptome** : Erreur webpack avec `@remotion/*`.
**Cause** : Remotion n'est pas compatible avec le bundler webpack de Next.js.
**Solution** : Les packages sont externalises dans `next.config.js`. Toujours utiliser des `import()` dynamiques.

### 7. Token social expire

**Symptome** : Publication echoue avec 401/403.
**Cause** : Le token OAuth a expire.
**Solution** : `token-refresh.ts` gere le refresh automatique avec un buffer de 5 min. Verifier que `refresh_token` est bien stocke dans `social_accounts`.

---

## Conventions de code

- **Langue du code** : Variables et fonctions en anglais, UI et contenu en francais
- **Imports** : Toujours utiliser `@/` (pas de chemins relatifs profonds)
- **Types** : Definis dans `src/lib/types/database.ts` et `src/lib/types/api.ts`
- **API routes** : Pattern REST, NextResponse, auth via `getServerSession()`
- **Composants UI** : Dans `src/components/ui/` (Button, Card, Modal, etc.)
- **Couleurs** : Primary `#7C3AED` (purple), Accent `#EC4899` (pink), Dark `#0A0A0F`
- **Font** : Inter (Google Fonts)
- **Theme** : Dark mode uniquement

---

## Deploiement

Chaque push sur `main` declenche un auto-deploy Vercel. Le build prend ~45-60s. Le projet est sur le plan Pro Vercel (`maxDuration: 300s` pour les fonctions).

**Domaine** : studiio.pro
**Vercel project** : `studiio-saas-app` sous `bassicustomshoes-3610s-projects`

---

## Pour commencer a contribuer

1. Lire ce fichier en entier
2. Lire `README.md` pour la reference des routes API
3. Explorer `src/lib/types/database.ts` pour comprendre les types
4. Explorer `src/app/dashboard/` pour les pages principales
5. Le fichier le plus complexe est `src/lib/video-composer.ts` (839 lignes) — le lire attentivement avant de toucher au pipeline video
6. Tester en local avec `npm run dev` et verifier la console navigateur pour les warnings
