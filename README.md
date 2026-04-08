# Studiio.pro

**Plateforme SaaS de creation video et d'infographies animees pour les reseaux sociaux.**

Studiio permet aux createurs de contenu, coachs fitness, entrepreneurs et marques de produire du contenu video professionnel (infographies animees, montages video avec audio) et de le publier automatiquement sur Instagram, TikTok, Facebook et YouTube.

**URL production** : https://studiio.pro
**Deploiement** : Vercel (auto-deploy depuis GitHub `main`)
**Repo** : `sambassi/studiio`

---

## Table des matieres

1. [Stack technique](#stack-technique)
2. [Installation et lancement](#installation-et-lancement)
3. [Architecture du projet](#architecture-du-projet)
4. [Les 6 modules fonctionnels](#les-6-modules-fonctionnels)
5. [Pipeline video complet](#pipeline-video-complet)
6. [Base de donnees Supabase](#base-de-donnees-supabase)
7. [Routes API](#routes-api)
8. [Systeme de credits et facturation](#systeme-de-credits-et-facturation)
9. [Authentification](#authentification)
10. [Publication reseaux sociaux](#publication-reseaux-sociaux)
11. [Text-to-Speech](#text-to-speech)
12. [Systeme d'emails](#systeme-demails)
13. [Internationalisation](#internationalisation)
14. [Administration](#administration)
15. [Variables d'environnement](#variables-denvironnement)
16. [Decisions techniques](#decisions-techniques)
17. [Historique des changements](#historique-des-changements)

---

## Stack technique

| Couche | Technologie | Version | Role |
|--------|-------------|---------|------|
| Framework | Next.js (App Router) | 14.2 | Rendu SSR/SSG, routing, API routes |
| Language | TypeScript (strict) | 5.x | Typage statique, path alias `@/*` → `./src/*` |
| Styling | Tailwind CSS | 3.x | UI dark mode, palette : primary `#7C3AED`, accent `#EC4899`, dark `#0A0A0F` |
| Database | Supabase (PostgreSQL) | - | Tables, RLS, Storage buckets |
| Storage | Supabase Storage | - | Videos, images, audio, media (signed URLs) |
| Auth | NextAuth v5 beta | 5.0.0-beta.19 | OAuth Google/Facebook, strategie JWT |
| Paiements | Stripe | v15 | Abonnements mensuels/annuels, packs credits, webhooks |
| Video (client) | Canvas 2D + MediaRecorder | - | Composition video cote navigateur (mode fast/normal) |
| Video (server) | Remotion | 4.0.441 | Rendu haute qualite cote serveur |
| Audio | mp4-muxer, webm-muxer, FFmpeg WASM | - | Muxage audio dans les fichiers video |
| TTS | msedge-tts | 2.x | Text-to-Speech (14 voix, 5 langues) |
| Email | Resend (REST) | - | Emails transactionnels fire-and-forget |
| i18n | next-intl | 4.x | FR (defaut), EN, DE |
| Validation | Zod | 3.x | Validation schemas API |
| Color Picker | react-colorful | 3.x | ColorWheel UI dans l'editeur infographie |
| Fonts | next/font/google | - | 5 polices : Anton, Syne, Bebas Neue, Poppins, Space Grotesk |
| Tests | Playwright | - | Tests end-to-end |
| Deploiement | Vercel | auto-deploy | Plan Pro, `maxDuration: 300s` pour fonctions longues |

---

## Installation et lancement

```bash
git clone git@github.com:sambassi/studiio.git
cd studiio
npm install
cp .env.example .env.local    # remplir toutes les variables (voir section dediee)
npm run dev                    # http://localhost:3000
```

### Build production

```bash
npm run build
```

Le build a `ignoreBuildErrors: true` (TypeScript) et `ignoreDuringBuilds: true` (ESLint) dans `next.config.js`. Le projet compile meme avec des erreurs TS/ESLint. C'est intentionnel pour le moment afin de ne pas bloquer les deploiements.

### Configuration Next.js notable

Le fichier `next.config.js` contient des configurations specifiques au projet : `serverActionsBodySizeLimit: '50mb'` pour gerer les uploads video volumineux, les packages Remotion (`@remotion/*`) sont externalises via webpack pour eviter les conflits de bundling, et les domaines d'images autorises incluent `*.supabase.co` et `lh3.googleusercontent.com` (avatars Google).

---

## Architecture du projet

```
src/
├── app/
│   ├── layout.tsx              # Root layout (Inter font, dark theme, providers)
│   ├── providers.tsx           # SessionProvider + I18nProvider
│   ├── page.tsx                # Landing page marketing
│   ├── privacy/page.tsx        # Politique de confidentialite
│   ├── terms/page.tsx          # CGU
│   ├── auth/
│   │   ├── login/page.tsx      # Connexion OAuth (Google, Facebook)
│   │   └── signup/page.tsx     # Inscription + selection plan
│   ├── dashboard/
│   │   ├── layout.tsx          # Sidebar + navbar dashboard
│   │   ├── page.tsx            # Accueil stats (videos, credits, publications)
│   │   ├── creator/page.tsx    # Creation video libre
│   │   ├── infographic/page.tsx # Infographies (route EN)
│   │   ├── infographie/page.tsx # Infographies (route FR) — page principale
│   │   ├── audio-studio/page.tsx # Studio Son (musique + voix)
│   │   ├── calendar/page.tsx   # Calendrier IA (planification + preview montage)
│   │   ├── library/page.tsx    # Bibliotheque de toutes les videos
│   │   ├── social/page.tsx     # Gestion comptes sociaux (connexion OAuth)
│   │   ├── objectives/page.tsx # Objectifs contenu (audience, ton, plateforme)
│   │   └── billing/page.tsx    # Facturation (plans, credits, portail Stripe)
│   ├── admin/
│   │   ├── layout.tsx          # Sidebar admin separee
│   │   ├── page.tsx            # Dashboard admin (stats globales)
│   │   ├── users/page.tsx      # Gestion utilisateurs (credits, ban)
│   │   ├── videos/page.tsx     # Gestion videos
│   │   ├── payments/page.tsx   # Historique paiements + export CSV
│   │   ├── subscriptions/      # Gestion abonnements
│   │   ├── emails/             # Emails en masse
│   │   ├── landing/            # CMS landing page
│   │   ├── settings/           # Maintenance, config IA, credits
│   │   ├── terms/              # Editeur CGU en ligne
│   │   └── logs/               # Audit trail (actions admin)
│   └── api/                    # ~40 routes API REST (voir section dediee)
├── components/
│   ├── BrandingPanel.tsx       # Panneau branding (logo, couleurs, CTA, watermark)
│   ├── LanguageSelector.tsx    # Selecteur FR/EN/DE
│   ├── admin/                  # ActivityFeed, PaymentTable, RevenueChart, UserTable
│   ├── billing/                # CreditsDisplay, PricingCards
│   ├── dashboard/              # RecentVideos, StatsCard
│   ├── layout/                 # Navbar, Sidebar, AdminSidebar
│   └── ui/                     # Badge, Button, Card, ColorWheel, FloatingPanel, Input, Modal, Select, Table
├── lib/
│   ├── db/supabase.ts          # Deux clients : supabase (RLS) + supabaseAdmin (bypass)
│   ├── auth/config.ts          # Config NextAuth (providers Google/Facebook, callbacks JWT)
│   ├── stripe/
│   │   ├── client.ts           # Helpers checkout, portal, webhook processing
│   │   └── constants.ts        # Plans (Starter/Pro/Enterprise), prix, packs credits
│   ├── credits/system.ts       # Systeme complet de credits (deduct, add, check, log)
│   ├── video-composer.ts       # Moteur de composition video Canvas 2D (839 lignes)
│   ├── render/worker.ts        # Worker Remotion pour rendu serveur
│   ├── storage/upload.ts       # Upload Supabase Storage via signed URLs
│   ├── smart-content.ts        # Generation de contenu IA local (base de connaissances)
│   ├── clip-detector.ts        # Detection et decoupage de clips video
│   ├── social/token-refresh.ts # Refresh automatique tokens OAuth (buffer 5 min)
│   ├── tts/edge-tts-client.ts  # Client Text-to-Speech (14 voix, 5 langues)
│   ├── email/
│   │   ├── resend.ts           # Client API Resend
│   │   ├── templates.ts        # Templates HTML (welcome, payment, ban, credits)
│   │   └── notifications.ts    # Helpers fire-and-forget (jamais de await)
│   ├── admin.ts                # isAdmin(), writeAuditLog(), liste emails admin
│   ├── i18n-content.ts         # Contenu traduit pour generation
│   ├── hooks/useBranding.ts    # Hook React pour branding personnalise
│   └── types/
│       ├── database.ts         # Types Supabase : User, Video, Post, SocialAccount, etc.
│       └── api.ts              # Types API : requests, responses
└── i18n/
    ├── config.ts               # Locales supportees : fr, en, de
    ├── client.ts               # Hook client useTranslation
    └── provider.tsx            # I18nProvider wrapping l'app
```

Le middleware (`src/middleware.ts`) protege les routes `/dashboard/*`, `/admin/*`, et certaines routes API. L'acces admin est reserve aux emails listes dans `src/lib/admin.ts`.

---

## Les 6 modules fonctionnels

### 1. Infographie — Creation de contenu visuel

**Fichiers principaux** : `src/app/dashboard/infographie/page.tsx` (~3900 lignes), `src/lib/video-composer.ts`, `src/lib/smart-content.ts`, `src/components/ui/FloatingPanel.tsx`, `src/components/ui/ColorWheel.tsx`

C'est le point d'entree principal de la creation. L'utilisateur choisit un theme parmi une liste (fitness, sante, nutrition, bien-etre, etc.), selectionne un template visuel, et le systeme genere automatiquement 5 cartes d'infographie via `smart-content.ts`. Ce module utilise une base de connaissances locale integree au code — il n'appelle aucune API IA externe.

L'editeur utilise un systeme de **panneaux flottants contextuels** (`FloatingPanel.tsx`) ouverts par double-clic sur les elements de la preview. Chaque panneau contient un **ColorWheel** (`react-colorful`, `HexColorPicker` toujours visible) et des controles de typographie avances (letter-spacing, line-height, bold, italic). Les panneaux sont draggables, glassmorphism, et se ferment au clic exterieur.

Les boutons de sequence (Titre, Cartes, Video, CTA) incluent un bouton **Play (▶)** qui lance un montage automatique cyclant a travers chaque sequence. La barre de couleurs et le bouton Parametres sont accessibles depuis toutes les etapes de l'editeur.

L'export supporte deux destinations simultanees : **Calendrier** (cree un post avec metadonnees completes incluant le design) et **Bureau** (telecharge poster + video + config JSON). Les preferences utilisateur sont persistees dans localStorage.

Le coeur technique de ce module est le compositeur video (`video-composer.ts`, 839 lignes). Il dessine chaque frame d'animation sur un Canvas 2D HTML5, puis encode le tout via l'API MediaRecorder du navigateur. Le compositeur fonctionne en deux modes distincts, decrits dans la section Pipeline video.

L'export produit un fichier WebM uploade sur Supabase Storage via signed URL, et cree un enregistrement dans `scheduled_posts` avec toutes les metadonnees necessaires au montage (sequences, branding, design, URLs media).

### 2. Studio Son — Audio

**Fichier principal** : `src/app/dashboard/audio-studio/page.tsx`

Le Studio Son permet d'ajouter une piste musicale et une voix (TTS automatique ou fichier audio uploade) sur les videos existantes. L'interface offre une preview en temps reel utilisant `requestAnimationFrame` (~60fps) pour une timeline fluide. Le mode batch permet de traiter plusieurs videos simultanement.

L'export recompose entierement la video : le fichier original est retraite avec l'audio embarque directement dans le conteneur, produisant un fichier WebM valide et lisible partout.

### 3. Calendrier IA — Planification et preview

**Fichier principal** : `src/app/dashboard/calendar/page.tsx`

Calendrier mensuel interactif affichant les posts planifies. Chaque post peut etre previsualise dans une modale plein ecran qui joue le montage complet. Le montage est une reconstruction HTML du rendu video : il cycle entre les sequences (intro → cartes → video rush → CTA) avec des transitions d'opacite de 800ms.

L'Agent IA integre peut generer automatiquement du contenu pour 7, 14 ou 30 jours via l'endpoint `/api/agent/generate`. Les posts sont crees en statut `draft` et peuvent etre programmes pour publication automatique.

### 4. Publication sociale

**Fichiers** : `src/app/dashboard/social/page.tsx`, `src/lib/social/token-refresh.ts`, `src/app/api/social/*`, `src/app/api/cron/publish/route.ts`

Gestion des comptes sociaux connectes via OAuth et publication vers Instagram (Reels, Stories, Posts), TikTok (videos courtes), Facebook (Videos, Reels, Stories), et YouTube (Shorts, videos longues). Les tokens OAuth sont rafraichis automatiquement avec un buffer de 5 minutes avant expiration.

La publication automatique est geree par un cron job Vercel (`/api/cron/publish`) qui tourne en timezone Europe/Paris, authentifie par Bearer token (`CRON_SECRET`).

### 5. Credits et facturation

**Fichiers** : `src/lib/credits/system.ts`, `src/lib/stripe/constants.ts`, `src/lib/stripe/client.ts`

Systeme de credits avec trois plans d'abonnement et des packs one-shot. Chaque action de rendu consomme des credits (10 pour reel 9:16, 15 pour TV 16:9). Toutes les transactions sont tracees dans `credit_transactions` avec un type (render, purchase, bonus, refund, subscription).

### 6. Administration

**Fichiers** : `src/app/admin/*`, `src/app/api/admin/*`, `src/lib/admin.ts`

Dashboard admin complet avec statistiques globales, gestion des utilisateurs (ajout/retrait credits, bannissement), gestion des videos et paiements, CMS pour la landing page, editeur de CGU, envoi d'emails en masse, et journal d'audit de toutes les actions administratives.

Les administrateurs sont identifies par email : `contact.artboost@gmail.com` et `bassicustomshoes@gmail.com`.

---

## Pipeline video complet

Le flux de creation video suit trois etapes distinctes, chacune correspondant a un module de l'application.

### Etape 1 : Composition (Infographie)

Le compositeur video (`video-composer.ts`) dessine chaque frame sur un Canvas 2D et encode via MediaRecorder. Il fonctionne en deux modes :

**Mode Fast (sans audio)** — Utilise `captureStream(0)` + `requestFrame()` par batch de 4 frames. Le rendu est ~10x plus rapide que le temps reel. Produit un fichier WebM (VP9 ou VP8). Ce mode est utilise quand aucune URL audio (`musicUrl`, `voiceUrl`) n'est fournie. Le fichier produit est un montage video complet contenant toutes les sequences (intro, cartes, video rush, CTA) fusionnees dans un seul fichier.

**Mode Normal (avec audio)** — Utilise `captureStream(fps)` + AudioContext pour mixer musique et voix en temps reel. Le rendu est en temps reel (1 minute de video = 1 minute de rendu). Produit un WebM valide avec audio embarque.

Le fichier genere est uploade sur Supabase Storage (bucket `media`) via signed URL. Un post est cree dans `scheduled_posts` avec les metadonnees de montage.

### Etape 2 : Ajout audio (Studio Son)

L'utilisateur peut ajouter musique et voix TTS sur ses videos via le Studio Son. L'export recompose entierement la video avec l'audio embarque, produisant un fichier WebM valide en mode normal.

### Etape 3 : Preview et publication (Calendrier)

Le Calendrier reconstruit le montage en HTML pour la preview. Il ne joue pas le fichier WebM rendu directement — il recree les sequences (intro, cartes, video rush, CTA) a partir des metadonnees du post et les cycle avec des transitions d'opacite. La video rush brute (le fichier original uploade par l'utilisateur) est jouee pendant la sequence "video". Le montage WebM rendu n'est jamais utilise dans la preview HTML car il contient deja toutes les sequences, ce qui causerait un doublon visuel.

### Structure des metadonnees d'un post

Les metadonnees d'un post (`scheduled_posts.metadata`) contiennent toutes les informations necessaires a la reconstruction du montage :

```json
{
  "sequences": {
    "order": ["intro", "cards", "video", "cta"],
    "durations": { "intro": 5, "cards": 8, "video": 10, "cta": 7 }
  },
  "branding": {
    "logoUrl": "https://...",
    "accentColor": "#7C3AED",
    "ctaText": "Decouvrir",
    "watermarkText": "Afroboost"
  },
  "design": {
    "titleFont": "Anton",
    "titleColor": "#FFFFFF",
    "titleLetterSpacing": 0,
    "titleLineHeight": 1.1,
    "titleBold": true,
    "titleItalic": false,
    "ctaLetterSpacing": 2,
    "ctaLineHeight": 1.2,
    "ctaTextScale": 1.0,
    "ctaSubColor": "#D91CD2",
    "overlayText": "...",
    "overlayColor": "#FFFFFF",
    "overlayLetterSpacing": 0,
    "overlayLineHeight": 1.2,
    "cardsLetterSpacing": 0,
    "gradientStart": "#7C3AED",
    "gradientEnd": "#EC4899",
    "gradientOpacity": 0.6,
    "logoPosition": { "x": 50, "y": 8 },
    "logoSize": 80,
    "logoOpacity": 1
  },
  "videoUrl": "https://supabase.../montage.webm",
  "rawVideoUrl": "https://supabase.../rush.mp4",
  "rushUrls": ["https://supabase.../rush.mp4"],
  "posterUrl": "https://supabase.../poster.jpg",
  "musicUrl": "https://...",
  "voiceUrl": "https://...",
  "hasAudio": true,
  "renderedVideoUrl": "https://supabase.../montage-audio.webm",
  "format": "reel",
  "cards": [{ "icon": "...", "title": "...", "description": "...", "value": "..." }],
  "cardCustomIcons": { "0": "https://..." }
}
```

Les champs `rawVideoUrl` / `rushUrls` pointent vers la video rush brute originale. `videoUrl` pointe vers le montage WebM rendu par le compositeur. `renderedVideoUrl` pointe vers le montage avec audio (apres passage au Studio Son). `hasAudio` indique si le post contient de l'audio. Le champ `design` contient tous les parametres visuels de l'editeur (typographie, couleurs, positions, opacites) pour reconstruire le design exact.

### Upload vers Supabase Storage

Les fichiers sont uploades via signed URLs pour contourner la limite de 4.5MB de Vercel : le client appelle `POST /api/upload/signed-url`, recoit une URL signee Supabase, fait un PUT direct vers Supabase Storage (sans limite de taille), puis sauvegarde l'URL publique dans les metadonnees du post.

Les buckets disponibles sont : `videos` (videos rendues), `images` (posters, thumbnails), `audio` (musiques, voiceovers), `media` (fichiers generiques).

---

## Base de donnees Supabase

### Tables principales

| Table | Description | Colonnes cles |
|-------|-------------|---------------|
| `users` | Comptes utilisateurs | `id`, `email`, `name`, `credits` (int), `plan` (free/starter/pro/enterprise) |
| `videos` | Metadonnees videos | `id`, `user_id`, `title`, `format` (reel/tv), `status` (draft/rendering/completed/published/failed), `video_url`, `metadata` |
| `scheduled_posts` | File de publication | `id`, `user_id`, `title`, `caption`, `media_url`, `media_type` (video/image), `platforms[]`, `scheduled_date`, `scheduled_time`, `status` (draft/scheduled/published/failed), `metadata` (JSON) |
| `social_accounts` | Comptes OAuth sociaux | `id`, `user_id`, `platform` (instagram/tiktok/facebook/youtube), `access_token`, `refresh_token`, `expires_at` |
| `subscriptions` | Abonnements Stripe | `id`, `user_id`, `plan`, `status`, `stripe_subscription_id`, `current_period_end` |
| `credit_transactions` | Historique credits | `id`, `user_id`, `amount`, `type` (purchase/render/refund/bonus/subscription), `description` |
| `render_jobs` | Travaux de rendu | `id`, `user_id`, `video_id`, `status` (queued/rendering/completed/failed), `progress`, `output_url` |
| `objectives` | Objectifs contenu | `id`, `user_id`, `platform`, `target_audience`, `tone` |
| `agent_plans` | Plans generes par l'Agent IA | `id`, `user_id` |
| `publishing_history` | Historique publications sociales | `id`, `post_id` |
| `audit_log` | Journal admin | `id`, `admin_email`, `action`, `details` |

### Clients Supabase

Le projet utilise deux clients Supabase distincts :

```typescript
import { supabase } from '@/lib/db/supabase';       // Client-side (RLS enforced, cle anonyme)
import { supabaseAdmin } from '@/lib/db/supabase';  // Server-side (RLS bypasse, service key)
```

Le client `supabaseAdmin` ne doit etre utilise que dans les API routes et jamais expose cote client.

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
| `/api/auth/[...nextauth]` | GET/POST | NextAuth handlers (OAuth Google, Facebook) |
| `/api/user/profile` | GET/PUT | Lecture/mise a jour profil utilisateur |
| `/api/user/objectives` | GET/PUT | Objectifs de contenu |

### Videos

| Route | Methode | Description |
|-------|---------|-------------|
| `/api/videos` | GET/POST | Liste / creation video |
| `/api/videos/[id]` | GET/PUT/DELETE | CRUD video individuelle |
| `/api/videos/[id]/duplicate` | POST | Dupliquer une video |
| `/api/videos/[id]/export` | POST | Exporter une video |
| `/api/videos/[id]/repost` | POST | Republier une video |

### Rendu

| Route | Methode | Description |
|-------|---------|-------------|
| `/api/render` | POST | Lancer un rendu video (Remotion, `maxDuration: 300s`) |
| `/api/render/batch` | POST | Rendu batch (plusieurs videos) |
| `/api/render/status` | GET | Statut d'un render job |

### Posts / Calendrier

| Route | Methode | Description |
|-------|---------|-------------|
| `/api/posts` | GET/POST | Liste / creation post |
| `/api/posts/[id]` | GET/PUT/DELETE | CRUD post individuel |
| `/api/cron/publish` | GET | Cron : publication automatique (Bearer `CRON_SECRET`, timezone Europe/Paris) |
| `/api/agent/generate` | POST | Agent IA : generation contenu pour 7/14/30 jours |

### Credits / Facturation

| Route | Methode | Description |
|-------|---------|-------------|
| `/api/credits/balance` | GET | Solde credits de l'utilisateur |
| `/api/credits/purchase` | POST | Achat de pack credits |
| `/api/stripe/create-checkout` | POST | Creer une session checkout Stripe |
| `/api/stripe/create-portal` | POST | Ouvrir le portail de facturation Stripe |
| `/api/stripe/webhook` | POST | Webhook Stripe (paiements, abonnements) |

### Social

| Route | Methode | Description |
|-------|---------|-------------|
| `/api/social/connect` | POST | Initier connexion OAuth d'un compte social |
| `/api/social/callback` | GET | Callback OAuth generique |
| `/api/social/callback/tiktok` | GET | Callback specifique TikTok |
| `/api/social/disconnect` | POST | Deconnexion d'un compte social |
| `/api/social/accounts` | GET | Liste des comptes sociaux connectes |
| `/api/social/publish` | POST | Publier manuellement sur les reseaux |
| `/api/social/settings` | GET/PUT | Parametres de publication |

### Contenu et media

| Route | Methode | Description |
|-------|---------|-------------|
| `/api/content/generate` | POST | Generation contenu (smart-content local) |
| `/api/content/ai-generate` | POST | Generation IA avancee |
| `/api/upload/media` | POST | Upload media direct (< 4.5MB) |
| `/api/upload/signed-url` | POST | URL signee Supabase (bypass limite Vercel) |
| `/api/proxy-media` | GET | Proxy media pour contourner les restrictions CORS |
| `/api/tts/edge` | POST | Text-to-Speech (msedge-tts) |
| `/api/pexels` | GET | Recherche images via API Pexels |

### Admin

| Route | Methode | Description |
|-------|---------|-------------|
| `/api/admin/stats` | GET | Statistiques globales |
| `/api/admin/stats/revenue` | GET | Donnees de revenus |
| `/api/admin/stats/activity` | GET | Donnees d'activite |
| `/api/admin/users` | GET | Liste tous les utilisateurs |
| `/api/admin/users/[id]` | GET/PUT | Detail / modification utilisateur |
| `/api/admin/users/[id]/credits` | POST | Modifier les credits d'un utilisateur |
| `/api/admin/users/[id]/ban` | POST | Bannir un utilisateur |
| `/api/admin/videos` | GET | Liste toutes les videos |
| `/api/admin/payments` | GET | Historique des paiements |
| `/api/admin/payments/export` | GET | Export CSV des paiements |
| `/api/admin/subscriptions` | GET | Liste des abonnements |
| `/api/admin/landing` | GET/PUT | CMS landing page |
| `/api/admin/settings` | GET/PUT | Parametres globaux |
| `/api/admin/terms` | GET/PUT | Conditions generales d'utilisation |
| `/api/admin/logs` | GET | Journal d'audit |
| `/api/admin/email/test` | POST | Envoyer un email de test |

### Autres

| Route | Methode | Description |
|-------|---------|-------------|
| `/api/terms` | GET | CGU publiques |
| `/api/data-deletion` | POST | Endpoint compliance Facebook (suppression donnees) |
| `/api/cron/debug` | GET | Debug cron jobs |

---

## Systeme de credits et facturation

### Plans d'abonnement

| Plan | Prix/mois | Prix/an (par mois) | Credits/mois |
|------|-----------|---------------------|--------------|
| **Starter** | 29.99 EUR | 24.99 EUR | 300 |
| **Pro** | 79.99 EUR | 66.99 EUR | 1 000 |
| **Enterprise** | 299.99 EUR | 249.99 EUR | 5 000 |

### Packs credits (achat unique)

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

Les nouveaux utilisateurs recoivent 10 credits gratuits a l'inscription. Chaque deduction est tracee dans `credit_transactions` avec un type : `render`, `purchase`, `bonus`, `refund`, `subscription`.

---

## Authentification

Le flux d'authentification suit ce parcours : OAuth Google ou Facebook → NextAuth v5 JWT → synchronisation automatique dans la table `users` Supabase → attribution de 10 credits gratuits pour les nouveaux comptes.

Le middleware protege les routes `/dashboard/*`, `/admin/*`, `/api/user/*`, `/api/credits/*`, `/api/admin/*`. L'acces admin est reserve aux emails listes dans `src/lib/admin.ts`.

Les administrateurs sont : `contact.artboost@gmail.com` et `bassicustomshoes@gmail.com`.

---

## Publication reseaux sociaux

| Plateforme | Formats supportes | API utilisee |
|------------|-------------------|--------------|
| Instagram | Reels, Stories, Posts | Meta Graph API v24.0 |
| TikTok | Videos courtes | Content Posting API v2 |
| Facebook | Videos, Reels, Stories | Meta Graph API v24.0 |
| YouTube | Shorts, videos longues | Google OAuth + YouTube Data API |

Le refresh automatique des tokens OAuth est gere par `token-refresh.ts` avec un buffer de 5 minutes avant expiration. Le cron job de publication (`/api/cron/publish`) s'execute en timezone Europe/Paris et est authentifie par Bearer token (`CRON_SECRET`).

---

## Text-to-Speech

14 voix disponibles reparties sur 5 langues :

| Langue | Voix |
|--------|------|
| Francais | Denise, Henri, Coralie, Vivienne |
| Anglais | Aria, Guy, Jenny, Davis |
| Espagnol | Elvira, Alvaro |
| Portugais | Francisca, Antonio |
| Allemand | Katja, Conrad |

Le systeme utilise `msedge-tts` cote serveur avec un fallback sur `SpeechSynthesis` cote navigateur.

---

## Systeme d'emails

Envoi via l'API REST de Resend. Templates HTML disponibles : welcome (inscription), payment confirmation (achat), admin sale alert (notification admin), account banned (bannissement), credits added (ajout credits).

Le pattern fire-and-forget est utilise partout : les emails ne sont jamais `await`-es dans les flux critiques. Les erreurs d'envoi sont loguees silencieusement sans jamais bloquer l'experience utilisateur.

```typescript
sendEmailSilent({ to, subject, html }); // pas de await, pas de try/catch dans le flux
```

---

## Internationalisation

Le projet supporte trois langues via `next-intl` : francais (defaut), anglais, allemand. Les fichiers de configuration se trouvent dans `src/i18n/`. Le contenu genere par `smart-content.ts` est egalement traduit via `src/lib/i18n-content.ts`.

---

## Administration

Le dashboard admin (`/admin`) offre une vue complete de la plateforme : statistiques globales (utilisateurs, videos, revenus), gestion individuelle des utilisateurs (consultation, ajout/retrait credits, bannissement), gestion des videos et paiements, CMS pour la landing page, editeur de CGU, envoi d'emails en masse, et un journal d'audit tracant toutes les actions administratives.

---

## Variables d'environnement

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=                # URL du projet Supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY=           # Cle anonyme (client-side)
SUPABASE_SERVICE_KEY=                    # Cle service (server-side, bypass RLS)

# NextAuth
AUTH_SECRET=                             # Secret JWT (32 chars minimum)
NEXTAUTH_URL=                            # URL de l'app (https://studiio.pro)
NEXT_PUBLIC_APP_URL=                     # URL publique de l'app
AUTH_TRUST_HOST=true

# OAuth
GOOGLE_CLIENT_ID=                        # Google OAuth client ID
GOOGLE_CLIENT_SECRET=                    # Google OAuth secret
FACEBOOK_CLIENT_ID=                      # Facebook OAuth app ID
FACEBOOK_CLIENT_SECRET=                  # Facebook OAuth secret
TIKTOK_CLIENT_KEY=                       # TikTok app key
TIKTOK_CLIENT_SECRET=                    # TikTok app secret
YOUTUBE_CLIENT_ID=                       # YouTube/Google OAuth client ID
YOUTUBE_CLIENT_SECRET=                   # YouTube/Google OAuth secret

# Stripe (devise EUR)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=      # Cle publique Stripe
STRIPE_SECRET_KEY=                       # Cle secrete Stripe
STRIPE_WEBHOOK_SECRET=                   # Secret webhook Stripe

# Email
RESEND_API_KEY=                          # Cle API Resend
RESEND_FROM=Studiio <noreply@studiio.pro>

# Admin / Cron
ADMIN_SECRET_KEY=                        # Cle admin pour routes protegees
ADMIN_EMAIL=                             # Email admin principal
CRON_SECRET=                             # Bearer token pour cron jobs
```

---

## Decisions techniques

**Canvas + MediaRecorder client-side** : Le rendu video se fait entierement dans le navigateur pour eviter les couts serveur. Le format WebM (VP9/VP8) est prefere car Chrome produit des MP4 avec des metadonnees temporelles corrompues quand MediaRecorder fonctionne en mode fast (`captureStream(0)`).

**Remotion server-side** : Le rendu haute qualite via `/api/render` utilise Remotion avec un cache de bundle de 2 minutes. Les packages Remotion sont externalises via webpack et toujours importes dynamiquement (`import()`) pour eviter les conflits de bundling.

**Signed URLs pour l'upload** : Contourne la limite de 4.5MB imposee par Vercel sur les payloads API. Le client fait un PUT direct vers Supabase Storage sans passer par le serveur.

**Fire-and-forget pour les emails** : Les envois d'emails ne bloquent jamais l'UX. Les erreurs sont loguees silencieusement.

**Preview HTML dans le Calendrier** : Le Calendrier reconstruit le montage en HTML au lieu de lire le fichier WebM rendu. Cela permet une preview instantanee sans telecharger un fichier video potentiellement volumineux, et offre un controle precis sur chaque sequence.

---

## Historique des changements

### Avril 2026

**Refonte UX Editeur Infographie** : Remplacement des menus du panneau gauche par un systeme de panneaux flottants contextuels ouverts par double-clic sur les elements de la preview. Nouveaux composants `FloatingPanel.tsx` (draggable, glassmorphism, clic exterieur pour fermer) et `ColorWheel.tsx` (react-colorful, `HexColorPicker` toujours visible). Ajout de controles typographiques avances (letter-spacing, line-height, bold, italic) pour tous les elements textuels. Bouton Play montage remplacant le bouton "Tout" pour cycler automatiquement les sequences. Barre de couleurs et bouton Parametres accessibles depuis toutes les etapes. Export double destination : Calendrier (post avec metadonnees design completes) + Bureau (telecharge poster + video + config JSON). Persistance de toutes les preferences dans localStorage. 5 polices Google Fonts (Anton, Syne, Bebas Neue, Poppins, Space Grotesk) via `next/font/google` avec CSS variables.

**Pipeline video et audio** : Preference WebM au lieu de MP4 dans le compositeur video pour corriger les metadonnees temporelles corrompues en mode fast. Ajout de la detection HEAD pre-check pour les fichiers video volumineux sans support des range requests dans la preview du Calendrier. Le Studio Son produit maintenant des fichiers WebM valides avec audio embarque en mode normal.

**Calendrier IA** : Play/pause explicite sur les transitions de sequences. Detection automatique des fichiers video casses (readyState=0). Fix autoplay Chrome (muted=true obligatoire dans le JSX). Ajout du pre-check HEAD pour les rush MP4 volumineux (skip instantane si > 8MB sans range requests). Support de l'audio dans la preview (detection via `hasAudio` et `renderedVideoUrl`).

**Studio Son** : Fix crash page noire (TDZ — Temporal Dead Zone). Fix timeline pour utiliser `requestAnimationFrame` (~60fps) au lieu de `timeupdate` (~4fps). Fix audio en mode batch. Fix format portrait.

### Mars 2026

**Infographie** : Export batch x10 (generer 10 videos en une seule operation). Mode FAST (~10x plus rapide). Upload de video rush personnalisee.

**Reseaux sociaux** : Integration TikTok complte. Publication multi-plateforme simultanee.

**Systeme** : Upload signe Supabase. Gestion timezone pour le cron de publication. Endpoint data-deletion pour compliance Facebook.
