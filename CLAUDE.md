# CLAUDE.md — Guide pour nouveau developpeur

Ce fichier est un prompt complet pour qu'un nouveau developpeur (ou un agent IA) puisse comprendre et travailler sur le projet Studiio sans poser de questions.

---

## ⚠️ RÈGLE DE COMMUNICATION ABSOLUE — UNE SEULE INSTRUCTION À LA FOIS

L'utilisateur a répété cette règle des dizaines de fois. **NON-NÉGOCIABLE.**

Quand tu réponds à l'utilisateur :

1. **UNE seule action lui demander**, jamais plusieurs étapes empilées
2. **Pas de plans multi-étapes** ("d'abord X, puis Y, puis Z") dans une seule réponse — tu envoies X, tu attends son retour, tu envoies Y
3. **Pas de listes d'options** quand une décision est requise — propose UNE recommandation, il dira non si désaccord
4. **Pas de récap** sauf si demandé explicitement
5. **Pas de "pendant que tu fais ça je fais autre chose"** — concentre-toi sur LA prochaine étape, point

**Format type d'une bonne réponse :**
- 1 phrase de contexte (max)
- 1 action à faire / 1 commande à exécuter / 1 question
- STOP

**Format à NE JAMAIS faire :**
- "Voici 3 options : ..."
- "Étape 1 : ... / Étape 2 : ... / Étape 3 : ..."
- "Pendant que tu fais X, je vais aussi Y et Z"
- "Pour la suite : (5 puces)"
- Des tableaux récapitulatifs sans qu'on les demande

Si tu te surprends à écrire plus d'une instruction → efface, garde juste la première, attends le retour utilisateur.

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
| Database | Postgres 16-alpine auto-heberge + PostgREST | 16 |
| Storage | MinIO auto-heberge (`STORAGE_PROVIDER=s3`) | - |
| Auth | NextAuth v5 beta | 5.0.0-beta.19 |
| Paiements | Stripe | v15 |
| Video (client) | Canvas + MediaRecorder | - |
| Video (server) | Remotion | 4.0.441 |
| Audio | mp4-muxer, webm-muxer, FFmpeg WASM | - |
| TTS | msedge-tts | 2.x |
| Email | Resend (REST) | - |
| i18n | next-intl | 4.x |
| Hebergement | Hetzner + Coolify v4 | - |
| Validation | Zod | 3.x |
| Color Picker | react-colorful | 3.x |
| Fonts | next/font/google | - |

**Path alias** : `@/*` mappe vers `./src/*` (configure dans tsconfig.json).

**Polices Google Fonts** : 5 polices chargees via `next/font/google` avec CSS variables : Anton (`--font-anton`), Syne (`--font-syne`), Bebas Neue (`--font-bebas`), Poppins (`--font-poppins`), Space Grotesk (`--font-space`).

---

## Infrastructure reelle (post-migration Hetzner)

> Verifie en production sur Coolify le **2026-07-28**. Cette section fait autorite sur toute
> mention de Vercel ou de Supabase cloud ailleurs dans ce fichier (mentions historiques non
> encore nettoyees).

### Hebergement

Le projet ne tourne **plus sur Vercel**. Il tourne sur un serveur **Hetzner** (`178.105.201.62`)
pilote par **Coolify v4**. L'application est le service `studiio-app` : une image Next.js
construite depuis le `Dockerfile` du repo.

### Base de donnees

La base est **auto-hebergee sur le meme serveur Hetzner**, ce n'est plus Supabase cloud :

| Service Coolify | Role |
|-----------------|------|
| `studiio-db` | Postgres **16-alpine** — user `studiio`, database `studiio` |
| `studiio-postgrest` | API REST sur la base, exposee sur le port `3000` |
| `studiio-pgrst-proxy` | Proxy devant PostgREST |

Cote **serveur**, la variable `SUPABASE_URL` pointe vers ce **PostgREST auto-heberge** — le nom
de la variable est un residu historique, la valeur ne designe plus Supabase cloud.

#### ⚠️ Toute migration exige DEUX etapes de plus

Creer une table ne suffit pas : PostgREST la renvoie en erreur
« Could not find the table ... in the schema cache » tant que l'on n'a pas :

1. **Donne les droits** au role PostgREST, sinon la table n'entre jamais dans le cache :
   ```sql
   grant all on table public.ma_table to public;
   ```
