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
| Color Picker | react-colorful | 3.x |
| Fonts | next/font/google | - |

**Path alias** : `@/*` mappe vers `./src/*` (configure dans tsconfig.json).

**Polices Google Fonts** : 5 polices chargees via `next/font/google` avec CSS variables : Anton (`--font-anton`), Syne (`--font-syne`), Bebas Neue (`--font-bebas`), Poppins (`--font-poppins`), Space Grotesk (`--font-space`).

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

**Fichiers** : `src/app/dashboard/infographie/page.tsx` (~3900 lignes), `src/lib/video-composer.ts`, `src/lib/smart-content.ts`, `src/components/ui/FloatingPanel.tsx`, `src/components/ui/ColorWheel.tsx`

L'utilisateur choisit un theme (fitness, sante, nutrition...), un template, et le systeme genere 5 cartes d'infographie via `smart-content.ts` (base de connaissances locale, pas d'API externe).

#### Architecture UX : Panneaux flottants et double-clic

L'editeur utilise un systeme de **panneaux flottants contextuels** (`FloatingPanel.tsx`) ouverts par double-clic sur les elements de la preview. Ce systeme remplace les anciens menus dans le panneau gauche pour un workflow plus intuitif :

- **Double-clic sur le titre** → ouvre le panneau "Titre" (police, taille, couleurs, letter-spacing, line-height, bold/italic)
- **Double-clic sur les cartes** → ouvre le panneau "Cartes" et bascule le panneau gauche sur l'etape Contenu (step 0)
- **Double-clic sur la zone video** → ouvre le panneau "Overlay Video" (texte, couleur, opacite, upload rush)
- **Double-clic sur le CTA** → ouvre le panneau "CTA" (texte, couleurs, taille, sous-titre)
- **Double-clic sur le logo** → ouvre le panneau "Logo" (upload, taille, opacite)
- **Double-clic sur le fond vide** → ouvre le panneau "Ajouter" (upload logo, element, image)

Chaque panneau contient un **ColorWheel** (`react-colorful`) toujours visible (pas de toggle expand/collapse) et des controles de typographie avances (letter-spacing, line-height, bold, italic).

#### Selecteur de sequences et Play montage

Les boutons de sequence (Titre, Cartes, Video, CTA) sont affiches en permanence. Le bouton "Tout" a ete remplace par un bouton **Play (▶)** qui lance un montage automatique : il cycle sequentiellement a travers chaque sequence avec les durees configurees, puis revient en mode "all" a la fin. Le timer utilise `useRef<NodeJS.Timeout>` et `useCallback` pour eviter les fuites memoire.

Les boutons de sequence sont lies au panneau gauche : cliquer sur "Cartes" bascule automatiquement sur l'etape Contenu (step 0), cliquer sur "Video" bascule sur l'etape Style (step 2).

#### Barre de couleurs et parametres

La barre de couleurs (format 9:16/16:9 + couleurs accent/gradient) est visible sur **toutes les etapes** (pas seulement l'etape Contenu). Le bouton Parametres (engrenage) est dans la barre d'etapes et accessible depuis n'importe quelle etape.

#### Typographie avancee

Chaque element textuel dispose de controles independants : `letterSpacing`, `lineHeight`, `fontWeight` (bold), `fontStyle` (italic). Les etats sont : `titleLetterSpacing`, `titleLineHeight`, `titleBold`, `titleItalic`, `ctaLetterSpacing`, `ctaLineHeight`, `ctaBold`, `ctaItalic`, `overlayLetterSpacing`, `overlayLineHeight`, `overlayBold`, `overlayItalic`, `cardsLetterSpacing`. Tous les parametres sont persistes dans **localStorage** et restaures au chargement.

#### Export double destination

L'export supporte deux destinations simultanees :

- **Calendrier** : Cree un post dans `scheduled_posts` avec toutes les metadonnees (design complet incluant typographie, positions, couleurs, polices, etc.)
- **Bureau** : Telecharge 3 fichiers — le poster (image), la video rush (si presente), et un fichier JSON de configuration contenant tous les parametres du design

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
│   └── ui/                     # Badge, Button, Card, ColorWheel, FloatingPanel, Input, Modal, Select, Table
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

### FloatingPanel — Panneau flottant draggable

```typescript
import FloatingPanel from '@/components/ui/FloatingPanel';
import ColorWheel from '@/components/ui/ColorWheel';

// Ouvrir un panneau au double-clic
const openPanel = (type: 'title' | 'cards' | 'cta' | 'overlay' | 'logo' | 'add', e: React.MouseEvent) => {
  setPanelPos({ x: e.clientX + 10, y: e.clientY - 50 });
  setActivePanel(type);
};

<FloatingPanel
  title="Titre"
  icon="✏️"
  isOpen={activePanel === 'title'}
  onClose={() => setActivePanel(null)}
  initialX={panelPos.x}
  initialY={panelPos.y}
>
  <ColorWheel color={titleColor} onChange={setTitleColor} label="Couleur" />
  {/* ... autres controles ... */}
</FloatingPanel>
```

Le panneau est draggable via le header, se ferme au clic exterieur (avec 50ms de delai pour eviter la fermeture instantanee), et utilise `backdrop-filter: blur(20px)` pour un effet glassmorphism.

### Play montage — Cycle automatique des sequences

```typescript
const playTimerRef = useRef<NodeJS.Timeout | null>(null);
const stopPlayback = useCallback(() => {
  if (playTimerRef.current) { clearTimeout(playTimerRef.current); playTimerRef.current = null; }
  setIsPlaying(false);
}, []);

const startPlayback = useCallback(() => {
  stopPlayback();
  setIsPlaying(true);
  const sequences = [
    { key: 'titre', duration: introDuration },
    ...(cards.length > 0 ? [{ key: 'cartes', duration: cardsDuration }] : []),
    ...(rushUrl ? [{ key: 'video', duration: videoDuration }] : []),
    { key: 'cta', duration: ctaDuration },
  ];
  let i = 0;
  const playNext = () => {
    if (i >= sequences.length) { setActiveSequence('all'); setIsPlaying(false); return; }
    setActiveSequence(sequences[i].key);
    playTimerRef.current = setTimeout(() => { i++; playNext(); }, sequences[i].duration * 1000);
  };
  playNext();
}, [/* deps */]);
```

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
  "design": {
    "titleFont": "Anton",
    "titleColor": "#FFFFFF",
    "titleLetterSpacing": 0,
    "titleLineHeight": 1.1,
    "titleBold": true,
    "titleItalic": false,
    "ctaLetterSpacing": 2,
    "ctaLineHeight": 1.2,
    "ctaBold": true,
    "ctaItalic": false,
    "ctaTextScale": 1.0,
    "ctaSubColor": "#D91CD2",
    "overlayText": "...",
    "overlayColor": "#FFFFFF",
    "overlayLetterSpacing": 0,
    "overlayLineHeight": 1.2,
    "overlayBold": true,
    "overlayItalic": false,
    "cardsLetterSpacing": 0,
    "gradientStart": "#7C3AED",
    "gradientEnd": "#EC4899",
    "gradientOpacity": 0.6,
    "logoPosition": { "x": 50, "y": 8 },
    "logoSize": 80,
    "logoOpacity": 1
  },
  "videoUrl": "https://supabase.../montage.webm",
  "posterUrl": "https://supabase.../poster.jpg",
  "musicUrl": "https://...",
  "voiceUrl": "https://...",
  "format": "reel",
  "cards": [{ "icon": "...", "title": "...", "description": "...", "value": "..." }],
  "cardCustomIcons": { "0": "https://..." }
}
```

Le champ `design` contient tous les parametres visuels de l'editeur (typographie, couleurs, positions, opacites). Ce champ est utilise pour reconstruire le design exact lors de la preview dans le Calendrier ou lors d'un re-edit.

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

## Bug actuel — Video et audio dans le Calendrier (avril 2026)

Ce bug concerne les 10 posts existants dans le Calendrier. Les futurs posts crees correctement via le flux Infographie → Studio Son ne seront pas affectes. Voici l'etat des lieux pour comprendre le probleme.

### Contexte : comment un post est cree

Le flux normal de creation d'un post est : (1) l'utilisateur cree une infographie dans `/dashboard/infographie`, ce qui genere un fichier WebM via le compositeur video, (2) il passe au Studio Son pour ajouter musique et/ou voix, ce qui produit un nouveau fichier WebM valide avec audio embarque, (3) le post apparait dans le Calendrier avec toutes les metadonnees necessaires.

### Ce qui s'est passe avec les 10 posts existants

Les 10 posts actuellement dans le Calendrier ont ete crees directement depuis l'Infographie **sans passer par le Studio Son**. Le compositeur video a donc fonctionne en **mode fast** (sans audio), car aucune URL audio n'etait fournie (`musicUrl: null`, `voiceUrl: null`).

### Le probleme du montage WebM (mode fast)

En mode fast, le compositeur utilise `captureStream(0)` + `requestFrame()` par batch de 4. Cette methode est ~10x plus rapide que le temps reel, mais Chrome produit un fichier WebM dont les **metadonnees temporelles sont corrompues**. Le fichier resultant (~1.4 Mo) est techniquement invalide : Chrome peut le lire partiellement mais avec des artefacts, et certains lecteurs refusent de l'ouvrir.

Le champ `metadata.videoUrl` de ces posts pointe vers ce fichier WebM corrompu. **Le Calendrier ne l'utilise pas dans la preview HTML** (car le montage WebM contient deja les sequences intro/cartes/cta, ce qui causerait un doublon). Mais si un processus essayait de lire ce fichier directement (par exemple pour la publication sociale), il rencontrerait un fichier defaillant.

### Le probleme du rush MP4

Chaque post a un champ `metadata.rawVideoUrl` (ou `metadata.rushUrls[0]`) pointant vers la video rush brute originale uploadee par l'utilisateur. Ce fichier est un MP4 de ~18 Mo.

Ce rush MP4 a un probleme de structure interne : l'atome `moov` (qui contient les metadonnees de lecture — duree, codec, index des frames) est positionne **a la fin du fichier**, apres les 18 Mo de donnees video (atome `mdat`). La structure est : `ftyp → free → mdat (18 Mo) → moov`.

Pour qu'un lecteur video puisse commencer la lecture, il doit d'abord lire l'atome `moov`. Si le serveur supporte les **range requests** (en-tete `Accept-Ranges: bytes`), le navigateur peut sauter directement a la fin du fichier pour lire le `moov` sans telecharger les 18 Mo. Mais **Supabase Storage ne supporte pas les range requests** — il retourne `Accept-Ranges: null` dans les reponses HEAD.

Le resultat : Chrome doit telecharger les 18 Mo sequentiellement avant de pouvoir parser les metadonnees video. Dans la preview du Calendrier, la video ne charge jamais dans un delai raisonnable et le `readyState` reste a 0.

### Le contournement actuel (HEAD pre-check)

Le code actuel dans `calendar/page.tsx` effectue une requete HEAD avant de tenter de charger une video. Si le fichier fait plus de 8 Mo et que le serveur ne supporte pas les range requests, la sequence video est **immediatement ignoree** (en ~200ms au lieu d'attendre un timeout de 12 secondes). Le montage se joue alors avec 3 sequences (intro, cartes, CTA) au lieu de 4. C'est un contournement, pas une correction.

### L'absence d'audio

Les 10 posts n'ont aucun audio car ils n'ont jamais ete traites par le Studio Son. Les champs `musicUrl` et `voiceUrl` sont `null`. Le champ `hasAudio` n'existe pas (il a ete ajoute apres la creation de ces posts). Le champ `renderedVideoUrl` (qui pointe vers le montage avec audio du Studio Son) n'existe pas non plus.

La detection d'audio dans le Calendrier utilise `!!meta?.hasAudio || !!meta?.renderedVideoUrl`. Pour ces 10 posts, les deux sont falsy, donc le Calendrier les considere correctement comme sans audio.

### Resume de l'etat des 10 posts

| Champ metadata | Valeur | Etat |
|----------------|--------|------|
| `videoUrl` | WebM ~1.4 Mo | Corrompu (mode fast, metadonnees temporelles cassees) |
| `rawVideoUrl` / `rushUrls[0]` | MP4 ~18 Mo | Valide mais illisible en streaming (moov atom a la fin + pas de range requests) |
| `musicUrl` | `null` | Jamais passe au Studio Son |
| `voiceUrl` | `null` | Jamais passe au Studio Son |
| `hasAudio` | absent | Flag ajoute apres la creation de ces posts |
| `renderedVideoUrl` | absent | Jamais passe au Studio Son |

### Fichiers concernes

Le code du Calendrier se trouve dans `src/app/dashboard/calendar/page.tsx`. Le compositeur video est dans `src/lib/video-composer.ts`. Le Studio Son est dans `src/app/dashboard/audio-studio/page.tsx`. Les metadonnees des posts sont dans la table `scheduled_posts` (colonne `metadata`, type JSON).

---

## Conventions de code

- **Langue du code** : Variables et fonctions en anglais, UI et contenu en francais
- **Imports** : Toujours utiliser `@/` (pas de chemins relatifs profonds)
- **Types** : Definis dans `src/lib/types/database.ts` et `src/lib/types/api.ts`
- **API routes** : Pattern REST, NextResponse, auth via `getServerSession()`
- **Composants UI** : Dans `src/components/ui/` (Button, Card, Modal, etc.)
- **Couleurs** : Primary `#7C3AED` (purple), Accent `#EC4899` (pink), Magenta `#D91CD2`, Dark `#0A0A0F`
- **Fonts** : Inter (UI), Anton, Syne, Bebas Neue, Poppins, Space Grotesk (editeur infographie) — via `next/font/google` avec CSS variables
- **Theme** : Dark mode uniquement
- **Panneaux UI** : Les controles contextuels utilisent `FloatingPanel` (draggable, glassmorphism) + `ColorWheel` (react-colorful, toujours visible)
- **Persistance** : Les preferences utilisateur (couleurs, typo, positions) sont sauvegardees dans localStorage et restaurees au chargement

---

## Deploiement

Chaque push sur `main` declenche un auto-deploy Vercel. Le build prend ~45-60s. Le projet est sur le plan Pro Vercel (`maxDuration: 300s` pour les fonctions).

**Domaine** : studiio.pro
**Vercel project** : `studiio-saas-app` sous `bassicustomshoes-3610s-projects`

---

## Automatisation navigateur

Quand l'utilisateur te demande de **scraper une page web** ou **d'interagir avec un site** (vérifier un rendu en ligne, extraire du contenu, tester une URL, lire une doc externe, etc.), utilise **toujours** le skill Playwright local situé dans `.claude/skills/playwright/`.

### Protocole obligatoire

1. **Lis d'abord `SKILL.md`** (`.claude/skills/playwright/SKILL.md`) avant d'écrire ou de modifier le moindre script. C'est la source de vérité pour l'usage, la sortie attendue et les dépendances.
2. **Utilise le script existant** `.claude/skills/playwright/scripts/run.js` plutôt que de créer un nouveau script ad-hoc. Si un cas particulier nécessite une variante, ajoute un nouveau fichier dans `.claude/skills/playwright/scripts/` — ne crée rien en dehors du dossier du skill.
3. **Renvoie uniquement du JSON** dans la réponse finale à l'utilisateur pour ce genre de tâche. Pas de commentaire en prose, pas de markdown autour — juste le bloc JSON brut (ou un bloc ```json``` s'il faut le rendre lisible).
4. Si Chromium n'est pas installé dans l'environnement courant, indique-le clairement et propose `npx playwright install chromium` plutôt que d'inventer un fallback.

