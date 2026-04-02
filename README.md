# Studiio.pro

Plateforme SaaS de creation video IA pour les reseaux sociaux.

## Tech Stack

- **Framework** : Next.js 14 (App Router)
- **Language** : TypeScript
- **Styling** : Tailwind CSS
- **Base de donnees** : Supabase (PostgreSQL + Storage)
- **Authentification** : NextAuth (Google, Facebook, Email)
- **Paiements** : Stripe (abonnements + credits)
- **Deploiement** : Vercel (auto-deploy depuis GitHub main)

---

## Architecture des pages

### Pages publiques

| Route | Description |
|---|---|
| `/` | Landing page marketing (hero, features, temoignages, pricing) — contenu CMS dynamique |
| `/auth/login` | Connexion (OAuth Google/Facebook + email) |
| `/auth/signup` | Inscription avec selection de plan et periode de facturation |
| `/privacy` | Politique de confidentialite (TikTok, Instagram, Facebook, YouTube) |
| `/terms` | Conditions d'utilisation (contenu dynamique depuis API) |

### Dashboard utilisateur

| Route | Description |
|---|---|
| `/dashboard` | Accueil — stats videos, credits, videos recentes |
| `/dashboard/creator` | **Creer** — creation video avec branding, clips, contenu IA, export |
| `/dashboard/infographic` | **Infographie** — generateur de contenus visuels/infographies avec themes, templates, generation IA, export batch x10 |
| `/dashboard/infographie` | Version francaise de la page infographie |
| `/dashboard/audio-studio` | **Studio Son** — composition audio (musique + voix), apercu video avec timeline, export batch ou single vers calendrier/bureau |
| `/dashboard/calendar` | **Calendrier** — planification et gestion des posts, apercu complet, publication automatique via cron, agent IA (7/14/30 jours) |
| `/dashboard/library` | **Bibliotheque** — consultation, recherche, filtrage, telechargement des videos creees |
| `/dashboard/social` | **Reseaux sociaux** — connexion/deconnexion des comptes (Instagram, TikTok, YouTube, Facebook), parametres de publication |
| `/dashboard/objectives` | **Objectifs** — definition des objectifs de contenu (plateforme, audience cible, ton) |
| `/dashboard/billing` | **Facturation** — solde credits, historique transactions, packages, portail abonnement |

### Administration

| Route | Description |
|---|---|
| `/admin` | Dashboard admin — stats globales (users, revenus, abonnements, videos) |
| `/admin/users` | Gestion des utilisateurs (recherche, roles, credits, statuts) |
| `/admin/videos` | Gestion des videos rendues (filtre par statut, format, utilisateur) |
| `/admin/payments` | Historique des paiements + analytics + export CSV |
| `/admin/subscriptions` | Gestion des abonnements actifs |
| `/admin/emails` | Gestion des emails (notifications, templates, envoi en masse) |
| `/admin/landing` | CMS pour la landing page (hero, features, temoignages, FAQ, pricing) |
| `/admin/settings` | Parametres (maintenance, inscriptions, IA, credits gratuits) |
| `/admin/terms` | Editeur des CGU avec versionning |
| `/admin/logs` | Journal d'audit des actions admin |

---

## Fonctionnalites principales

### Creation video

- **Page Creer** (`/dashboard/creator`) : creation video complete avec panneau branding, detection de clips, generation de contenu IA, export vers calendrier ou bureau
- **Page Infographie** (`/dashboard/infographic`) : generateur d'infographies animees avec themes visuels, templates, cartes personnalisables, export single ou batch x10
- **Formats supportes** : 9:16 (reel/portrait) et 16:9 (tv/paysage)
- **Composition video** : moteur de rendu client-side via Canvas + MediaRecorder, sequences (intro, cards, video, CTA)
- **Mode FAST** : rendu accelere (~10x) pour les videos sans audio

### Studio Son

- **Page Studio Son** (`/dashboard/audio-studio`) : ajout de musique et voix sur les videos
- **Apercu video** : preview en temps reel avec timeline synchronisee (requestAnimationFrame ~60fps)
- **Mode batch** : support de plusieurs videos simultanement avec bande de miniatures
- **Export batch avec audio** : recomposition de chaque video avec musique/voix embarquee dans le MP4
- **Formats d'apercu** : adaptatif 9:16 (portrait) et 16:9 (paysage) via inline styles
- **Controles audio** : sliders de volume + mute pour pistes musique et voix separement

