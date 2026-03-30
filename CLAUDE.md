# Studiio.pro - Plateforme SaaS de Creation Video Automatisee

## Contexte du Projet
Studiio.pro est la version web (SaaS multi-utilisateurs) de l'application desktop **Afroboost Studio** (Electron + Remotion + React 19). L'objectif est de porter TOUTES les fonctionnalites desktop vers le web (Next.js 14 + Vercel + Supabase + Stripe).

Le cahier des charges complet se trouve dans : `docs/CAHIER_DES_CHARGES.md`
L'application desktop de reference se trouve dans le dossier parent : `../afroboost-studio/`

## Stack Technique
- **Frontend** : Next.js 14.2, React 18, TypeScript 5.4, Tailwind CSS 3.4, Lucide React
- **Auth** : NextAuth v5 beta 19 (Google + Facebook OAuth), JWT sessions
- **DB** : Supabase (PostgreSQL) avec @auth/supabase-adapter
- **Paiements** : Stripe (checkout, abonnements, webhooks)
- **TTS** : Edge TTS (msedge-tts) pour synthese vocale
- **Rendu Video** : Remotion 4.0 (a migrer vers Remotion Lambda / Cloud Run)
- **Deploiement** : Vercel (auto-deploy depuis GitHub main)

## Architecture des Pages
| Route | Description |
|-------|-------------|
| `/dashboard` | Vue d'ensemble : 4 stats, videos recentes, credits, actions rapides |
| `/dashboard/creator` | **Createur Video** : Assistant 4 etapes (Config > Medias > Timeline > Rendu). Batch 1-10 videos. |
| `/dashboard/infographic` | **Infographie** : Creation infographies animees 30s avec cartes, themes, preview temps reel |
| `/dashboard/calendar` | **Calendrier IA** : Planning mensuel, Agent IA (30 jours auto), import, scheduling |
| `/dashboard/library` | **Bibliotheque** : Galerie videos, filtres, export/dupliquer/reposter/supprimer |
| `/dashboard/social` | **Reseaux sociaux** : Connexion Instagram/TikTok/Facebook/YouTube + parametres |
| `/dashboard/objectives` | **Objectifs** : Definition objectifs marketing (nom, public, plateforme, ton) |
| `/dashboard/billing` | **Facturation** : Credits, abonnements Stripe, historique transactions |
| `/admin/*` | **Admin** : Users, videos, abonnements, paiements, revenus |

## Fonctionnalites Cles a Porter du Desktop

### 1. Createur Video (App.tsx -> creator/page.tsx)
- **4 etapes** : Configuration (format reel/tv, mode cardio/testimony, objectif, titre) > Medias (1-10 rushes, image perso, musique, voix off) > Timeline (cartes texte avec duree) > Rendu
- **Batch** : 2, 3, 5 ou 10 videos generees simultanement avec renderSeed pour varier clips/cadrage/textes
- **5 objectifs** : promotion, abonnement, motivation, bienfaits, nutrition (20 phrases chacun)
- **12 styles cadrage** : Plan large, zoom haut, miroir, zoom bas, zoom gauche/droite, mini zoom...
- **TTS** : Edge TTS (Denise FR, Henri FR, Aria EN, Guy EN) ou upload perso
- **Rendu** : H.264, 8Mbps, yuv420p, 60s timeout/frame, cache bundle 120s
- **Progression** : Pourcentage temps reel par video, etape affichee

### 2. Infographie (InfographicPage.tsx -> infographic/page.tsx)
- **30 secondes** animees : Intro 3s > Cartes (intervalle 1.6s, slide gauche/droite alternatif) > Mix video optionnel > CTA 5s
- **5 themes** couleur (rose, violet, bleu, vert + or a ajouter), 10 variations chacun
- **Cartes** : emoji + label + valeur + couleur. Grille 2 col (vertical) ou 3 col (horizontal)
- **20+ themes educatifs** via generateSmartContent.ts : sommeil-sport, nutrition-danse, energie-cardio, stress-mental, communaute, hydratation, posture, echauffement, souplesse, frequence-cardiaque...
- **Formats** : 9:16, 16:9, ou les deux simultanement

### 3. Agent IA Autonome (autonomous-planner.ts -> calendar/page.tsx)
- **Scan** rushFolder pour detecter videos (mp4/mov/webm/avi/mkv) et images (jpg/png/webp/gif)
- **Generation 30 jours** : rotation objectifs, selection rushes (moins utilises prioritaires), captions par template
- **3 styles captions** : motivant, vendeur, educatif (banque de phrases + 8-12 hashtags par style)
- **Algorithme rushes** : Separation video/image > tri par usage > randomisation > priorise video > ratio optimal
- **Approbation** : Chaque brouillon doit etre approuve/rejete par l'utilisateur

### 4. Analyse Video / Motion Detection (analyze-video.ts)
- **FFmpeg scene filter** : score mouvement 0-1 par frame
- **Profils** : promo(15 clips), recrutement(12), silent(10), evenement(18)
- **Selection** : Algorithme glouton avec ecart minimum 10s, seed deterministe
- **Extraction** : libx264, ultrafast, CRF 18, 15s timeout/clip

### 5. Publication Sociale (social-publisher.ts -> social/page.tsx + API routes)
- **Instagram** : Meta Graph API v24.0, upload tmpfiles.org, Reels share_to_feed, polling 60x
- **Facebook** : Meta Graph API v24.0, upload resumable 3 phases
- **TikTok** : Content Posting API v2, OAuth CSRF, privacy SELF_ONLY (draft)
- **YouTube** : Data API v3, upload resumable, thumbnail, categorie 22
- **Parametres** : auto-publish, best time IA, hashtags defaut, description defaut

### 6. Systeme de Credits
| Action | Credits |
|--------|---------|
| Rendu Reel 9:16 | 10 |
| Rendu TV 16:9 | 15 |
| Rendu Infographie | 25 |
| Batch 10 Reels | 100 |
| Publication | 0 |
| Agent IA | 0 |

## API Routes
### Existantes
- `/api/auth/[...nextauth]` - NextAuth handlers
- `/api/videos` - GET (liste) / POST (creer)
- `/api/credits/balance` - GET solde
- `/api/social/accounts|connect|disconnect` - Gestion comptes sociaux
- `/api/stripe/create-checkout|create-portal|webhook` - Paiements

### A Creer (Priorite Haute)
- `/api/render` - POST lancer rendu cloud
- `/api/render/batch` - POST batch rendus
- `/api/render/[id]/status` - GET statut rendu
- `/api/tts/edge` - POST synthese vocale
- `/api/agent/generate` - POST plan Agent IA
- `/api/social/publish` - POST publier
- `/api/upload/media` - POST upload cloud storage
- `/api/analyze` - POST analyse motion detection
- `/api/content/generate` - POST contenu educatif

## Base de Donnees (Supabase)
Tables : users, videos, credit_transactions, social_accounts, scheduled_posts, objectives, agent_plans, subscriptions, render_jobs

## Variables d'Environnement
NEXTAUTH_SECRET, NEXTAUTH_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, FACEBOOK_CLIENT_ID, FACEBOOK_CLIENT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY, STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review

## Automatisation navigateur (Playwright)

Un skill Playwright est disponible dans `.claude/skills/playwright/`.
Il permet de scraper une page web en headless et de récupérer le contenu en JSON :

```bash
node .claude/skills/playwright/scripts/run.js <URL>
```

Retourne `{ title, text, links }`. Utile pour :
- Lire de la documentation externe (API Meta, TikTok, Remotion, etc.)
- Vérifier qu'une page déployée charge correctement
- Extraire des données structurées d'un site