### Exemple d'invocation

```bash
node .claude/skills/playwright/scripts/run.js https://example.com
```

Retourne un objet `{ title, text, links }` après avoir retiré nav/footer/bannières cookies.

---

## Pour commencer a contribuer

1. Lire ce fichier en entier
2. Lire `README.md` pour la reference des routes API
3. Explorer `src/lib/types/database.ts` pour comprendre les types
4. Explorer `src/app/dashboard/` pour les pages principales
5. Le fichier le plus complexe est `src/lib/video-composer.ts` (839 lignes) — le lire attentivement avant de toucher au pipeline video
6. Tester en local avec `npm run dev` et verifier la console navigateur pour les warnings

---

## DÉMARRAGE DE SESSION
1. Lire tasks/lessons.md — appliquer toutes les leçons avant de toucher quoi que ce soit
2. Lire tasks/todo.md — comprendre l'état actuel
3. Si aucun des deux n'existe, les créer avant de commencer

## WORKFLOW

### 1. Planifier d'abord
- Passer en mode plan pour toute tâche non triviale (3+ étapes)
- Écrire le plan dans tasks/todo.md avant d'implémenter
- Si quelque chose ne va pas, STOP et re-planifier — ne jamais forcer

### 2. Stratégie sous-agents
- Utiliser des sous-agents pour garder le contexte principal propre
- Une tâche par sous-agent
- Investir plus de compute sur les problèmes difficiles

