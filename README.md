# Studiio.pro

Plateforme SaaS de creation video IA pour les reseaux sociaux.

**URL production** : https://studiio.pro
**Deploiement** : Vercel (auto-deploy depuis GitHub `main`)
**Repo** : `sambassi/studiio`

---

## Tech Stack

- **Framework** : Next.js 14.2 (App Router)
- **Language** : TypeScript (strict mode, path alias `@/*` → `./src/*`)
- **Styling** : Tailwind CSS (palette : primary `#7C3AED`, accent `#EC4899`, dark `#0A0A0F`)
- **Base de donnees** : Supabase (PostgreSQL + Storage + RLS)
- **Authentification** : NextAuth v5 beta (Google, Facebook) — strategie JWT
- **Paiements** : Stripe v15 (abonnements + packs credits, devise EUR)
- **Composition video** : Canvas + MediaRecorder (client-side) + Remotion 4.0 (server-side)
- **Audio** : mp4-muxer, webm-muxer, FFmpeg WASM
- **TTS** : msedge-tts (14 voix, 5 langues)
- **Emails** : Resend (API REST, templates HTML)
- **i18n** : next-intl (FR, EN, DE — defaut : FR)
- **Validation** : Zod
- **Tests** : Playwright
- **Deploiement** : Vercel (auto-deploy, `maxDuration: 300s` pour le render)

---

## Architecture du projet

```
src/
├── app/
│   ├── layout.tsx              # Root layout (Inter font, dark theme, providers)
│   ├── providers.tsx           # SessionProvider + I18nProvider
│   ├── middleware.ts           # Protection routes /dashboard/* et /admin/*
│   ├── page.tsx                # Landing page marketing
│   ├── privacy/page.tsx        # Politique de confidentialite
│   ├── terms/page.tsx          # CGU
│   ├── auth/
│   │   ├── login/page.tsx      # Connexion OAuth
│   │   └── signup/page.tsx     # Inscription + selection plan
│   ├── dashboard/
│   │   ├── layout.tsx          # Sidebar + navbar dashboard
│   │   ├── page.tsx            # Accueil stats
│   │   ├── creator/page.tsx    # Creation video
│   │   ├── infographic/page.tsx # Infographies (EN)
│   │   ├── infographie/page.tsx # Infographies (FR) — page principale
│   │   ├── audio-studio/page.tsx # Studio Son
│   │   ├── calendar/page.tsx   # Calendrier IA
│   │   ├── library/page.tsx    # Bibliotheque videos
│   │   ├── social/page.tsx     # Reseaux sociaux
│   │   ├── objectives/page.tsx # Objectifs contenu
│   │   └── billing/page.tsx    # Facturation
│   ├── admin/
│   │   ├── layout.tsx          # Sidebar admin
│   │   ├── page.tsx            # Dashboard admin
│   │   ├── users/page.tsx      # Gestion utilisateurs
│   │   ├── videos/page.tsx     # Gestion videos
│   │   ├── payments/page.tsx   # Historique paiements
│   │   ├── subscriptions/      # Abonnements
│   │   ├── emails/             # Emails en masse
│   │   ├── landing/            # CMS landing page
│   │   ├── settings/           # Maintenance, IA, credits
│   │   ├── terms/              # Editeur CGU
│   │   └── logs/               # Audit trail
│   └── api/                    # ~40 routes API (voir section dediee)
├── components/
│   ├── BrandingPanel.tsx       # Panneau branding (logo, couleurs, CTA)
│   ├── LanguageSelector.tsx    # Selecteur FR/EN/DE
│   ├── admin/                  # Composants admin (tables, charts)
│   ├── billing/                # Credits display, pricing cards
│   ├── dashboard/              # Stats cards, recent videos
│   ├── layout/                 # Navbar, Sidebar, AdminSidebar
│   └── ui/                     # Badge, Button, Card, Input, Modal, Select, Table
├── lib/
│   ├── db/supabase.ts          # Clients Supabase (public + admin)
│   ├── auth/config.ts          # Config NextAuth (providers, callbacks)
│   ├── stripe/
│   │   ├── client.ts           # Checkout, portal, webhooks
│   │   └── constants.ts        # Plans, prix, packs credits
│   ├── credits/system.ts       # Systeme de credits (deduct, add, check)
│   ├── video-composer.ts       # Moteur de composition video (Canvas) — 839 lignes
│   ├── render/worker.ts        # Worker Remotion (server-side render)
│   ├── storage/upload.ts       # Upload Supabase Storage (signed URLs)
│   ├── smart-content.ts        # Generation contenu IA (local, pas d'API externe)
│   ├── clip-detector.ts        # Detection de clips video
│   ├── social/token-refresh.ts # Refresh tokens OAuth (YouTube, TikTok, Meta)
│   ├── tts/edge-tts-client.ts  # Text-to-Speech (14 voix)
│   ├── email/
│   │   ├── resend.ts           # Client email Resend
│   │   ├── templates.ts        # Templates HTML (welcome, payment, ban...)
│   │   └── notifications.ts    # Helpers fire-and-forget
│   ├── admin.ts                # Helpers admin (isAdmin, audit log)
│   ├── i18n-content.ts         # Contenu traduit
│   ├── hooks/useBranding.ts    # Hook branding personnalise
│   └── types/
│       ├── database.ts         # Types Supabase (User, Video, Post, etc.)
│       └── api.ts              # Types API (requests, responses)
└── i18n/
    ├── config.ts               # Locales : fr, en, de
    ├── client.ts               # Hook client useTranslation
    └── provider.tsx            # I18nProvider
```