2. **Recharge le cache de schema**, que PostgREST ne lit qu'au demarrage :
   ```bash
   docker kill -s SIGUSR1 studiio-postgrest
   ```
   (n'arrete pas le conteneur, demande juste la relecture du schema)

Ces deux etapes sont a repeter apres **chaque** migration creant ou modifiant une table.
Les oublier produit un bug qui ressemble a une erreur applicative alors qu'il est purement
infrastructurel.

### Stockage

**MinIO auto-heberge** (service `studiio-minio`), active par `STORAGE_PROVIDER=s3`. Les rushes et
les montages y sont stockes. Ce n'est plus Supabase Storage.

### ⚠️ Migration a moitie faite — risque de production actif

`NEXT_PUBLIC_SUPABASE_URL`, la variable utilisee **cote client / navigateur**, pointe **encore**
vers le projet Supabase cloud `lhuqdmlkhezdwzwlpfqo.supabase.co`.

Ce projet cloud est en **plan gratuit, en depassement de quota, grace period terminee**. S'il est
coupe par Supabase, **tout ce qui passe encore par le client cassera** — sans aucun deploiement de
notre cote, donc sans signal preventif.

**A nettoyer (tache prioritaire de fiabilite)** : faire pointer le client vers le PostgREST
auto-heberge, ou supprimer purement et simplement la dependance client a Supabase. Tant que ce
n'est pas fait, la migration Hetzner n'est pas terminee.

### Sauvegardes et points de restauration

- **Base** : `studiio-db` est sauvegarde **quotidiennement a 03h00** (cron `0 3 * * *`), en local
  sur le serveur, via Coolify.
- **Code** : point de restauration = tag Git **`v2-baseline-2026-07-28`** (commit `814d609`).
- **Rollback** : redeployer un commit anterieur depuis Coolify.

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

### Delivrabilite email — RÈGLE ABSOLUE

**Tout email part de `sendEmail()` / `sendEmailSilent()` (`src/lib/email/resend.ts`). Jamais d'appel direct a `api.resend.com`.**

Ce point unique garantit trois exigences Gmail, qu'un seul contournement suffit
a casser pour tout le domaine :

| Exigence | Ou c'est traite |
|----------|-----------------|
| `from` = `RESEND_FROM` (le seul domaine dont SPF/DKIM/DMARC sont alignes) | `resend.ts`. **`RESEND_FROM` est OBLIGATOIRE** : sans elle l'envoi est annule. Il n'y a plus de repli `noreply@studiio.pro` — un expediteur non authentifie, c'est du spam garanti en silence. |
| En-tetes `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` | injectes pour tout envoi `unsubscribable: true` a UN destinataire |
| Version `text/plain` en plus du HTML | derivee du HTML par `htmlToText()` si l'appelant n'en fournit pas |

**`unsubscribable` — a passer a `true` pour TOUT envoi en nombre**, et a lui seul
(canal email du cron, campagnes `/api/admin/email/test`). Defaut `false` : un
email transactionnel — recu de paiement, bienvenue, compte suspendu — ne doit
pas annoncer un desabonnement qu'on ne peut pas honorer. Une desinscription
annoncee puis ignoree est ce qui transforme un desabo en signalement spam.

**Tout envoi en nombre doit aussi appeler `isSuppressed()` / `filterSuppressed()`**
avant d'envoyer. Un en-tete de desabonnement sans filtre en amont ne sert a rien.

Le desabonnement vit dans `src/lib/email/unsubscribe.ts` + `/api/email/unsubscribe` :

- L'URL porte l'adresse et un **HMAC** de cette adresse (`UNSUBSCRIBE_SECRET`,
  a defaut `AUTH_SECRET`). Sans jeton valide, rien n'est ecrit.
- **POST** = un-clic Gmail, repond 200 meme si la persistance echoue (un 5xx
  ferait reessayer Gmail en boucle et abimerait la reputation).
- **GET** = page de confirmation, **sans effet de bord** : les antivirus et
  previsualiseurs visitent les liens des emails et desabonneraient a l'insu
  des gens.
- La suppression est ecrite dans `email_suppressions` (migration
  `2026-07-29-email-suppressions.sql`) puis relayee a afroboost en
  best-effort.
- **Aucun en-tete n'est emis tant que la table n'existe pas** :
  `suppressionStoreReady()` sonde la table (resultat memoise 60 s). Sans cela,
  l'endpoint repondrait 200 a Gmail sans rien enregistrer — pire que de ne
  rien annoncer. Les en-tetes reapparaissent seuls apres la migration, sans
  redeploiement.
- `filterSuppressed()` est appelee **avant chaque diffusion**, en plus de la
  liste opt-in afroboost relue elle aussi sans cache.

Variables : `RESEND_FROM`, `RESEND_API_KEY`, `RESEND_REPLY_TO`,
`AFROBOOST_LIST_API_KEY`, `NEXT_PUBLIC_APP_URL` (base de l'URL de desabo).

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

## Inventaire des icones SVG du site

> Recense au **2026-07-28**. Sert de reference pour le point F1 du cahier des charges v2
> (« deux icones grille se ressemblent trop »).

### Fait structurant : il n'y a AUCUN fichier `.svg` dans le repo

`find public src -name '*.svg'` ne retourne **rien**. Toutes les icones du site viennent de
**trois sources** et de nulle part d'ailleurs :

| Source | Ou | Nature |
|--------|-----|--------|
| **lucide-react** | 48 fichiers `.tsx` | Composants React, glyphes stroke |
| **Chemins SVG inline** | 3 fichiers | Constantes `Record<string, string>` de `path d="..."` |
| **Emojis** | editeur `/creer` | Caracteres Unicode, pas des SVG |

Les seuls fichiers d'image de `public/` sont `favicon.ico`, `favicon-32.png`, `icon-192.png`,
`icon-512.png` (PWA, references par `manifest.json`) — aucun n'est un SVG.

### 1. Bibliotheque d'icones de l'editeur (onglet « Icones SVG »)

Definie dans `src/app/dashboard/creer/page.tsx` — **et non `/dashboard/infographie`**, qui est
une page distincte et plus ancienne.

Deux constantes travaillent ensemble :

- **`ICON_MAP`** (ligne ~98) : `Record<string, LucideIcon>`, nom → composant. Les imports sont
  **explicites et non `import * as LucideIcons`** : le tree-shaking de production supprimait les
  icones resolues dynamiquement, et le nom brut de l'icone s'affichait alors en texte dans la
  carte. Ne jamais repasser a un import namespace.
- **`ICON_LIBRARY`** (ligne ~285) : `Record<categorie, string[]>`, ce qui est reellement affiche
  dans le picker, groupe par categorie.

Les **24 categories** et leur contenu :

| Categorie (cle) | Nb | Icones |
|-----------------|----|--------|
| `sport` | 9 | Dumbbell, Flame, Zap, Trophy, Target, Activity, Bike, Medal, Crown |
| `santé` | 9 | Heart, Brain, Stethoscope, Pill, Cross, HeartPulse, Syringe, Thermometer, Bone |
| `nutrition` | 7 | Apple, Carrot, Salad, Coffee, Pizza, Utensils, Wheat |
| `temps` | 11 | Clock, Timer, AlarmClock, Watch, Hourglass, Calendar, CalendarDays, CalendarCheck, CalendarClock, Sunrise, Sunset |
| `nature` | 12 | Leaf, Sun, Moon, Star, Cloud, Flower, TreePine, Sprout, Trees, TreeDeciduous, Waves, Mountain |
| `météo` | 6 | CloudRain, CloudSnow, Snowflake, Wind, Umbrella, Rainbow |
| `tech` | 12 | Laptop, Smartphone, Cpu, Wifi, Battery, Code, Bot, Database, Server, Terminal, Bug, FileCode |
| `finance` | 13 | DollarSign, TrendingUp, TrendingDown, Gem, Briefcase, Wallet, BarChart, PieChart, Receipt, HandCoins, Landmark, PiggyBank, Coins |
| `multimedia` | 17 | Palette, Camera, Music, Mic, Video, PenTool, Brush, Paintbrush, Image, Aperture, Clapperboard, Disc, Volume2, Headphones, Speaker, Radio, Podcast |
| `loisirs` | 4 | Gamepad2, Joystick, Puzzle, Diamond |
| `voyage` | 14 | Plane, Globe, Map, Compass, MapPin, MapPinned, Route, Hotel, Tent, Navigation, Flag, Anchor, Sailboat, Footprints |
| `émotions` | 13 | Smile, Frown, Meh, Laugh, Award, ThumbsUp, Gift, Bell, Megaphone, PartyPopper, Sparkles, Cake, Crown |
| `famille` | 5 | Baby, Users, User, UserPlus, PersonStanding |
| `animaux` | 6 | Dog, Cat, Bird, Fish, Rabbit, Turtle |
| `logement` | 6 | Home, Building, Store, Warehouse, Factory, Church |
| `transport` | 7 | Car, Bike, Train, Rocket, Ship, Bus, Truck |
| `communication` | 6 | Mail, MessageSquare, MessageCircle, Send, Inbox, Archive |
| `outils` | 11 | Clipboard, ClipboardList, FileText, File, Folder, FolderOpen, Filter, Settings2, Wrench, Hammer, Scissors |
| `sécurité` | 7 | Shield, ShieldCheck, ShieldAlert, Lock, Unlock, Key, Fingerprint |
| `énergie` | 4 | Plug, Power, BatteryCharging, Signal |
| `shopping` | 5 | ShoppingBag, ShoppingCart, Tag, Package, CreditCard |
| `education` | 6 | Book, GraduationCap, Lightbulb, Library, Pencil, Ruler |

**`ICON_KEYWORDS`** (ligne ~310) ajoute des synonymes francais pour la recherche (ex.
`Dumbbell: ['haltère', 'musculation']`), mais ne couvre que ~30 icones sur ~200.

**Duplication a connaitre** : `CARD_ICON_MAP` dans `src/components/ui/CardIcon.tsx` est une
**copie quasi-identique** de `ICON_MAP`. Le commentaire du fichier le dit explicitement : les deux
doivent rester synchronises, sinon une icone ajoutee cote editeur s'affiche vide dans l'apercu du
Calendrier. C'est une source de bug latente.

Le picker est instancie **3 fois** dans `creer/page.tsx` (lignes ~518, ~10112, ~10517) : icone de
carte, icone de titre (`titleIconName`), icone de CTA (`ctaIconName`).

### 2. Icones d'UI de l'editeur `/creer`

**Barre d'outils utilitaire** (lignes ~8038-8102), de gauche a droite :

| Icone | Ligne | Fonction |
|-------|-------|----------|
| `Undo2` / `Redo2` | ~7990 | Annuler / refaire (Cmd+Z, Cmd+Shift+Z) |
| `Crosshair` | 8052 | Afficher/masquer les guides (centre + tiers) |
| `Grid3x3` | 8065 | Afficher/masquer la **grille visuelle** de fond |
| `Grid3x3` ou `Move` | 8078 | Basculer **mode grille ↔ mode libre** des cartes |
| `ImageIcon` | ~8101 | Ouvrir le panneau **Fond** de la sequence active |

**Rail de navigation** (`railItems`, ligne ~5709) — 7 onglets :

| Onglet | Icone | Couleur |
|--------|-------|---------|
| Modeles | `LayoutGrid` | purple |
| Elements | `Sparkles` | amber |
| Texte | `Type` | blue |
| Cartes | `Grid2x2` | pink |
| Medias | `Film` | emerald |
| Audio | `Music` | cyan |
| Parametres | `SettingsIcon` (alias de `Settings`) | slate |

**Selecteur de sequences** (ligne ~7963) :

| Sequence | Icone | Couleur |
|----------|-------|---------|
| Titre | `Type` | amber |
| Cartes | `LayoutGrid` | pink |
| Video (si rush) | `Film` | emerald |
| CTA | `Megaphone` | blue |

Chaque bouton de sequence porte un second bouton `Eye` / `EyeOff` (ligne ~8011) : inclure ou
exclure la sequence de l'export. Le bouton Lire/Stop utilise `Play` / `Pause` (ligne ~7940).

**Autres actions de l'editeur** : `Combine` (grouper, 10373), `Ungroup` (degrouper, 10382),
`CopyPlus` (dupliquer le groupe, 10391), `Group` (badge de groupe sur une carte, 9631),
`CopyIcon` (dupliquer un element, 8292 / 11516), `Grid3x3` (reinitialiser les positions des
cartes, 7022), `Rows3` / `Columns3` (distribuer vertical / horizontal, 6328 / 6335),
`Layers` (destination d'export « Les deux », 11961 / 12057), `Video` (export MP4, 11939).

### 3. Chemins SVG inline (3 fichiers)

| Fichier | Constante | Contenu |
|---------|-----------|---------|
| `src/components/ui/PlatformIcon.tsx` | `PLATFORM_SVG_PATHS` | Logos officiels : `instagram`, `tiktok`, `youtube`, `facebook` (+ `PLATFORM_COLORS` : `#E1306C`, `#00F2EA`, `#FF0000`, `#1877F2`) |
| `src/components/ui/DesignOption.tsx` | `DESIGN_ICON_PATHS` | 10 cles style Material : `font`, `filter_none`, `filter_neon`, `filter_cinematic`, `filter_warm`, `filter_cool`, `card_compact`, `card_stats`, `card_minimal`, `card_fullwidth` |
| `src/components/LanguageSelector.tsx` | — | Un unique chevron bas inline (`M19 9l-7 7-7-7`), qui pivote a l'ouverture |

`src/components/creer/SmartGuides.tsx` produit du SVG (`<rect>`, lignes de guides dans un
`viewBox="0 0 100 100"`) mais **ne contient aucune icone** — ce sont les guides d'alignement.

### 4. Icones lucide par zone applicative

| Zone | Fichier | Icones |
|------|---------|--------|
| Sidebar | `layout/Sidebar.tsx` | LayoutDashboard, Zap, Library, Share2, Calendar, Shield, Settings, Menu, X |
| Navbar | `layout/Navbar.tsx` | Bell, User, LogOut, Shield, Zap |
| Sidebar admin | `layout/AdminSidebar.tsx` | LayoutDashboard, Users, CreditCard, Zap, Film, Settings, FileText, Mail, Shield, ArrowLeft, Globe |
| Calendrier | `dashboard/calendar/page.tsx` | ChevronLeft, ChevronRight, Plus, Upload, Edit2, Copy, FileVideo, Eye, Send, Trash2, Clock, Bot, Loader2, FileText, Calendar, Music, CheckSquare, ImageIcon, Sparkles, Play, CalendarDays, Mic, Volume2, VolumeX, Download, Film, RefreshCw, AlertTriangle |
| Bibliotheque | `dashboard/library/page.tsx` | Play, Trash2, Download, Film, Loader2, Copy, Edit, Share2, X |
| Reseaux sociaux | `dashboard/social/page.tsx` | Instagram, Music2, Facebook, Youtube, Check, Loader2, X, Settings, Hash, FileText, Bell, ExternalLink |
| Accueil dashboard | `dashboard/page.tsx` | Video, Film, Zap, Eye, Sparkles, Calendar, Music, Library, Share2, Settings, ArrowRight |
| Parametres | `dashboard/settings/page.tsx` | Target, CreditCard, Palette, User, LogOut |
| Studio Son | `creer/AudioStudioPanel.tsx` | Music, Mic, Upload, Trash2, Volume2, VolumeX, Loader2, Play, Pause, Square, Sparkles, ImageIcon, LayoutGrid, Film, Megaphone |
| Voix par sequence | `creer/SequenceVoicesPanel.tsx` | Mic, Square, Sparkles, Loader2, Trash2, Play, Pause, AlertTriangle, Info |
| Editeur d'image | `creer/ImageEditorPanel.tsx` | Sun, Contrast, Palette, Thermometer, Sparkles, CircleOff, Upload, Link2, Trash2, ImageIcon, Wand2, Eraser, Maximize, Video, Paintbrush, Layers, ArrowUpCircle, Move |
| Agent IA | `creer/AgentIAModal.tsx` | Bot, Loader2, Folder, FileVideo, ImageIcon, Music, CalendarDays |
| Mediatheque | `shared/MediaLibrary.tsx` | Search, Upload, Loader2, Music, X, Clock, ShieldCheck, Trash2 |
| Barre d'export | `shared/ExportBar.tsx` | Calendar, Download, Loader2 |
| Assistant chat | `chat/StudiioAssistant.tsx` | MessageCircle, X, Send, Loader2 |
| Landing publique | `app/page.tsx` | ArrowRight, Zap, Sparkles, BarChart3, Play, Check, Star, Video, Calendar, Share2, Target, Palette, Globe, Shield, ChevronDown, ChevronUp, Users, TrendingUp, Clock, Award, Smartphone, Monitor, Instagram, Youtube, Facebook, Music, Menu, X |
| Composants `ui/` | Modal, FloatingPanel, Table, ServiceAlertBanner | X, ChevronUp, ChevronDown, AlertTriangle |

### 5. ⚠️ Icones qui se ressemblent et pretent a confusion

C'est la liste de travail pour **F1.4** du cahier des charges v2.

**A. Le bug signale — deux `Grid3x3` cote a cote dans la meme barre d'outils**

Ligne **8065** et ligne **8078** de `creer/page.tsx` rendent le **meme glyphe `Grid3x3`**, dans
deux boutons **adjacents**, pour deux fonctions differentes :

- 8065 → afficher/masquer la **grille visuelle** de reperage
- 8078 → basculer le **mode de positionnement des cartes** (grille ↔ libre)

Le seul indice visuel differenciant est la couleur de l'etat actif (cyan pour la grille, orange
pour le mode libre) — invisible tant que les deux sont inactifs. **Le bouton 8078 n'affiche
`Grid3x3` que lorsqu'il est en mode grille** ; en mode libre il devient `Move`. Autrement dit les
deux boutons sont identiques exactement dans l'etat par defaut. C'est bien la confusion decrite
dans le cahier des charges.

**B. Un troisieme `Grid3x3`, ailleurs**

Ligne **7022**, le bouton « Positions » (reinitialiser les positions individuelles des cartes)
utilise encore `Grid3x3`. Trois fonctions distinctes partagent donc un seul glyphe.

**C. « Cartes » a deux icones differentes**

- Rail lateral, onglet « Cartes » → `Grid2x2` (ligne 5713)
- Selecteur de sequence, « Cartes » → `LayoutGrid` (ligne 7965)

Le meme concept metier a deux representations. Et `Grid2x2` / `Grid3x3` / `LayoutGrid` sont trois
variantes de grille tres proches a 16 px.

**D. `LayoutGrid` designe deux choses opposees**

- Rail, onglet « **Modeles** » → `LayoutGrid` (5710)
- Sequence « **Cartes** » → `LayoutGrid` (7965)

**E. `Film` vs `Video` vs `FileVideo` vs `Clapperboard`**

Quatre glyphes video coexistent : `Film` (rail « Medias » 5714, sequence « Video » 7967,
« Mediatheque » 6141), `Video` (« Televerser video » 6125, export MP4 11939), `FileVideo`
(Calendrier, Agent IA), `Clapperboard` (bibliotheque d'icones, categorie multimedia). `Film` sert
a la fois pour « Medias » et pour « Video », deux entrees differentes du meme ecran.

**F. `Copy` vs `CopyPlus`**

« Dupliquer » un element utilise `CopyIcon` (8292, 11516), « dupliquer un groupe » utilise
`CopyPlus` (10391). Glyphes tres proches, actions voisines.

**G. `Crosshair` vs `Grid3x3`, boutons voisins**

Guides d'alignement et grille sont deux aides visuelles differentes, cote a cote, sans libelle.

**H. `Settings` vs `Settings2`**

`Settings` (engrenage) pour l'onglet Parametres du rail et la sidebar ; `Settings2` (curseurs)
dans la bibliotheque d'icones, categorie `outils`.

**I. `Zap` porte trois sens**

Sidebar → « Creer » ; `CreditsDisplay` + Navbar → **credits** ; landing + signup → argument
marketing « rapidite » ; et il est aussi dans la categorie `sport` du picker.

**J. `Music` vs `Music2`**

`Music` = audio partout dans l'app ; `Music2` = **logo TikTok** dans `dashboard/social`.

**K. Doublons internes a la bibliotheque d'icones** (moins critiques, choix utilisateur assume)

`Crown` est dans `sport` **et** `émotions` ; `Bike` dans `sport` **et** `transport` ; `Palette`,
`Camera`, `Music`, `Mic`, `Video` sont a la fois dans `multimedia` et utilises comme icones d'UI.
Les familles `Calendar*` (5 variantes), `Shield*` (3), `BarChart*` (3), `Tree*` (3) sont proches
a petite taille.

---

## Conventions de code

- **Langue du code** : Variables et fonctions en anglais, UI et contenu en francais
- **Imports** : Toujours utiliser `@/` (pas de chemins relatifs profonds)
- **Types** : Definis dans `src/lib/types/database.ts` et `src/lib/types/api.ts`
- **API routes** : Pattern REST, NextResponse, auth via `getServerSession()`
- **Composants UI** : Dans `src/components/ui/` (Button, Card, Modal, etc.)
- **Icônes — RÈGLE ABSOLUE** : Toujours utiliser des **icônes SVG** (jeu lucide via `CardIcon` / `ICON_MAP`), **JAMAIS d'emojis** dans le contenu généré (cartes, titres, CTA, séquences) ni dans l'UI. Les emojis (🔥, 💪, etc.) sont proscrits — même quand `smart-content` ou l'assistant propose un `icon`, il doit résoudre vers un nom d'icône lucide SVG, pas un caractère emoji. Si une carte reçoit un emoji, le remplacer par l'icône SVG équivalente. Cette règle a été demandée explicitement par l'utilisateur : les icônes emoji ne doivent plus apparaître.
- **Couleurs** : Primary `#7C3AED` (purple), Accent `#EC4899` (pink), Magenta `#D91CD2`, Dark `#0A0A0F`
- **Fonts** : Inter (UI), Anton, Syne, Bebas Neue, Poppins, Space Grotesk (editeur infographie) — via `next/font/google` avec CSS variables
- **Theme** : Dark mode uniquement
- **Panneaux UI** : Les controles contextuels utilisent `FloatingPanel` (draggable, glassmorphism) + `ColorWheel` (react-colorful, toujours visible)
- **Persistance** : Les preferences utilisateur (couleurs, typo, positions) sont sauvegardees dans localStorage et restaurees au chargement

---

## Deploiement

Le deploiement se fait via **Coolify v4** sur le serveur Hetzner `178.105.201.62`, a partir du
`Dockerfile` du repo (service `studiio-app`). Voir la section **Infrastructure reelle
(post-migration Hetzner)** pour le detail des services.

**Domaine** : studiio.pro

> Historique : le projet a ete heberge sur Vercel (`studiio-saas-app` sous
> `bassicustomshoes-3610s-projects`). Les mentions de Vercel ailleurs dans ce fichier (limite de
> payload 4.5 Mo, cron, previews) datent de cette periode et n'ont pas encore ete revues.

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
3. Lire tasks/pre-pr-checklist.md — la checklist anti-régression à respecter à chaque merge
4. Si aucun des trois n'existe, les créer avant de commencer

## ANTI-RÉGRESSION (lecture obligatoire avant tout merge)

`tasks/pre-pr-checklist.md` liste 7 flux critiques à smoke-tester sur preview Vercel
avant chaque merge. Le respecter est NON-NÉGOCIABLE tant que l'étape 3 (Playwright
E2E sur CI) n'est pas en place.

Trois règles méta à appliquer en permanence :
1. **Grep avant modif** — si `<state>` apparaît N fois dans le fichier, modifier les
   N occurrences ou expliquer dans la PR pourquoi seulement K. Ne JAMAIS modifier
   1 occurrence sans avoir listé les autres.
2. **Default safe** — toute nouvelle option/flag doit avoir un default qui garantit
   le comportement actuel (rétro-compat 100%). Sans ce default, c'est une régression
   pour tous les configs/posts existants.
3. **Hard-refresh sur preview Vercel** avant de merger, jamais sur le local. Le local
   échoue souvent à cause d'env vars, ce qui n'est pas un signal valide.

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

## AUTO-MERGE DES PRs
Quand l'utilisateur demande un fix, un changement de code ou une correction de bug, le workflow par défaut est : (1) faire les modifications, (2) commit, (3) push sur une branche dédiée, (4) créer une PR draft, (5) merger directement la PR en squash sans attendre confirmation supplémentaire. L'utilisateur n'a pas à dire "merge la PR" à chaque fois — c'est l'étape par défaut. Exception : si la modification touche à des fichiers sensibles (auth, paiements Stripe, base de données structure, secrets) ou si elle dépasse 300 lignes de diff, demander confirmation avant de merger.

## APPRENTISSAGES
(Claude remplit cette section au fil du temps)