### 3. Boucle d'auto-amélioration
- Après toute correction : mettre à jour tasks/lessons.md
- Format : [date] | ce qui a mal tourné | règle pour l'éviter
- Relire les leçons à chaque démarrage de session

### 4. Standard de vérification
- Ne jamais marquer comme terminé sans preuve que ça fonctionne
- Lancer les tests, vérifier les logs, comparer le comportement
- Se demander : « Est-ce qu'un staff engineer validerait ça ? »

### 5. Exiger l'élégance
- Pour les changements non triviaux : existe-t-il une solution plus élégante ?
- Si un fix semble bricolé : le reconstruire proprement
- Ne pas sur-ingénieriser les choses simples

### 6. Correction de bugs autonome
- Quand on reçoit un bug : le corriger directement
- Aller dans les logs, trouver la cause racine, résoudre
- Pas besoin d'être guidé étape par étape

## PRINCIPES FONDAMENTAUX
- Simplicité d'abord — toucher un minimum de code
- Pas de paresse — causes racines uniquement, pas de fixes temporaires
- Ne jamais supposer — vérifier chemins, APIs, variables avant utilisation
- Demander une seule fois — une question en amont si nécessaire, ne jamais interrompre en cours de tâche

## GESTION DES TÂCHES
1. Planifier → tasks/todo.md
2. Vérifier → confirmer avant d'implémenter
3. Suivre → marquer comme terminé au fur et à mesure
4. Expliquer → résumé de haut niveau à chaque étape
5. Apprendre → tasks/lessons.md après corrections

## APPRENTISSAGES
(Claude remplit cette section au fil du temps)