---

## Base de donnees (Supabase)

### Tables principales

| Table | Description | Colonnes cles |
|-------|-------------|---------------|
| `users` | Comptes utilisateurs | `id`, `email`, `name`, `credits`, `plan` (free/starter/pro/enterprise) |
| `videos` | Metadonnees videos | `id`, `user_id`, `title`, `format` (reel/tv), `status` (draft/rendering/completed/published/failed), `video_url` |
| `scheduled_posts` | File de publication | `id`, `user_id`, `title`, `caption`, `media_url`, `media_type`, `platforms[]`, `scheduled_date`, `scheduled_time`, `status`, `metadata` (JSON) |
| `social_accounts` | Comptes OAuth sociaux | `id`, `user_id`, `platform`, `access_token`, `refresh_token`, `expires_at` |
| `subscriptions` | Abonnements Stripe | `id`, `user_id`, `plan`, `status`, `stripe_subscription_id`, `current_period_end` |
| `credit_transactions` | Historique credits | `id`, `user_id`, `amount`, `type` (purchase/render/refund/bonus/subscription), `description` |
| `render_jobs` | Travaux de rendu | `id`, `user_id`, `video_id`, `status`, `progress`, `output_url` |
| `objectives` | Objectifs contenu | `id`, `user_id`, `platform`, `target_audience`, `tone` |
| `agent_plans` | Plans Agent IA | `id`, `user_id` |
| `publishing_history` | Historique publications | `id`, `post_id` |
| `audit_log` | Journal admin | `id`, `admin_email`, `action` |

### Clients Supabase

```typescript
// Client-side (RLS enforced, cle anonyme)
import { supabase } from '@/lib/db/supabase';

// Server-side (RLS bypasse, service key)
import { supabaseAdmin } from '@/lib/db/supabase';
```

### Storage Buckets

| Bucket | Usage |
|--------|-------|
| `videos` | Videos rendues (MP4, WebM) |
| `images` | Posters, thumbnails |
| `audio` | Musiques, voiceovers |
| `media` | Fichiers generiques (rush, montages) |

---

## Routes API

### Authentification et utilisateur

| Route | Methode | Description |
|-------|---------|-------------|
| `/api/auth/[...nextauth]` | GET/POST | NextAuth handlers |
| `/api/user/profile` | GET/PUT | Profil utilisateur |
| `/api/user/objectives` | GET/PUT | Objectifs |

### Videos

| Route | Methode | Description |
|-------|---------|-------------|
| `/api/videos` | GET/POST | Liste / creation video |
| `/api/videos/[id]` | GET/PUT/DELETE | CRUD video individuelle |
| `/api/videos/[id]/duplicate` | POST | Dupliquer |
| `/api/videos/[id]/export` | POST | Exporter |
| `/api/videos/[id]/repost` | POST | Republier |

### Rendu

| Route | Methode | Description |
|-------|---------|-------------|
| `/api/render` | POST | Lancer un rendu video (Remotion, `maxDuration: 300s`) |
| `/api/render/batch` | POST | Rendu batch |
| `/api/render/status` | GET | Statut render job |