### Calendrier

- **Planification** : calendrier mensuel avec drag & drop, selection de dates en masse
- **Apercu complet** : lecture video avec audio integre dans une modale de previsualisation
- **Publication automatique** : cron job avec support timezone Europe/Paris
- **Agent IA** : generation automatique de contenu sur 7, 14 ou 30 jours
- **Plateformes** : publication vers Instagram, TikTok, YouTube, Facebook

### Reseaux sociaux

- **Page Reseaux** (`/dashboard/social`) : gestion centralisee des comptes sociaux
- **Plateformes supportees** : Instagram (Reels, Stories, Posts), TikTok (videos courtes), Facebook (Videos, Reels, Stories), YouTube (Shorts, videos longues)
- **Connexion OAuth** : authentification securisee par plateforme
- **Parametres de publication** : publication automatique, meilleur horaire, hashtags par defaut, description par defaut

### Bibliotheque

- **Consultation** : grille de videos avec miniatures
- **Recherche et filtrage** : par format (reel/tv), statut (draft/completed), texte
- **Telechargement** : export direct des videos rendues

### Systeme de facturation

- **Plans** : gestion des abonnements via Stripe
- **Credits** : systeme de credits pour les generations IA
- **Historique** : suivi des transactions

---

## Historique des changements recents

### Studio Son — Corrections et ameliorations

- **Fix crash page noire** : correction du ReferenceError (`Cannot access 'eq' before initialization`) cause par une variable utilisee avant sa declaration (temporal dead zone)
- **Fix autoplay video** : ajout de l'attribut `muted` requis par Chrome pour l'autoplay
- **Fix timeline saccadee** : remplacement de `timeupdate` (~4fps) par `requestAnimationFrame` (~60fps) avec clamping pour eviter le bouclage
- **Fix format portrait** : remplacement des classes Tailwind arbitraires (`aspect-[9/16]`) par des inline styles pour eviter le purge en production
- **Fix conteneur invisible** : ajout de bordure et fond visible sur le conteneur video
- **Fix clignotement batch** : ajout d'un etat de chargement video avec spinner, reset a chaque changement de post, pause du RAF pendant le chargement
- **Fix audio batch** : recomposition complete de chaque video avec audio embarque (avant : seules les URLs etaient sauvegardees dans les metadonnees, le MP4 n'avait pas de piste audio)
- **Fix calendrier batch** : mise a jour de `media_url`, `media_type` et `status=completed` pour chaque post batch

### Infographie

- **Export batch x10** : creation de 10 posts en mode batch avec IDs collectes et redirection vers Studio Son
- **Mode FAST** : rendu accelere pour les videos sans audio (~10x plus rapide)
- **Format dynamique** : support 9:16 (reel) et 16:9 (tv) avec dimensions adaptatives

### Calendrier

- **Apercu complet** : modale de preview avec lecture video depuis `renderedVideoUrl`
- **Volume toggle** : bouton de controle du volume dans l'apercu
- **Selection en masse** : bouton "Tout selectionner" + picker de temps dans la modale de dates
- **Publication cron** : job automatique avec timezone Europe/Paris

### Reseaux sociaux

- **Connexion OAuth** : integration TikTok avec callback route et redirect URI
- **Publication multi-plateforme** : publication vers les comptes connectes depuis le calendrier
- **Parametres** : auto-publish, best time, hashtags par defaut

### Systeme

- **Upload signe** : upload via signed URLs pour contourner la limite 4.5MB de Vercel
- **Timezone** : support timezone par utilisateur dans le cron de publication
- **Politique de confidentialite** : page dediee avec details TikTok, Instagram, Facebook, YouTube
- **Suppression de donnees** : endpoint API pour les demandes de suppression Facebook

---

## Variables d'environnement requises

```
NEXTAUTH_URL=
NEXTAUTH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
FACEBOOK_CLIENT_ID=
FACEBOOK_CLIENT_SECRET=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
```

## Developpement

```bash
npm install
npm run dev
```

## Deploiement

Auto-deploy via Vercel depuis la branche `main` du repo GitHub.