### Posts / Calendrier

| Route | Methode | Description |
|-------|---------|-------------|
| `/api/posts` | GET/POST | Liste / creation post |
| `/api/posts/[id]` | GET/PUT/DELETE | CRUD post |
| `/api/cron/publish` | GET | Cron : publication auto (Bearer `CRON_SECRET`) |
| `/api/agent/generate` | POST | Agent IA calendrier |

### Credits / Facturation

| Route | Methode | Description |
|-------|---------|-------------|
| `/api/credits/balance` | GET | Solde credits |
| `/api/credits/purchase` | POST | Achat credits |
| `/api/stripe/create-checkout` | POST | Session checkout Stripe |
| `/api/stripe/create-portal` | POST | Portail facturation |
| `/api/stripe/webhook` | POST | Webhook Stripe |

### Social

| Route | Methode | Description |
|-------|---------|-------------|
| `/api/social/connect` | POST | Connexion compte social |
| `/api/social/callback` | GET | Callback OAuth generique |
| `/api/social/callback/tiktok` | GET | Callback TikTok |
| `/api/social/disconnect` | POST | Deconnexion |
| `/api/social/accounts` | GET | Comptes connectes |
| `/api/social/publish` | POST | Publier sur les reseaux |
| `/api/social/settings` | GET/PUT | Parametres publication |

### Contenu et media

| Route | Methode | Description |
|-------|---------|-------------|
| `/api/content/generate` | POST | Generation contenu |
| `/api/content/ai-generate` | POST | Generation IA avancee |
| `/api/upload/media` | POST | Upload media direct |
| `/api/upload/signed-url` | POST | URL signee (bypass limite 4.5MB Vercel) |
| `/api/proxy-media` | GET | Proxy media (CORS) |
| `/api/tts/edge` | POST | Text-to-Speech |
| `/api/pexels` | GET | Recherche images Pexels |

### Admin

| Route | Methode | Description |
|-------|---------|-------------|
| `/api/admin/stats` | GET | Stats globales |
| `/api/admin/stats/revenue` | GET | Revenus |
| `/api/admin/stats/activity` | GET | Activite |
| `/api/admin/users` | GET | Liste users |
| `/api/admin/users/[id]` | GET/PUT | Detail user |
| `/api/admin/users/[id]/credits` | POST | Modifier credits |
| `/api/admin/users/[id]/ban` | POST | Bannir user |
| `/api/admin/videos` | GET | Videos |
| `/api/admin/payments` | GET | Paiements |
| `/api/admin/payments/export` | GET | Export CSV |
| `/api/admin/subscriptions` | GET | Abonnements |
| `/api/admin/landing` | GET/PUT | CMS landing |
| `/api/admin/settings` | GET/PUT | Parametres |
| `/api/admin/terms` | GET/PUT | CGU |
| `/api/admin/logs` | GET | Audit log |
| `/api/admin/email/test` | POST | Test email |

---

## Systeme de credits

| Plan | Prix/mois | Prix/an | Credits/mois |
|------|-----------|---------|--------------|
| **Starter** | 29.99 EUR | 24.99 EUR | 300 |
| **Pro** | 79.99 EUR | 66.99 EUR | 1 000 |
| **Enterprise** | 299.99 EUR | 249.99 EUR | 5 000 |

### Packs credits (one-shot)

| Pack | Credits | Prix |
|------|---------|------|
| Small | 50 | 9.99 EUR |
| Medium | 150 | 19.99 EUR |
| Large | 500 | 49.99 EUR |

### Cout par rendu

| Format | Credits |
|--------|---------|
| Reel (9:16) | 10 |
| TV (16:9) | 15 |

---

## Composition video — Pipeline complet

### Etape 1 : Infographie (`/dashboard/infographie`)

L'utilisateur cree une infographie : theme, template, contenu IA, branding, video uploadee (optionnel), format 9:16 ou 16:9.

Le compositeur (`video-composer.ts`, 839 lignes) genere un fichier **WebM** via Canvas + MediaRecorder.

**Mode Fast** (sans audio) : `captureStream(0)` + `requestFrame()` par batch de 4, rendu ~10x temps reel.
**Mode Normal** (avec audio) : `captureStream(fps)` + AudioContext, rendu temps reel.

### Etape 2 : Studio Son (`/dashboard/audio-studio`)

Ajout musique + voix. Preview temps reel (`requestAnimationFrame` ~60fps). Export : recomposition complete avec audio embarque.

### Etape 3 : Calendrier IA (`/dashboard/calendar`)

Preview montage (sequences intro → cards → video → CTA, transitions opacite 800ms). Detection fichiers casses (readyState=0 apres 3s), skip auto. Publication via cron.

### Upload vers Supabase

Fichiers uploades via **signed URLs** (contourne limite 4.5MB Vercel) : `POST /api/upload/signed-url` → `PUT` direct vers Supabase Storage.

---

## Authentification

Flux : OAuth Google/Facebook → NextAuth JWT → sync user Supabase → 10 credits gratuits pour nouveaux users.

Middleware protege `/dashboard/*`, `/admin/*`, `/api/user/*`, `/api/credits/*`, `/api/admin/*`.

Admins : `contact.artboost@gmail.com`, `bassicustomshoes@gmail.com`

---

## Reseaux sociaux

| Plateforme | Formats | API |
|------------|---------|-----|
| Instagram | Reels, Stories, Posts | Meta Graph API v24.0 |
| TikTok | Videos courtes | Content Posting API v2 |
| Facebook | Videos, Reels, Stories | Meta Graph API v24.0 |
| YouTube | Shorts, videos longues | Google OAuth |

Token refresh automatique avec buffer 5 min (`token-refresh.ts`).

Publication auto via cron `/api/cron/publish` (timezone Europe/Paris, Bearer `CRON_SECRET`).

---

## Text-to-Speech

14 voix : FR (Denise, Henri, Coralie, Vivienne), EN (Aria, Guy, Jenny, Davis), ES (Elvira, Alvaro), PT (Francisca, Antonio), DE (Katja, Conrad).

Fallback : Edge TTS serveur → SpeechSynthesis navigateur.

---

## Emails

Envoi via **Resend**. Templates : welcome, payment confirmation, admin sale alert, account banned, credits added.

Pattern **fire-and-forget** : erreurs loguees, jamais propagees.

---

## Variables d'environnement

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=                # ou SUPABASE_SERVICE_ROLE_KEY

# NextAuth
AUTH_SECRET=                          # ou NEXTAUTH_SECRET
NEXTAUTH_URL=
NEXT_PUBLIC_APP_URL=
AUTH_TRUST_HOST=true

# OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
FACEBOOK_CLIENT_ID=
FACEBOOK_CLIENT_SECRET=
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Email
RESEND_API_KEY=
RESEND_FROM=Studiio <noreply@studiio.pro>

# Admin
ADMIN_SECRET_KEY=
ADMIN_EMAIL=
CRON_SECRET=
```

---

## Developpement

```bash
git clone git@github.com:sambassi/studiio.git
cd studiio
npm install
cp .env.example .env.local
npm run dev                          # http://localhost:3000
```

### Build

```bash
npm run build                        # ignoreBuildErrors: true
```

> Note : `typescript.ignoreBuildErrors` et `eslint.ignoreDuringBuilds` sont actives dans `next.config.js`.

### Config Next.js notable

- `serverActionsBodySizeLimit: '50mb'` (upload video)
- Remotion packages externalises via webpack
- Images : `*.supabase.co`, `lh3.googleusercontent.com`

---

## Decisions techniques

**Canvas + MediaRecorder client-side** : evite les couts serveur. WebM (VP9/VP8) prefere car Chrome produit des MP4 corrompus en mode fast.

**Remotion server-side** (`/api/render`) : pour rendu haute qualite. Bundle cache 2 min.

**Signed URLs** : contourne la limite 4.5MB de Vercel pour l'upload.

**Fire-and-forget emails** : jamais de blocage UX pour un echec d'envoi.

---

## Historique des changements recents

### Avril 2026

- **Video Composer** : preference WebM au lieu de MP4 (fix metadonnees corrompues en mode fast)
- **Calendar preview** : play/pause explicite sur transitions, detection fichiers casses, fix autoplay (muted=true)
- **Studio Son** : fix crash page noire (TDZ), fix timeline (~60fps), fix audio batch, fix format portrait

### Mars 2026

- **Infographie** : export batch x10, mode FAST (~10x), upload video
- **Reseaux sociaux** : integration TikTok, publication multi-plateforme
- **Systeme** : upload signe, timezone cron, data deletion endpoint
