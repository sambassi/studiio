# BRIEF CLAUDE CODE — Finalisation studiio.pro

## Contexte

studiio.pro est une plateforme SaaS Next.js 14 de creation video IA pour les reseaux sociaux.
Repo GitHub : `sambassi/studiio` (branche main, auto-deploy Vercel).

---

## OBJECTIF GLOBAL

Rendre les 4 systemes suivants **prets a l'emploi, fonctionnels de bout en bout, sans bugs** :

1. **Batch x10 depuis Infographie**
2. **Batch x10 depuis Creer (Creator)**
3. **Agent IA (7, 14, 30 jours) depuis Calendrier**
4. **Internationalisation (i18n) : Francais, Anglais, Allemand**

Chaque systeme doit etre teste de bout en bout avec **Playwright** (tests E2E).

---

## SYSTEME 1 : Batch x10 — Page Infographie → Studio Son → Calendrier

**Fichiers concernes :**
- `src/app/dashboard/infographic/page.tsx`
- `src/app/dashboard/audio-studio/page.tsx`
- `src/app/dashboard/calendar/page.tsx`
- `src/lib/video-composer.ts`
- `src/app/api/posts/route.ts`
- `src/app/api/posts/[id]/route.ts`
- `src/app/api/upload/media/route.ts`

**Flux attendu (pret a l'emploi) :**

1. L'utilisateur active le mode "Batch x10" dans Infographie
2. 10 variations sont generees automatiquement (titres, sous-titres, photos Pexels differentes)
3. L'utilisateur clique "Exporter" avec destination "Studio Son"
4. Les 10 videos sont composees (canvas + MediaRecorder) au format choisi (9:16 ou 16:9)
5. Les 10 posts sont crees dans la base (POST /api/posts) avec `format: 'reel'` ou `'tv'`, `status: 'draft'`
6. L'utilisateur est redirige vers `/dashboard/audio-studio?postIds=id1,id2,...,id10`
7. Studio Son charge les 10 posts et affiche le premier avec la bande de miniatures en bas
8. L'apercu video s'affiche correctement au bon format (portrait 9:16 ou paysage 16:9) sans clignotement
9. La timeline se synchronise sans boucler a l'infini
10. L'utilisateur peut naviguer entre les 10 videos via les miniatures
11. L'utilisateur ajoute une musique et/ou une voix (optionnel)
12. L'utilisateur clique "Exporter vers Calendrier"
13. Chaque video est recomposee avec l'audio embarque dans le MP4
14. Chaque post est mis a jour (PATCH) avec : `media_url` = nouvelle URL video, `status: 'completed'`
15. L'utilisateur est redirige vers le Calendrier
16. Les 10 posts apparaissent tous dans le calendrier a la bonne date

**Criteres de succes :**
- Les 10 videos sont creees sans erreur
- Les 10 posts existent en base avec des URLs video valides
- Le format (9:16 ou 16:9) est respecte du debut a la fin
- L'audio est embarque dans le MP4 final (pas juste un URL en metadata)
- Le calendrier affiche les 10 posts

---

## SYSTEME 2 : Batch x10 — Page Creer (Creator) → Studio Son → Calendrier

**Fichiers concernes :**
- `src/app/dashboard/creator/page.tsx`
- `src/app/dashboard/audio-studio/page.tsx`
- `src/app/dashboard/calendar/page.tsx`
- `src/lib/video-composer.ts`

**Flux attendu (pret a l'emploi) :**

1. L'utilisateur choisit le nombre de videos (x1, x2, x3, x5, x10) dans la page Creator
2. Les variations de titres/sous-titres sont generees automatiquement selon l'objectif choisi
3. L'utilisateur clique "Exporter" avec destination "Studio Son"
4. Les N videos sont composees au format choisi
5. Les N posts sont crees en base
6. Redirection vers Studio Son avec tous les postIds
7. Studio Son charge et affiche correctement les N posts
8. Export vers calendrier recompose chaque video avec audio
9. Les N posts apparaissent dans le calendrier

**Criteres de succes :**
- Identiques au systeme 1, mais avec le nombre variable (1 a 10)
- Le Creator doit supporter les memes formats que l'Infographie (9:16 et 16:9)

---

## SYSTEME 3 : Agent IA (7, 14, 30 jours) — Page Calendrier

**Fichiers concernes :**
- `src/app/dashboard/calendar/page.tsx` (fonction `handleAIGenerate`, modal Agent IA)
- `src/app/api/agent/generate/route.ts`
- `src/app/api/upload/media/route.ts`
- `src/app/api/pexels/route.ts`
- `src/lib/video-composer.ts`
- `src/lib/smart-content.ts`

**Flux attendu (pret a l'emploi) :**

1. L'utilisateur ouvre la modale "Agent IA" dans le calendrier
2. Il choisit la duree : 7 jours, 14 jours, ou 30 jours
3. Il uploade ses fichiers rush (videos/images)
4. Il selectionne les reseaux sociaux cibles (Instagram, Facebook, YouTube Shorts, TikTok)
5. Il selectionne ses objectifs (Promo, Motiv, Bienfaits, Abo, Nutri)
6. Il active ou non "Photo Affiche" (Pexels)
7. Il ajoute optionnellement une musique
8. Il configure le branding (couleur, CTA, watermark)
9. Il clique "Generer"
10. Le systeme :
    - Uploade les rush files vers Supabase Storage
    - Uploade la musique si fournie
    - Recherche les photos Pexels si "Photo Affiche" active
    - Pour chaque jour du plan (7, 14, ou 30) :
      - Genere un titre/sous-titre/phrase uniques en rotation sur les objectifs
      - Compose la video (intro + video + CTA) via `composeAndUpload`
      - Cree le post en base avec `scheduled_date` correcte (un post par jour)
      - Cree l'entree dans la table videos
    - Affiche la progression en temps reel
11. A la fin, les posts apparaissent dans le calendrier, repartis sur les jours suivants
12. Chaque post a une video composee avec une URL valide

**Criteres de succes :**
- 7 posts crees pour 7j, 14 pour 14j, 30 pour 30j
- Chaque post a une `scheduled_date` differente (un par jour a partir de demain)
- Les objectifs sont en rotation (pas tous les memes)
- Les plateformes sont en rotation
- Les titres sont uniques (pas de doublons)
- La progression s'affiche correctement (pas bloquee, pas en boucle)
- Les videos ont des URLs valides et jouables
- Le calendrier affiche tous les posts aux bonnes dates

---

## SYSTEME 4 : Internationalisation (i18n) — Francais, Anglais, Allemand

**Objectif :**

Le site entier doit etre disponible en 3 langues : Francais (FR), Anglais (EN), Allemand (DE).
La langue par defaut est le Francais. Un selecteur de langue doit etre visible et accessible sur toutes les pages.

**Approche technique recommandee :**

Utiliser `next-intl` (ou `next-i18next`) avec le App Router de Next.js 14 :
- Fichiers de traduction dans `messages/fr.json`, `messages/en.json`, `messages/de.json`
- Middleware Next.js pour la detection de langue (cookie ou header Accept-Language)
- Routes prefixees : `/fr/dashboard/calendar`, `/en/dashboard/calendar`, `/de/dashboard/calendar`
- Ou route sans prefixe pour la langue par defaut (FR)

**Pages a traduire (TOUTES) :**

1. **Landing page** (`/`) : hero, features, temoignages, pricing, FAQ, footer
2. **Auth** : login, signup (labels, boutons, messages d'erreur)
3. **Dashboard** : accueil, stats, navigation sidebar
4. **Creator** (`/dashboard/creator`) : tous les labels, boutons, etapes, messages d'export
5. **Infographie** (`/dashboard/infographic`) : themes, labels, boutons, batch mode, export
6. **Studio Son** (`/dashboard/audio-studio`) : controles audio, timeline, export, batch
7. **Calendrier** (`/dashboard/calendar`) : jours, mois, modales, Agent IA, preview, export
8. **Bibliotheque** (`/dashboard/library`) : filtres, recherche, statuts
9. **Reseaux sociaux** (`/dashboard/social`) : plateformes, parametres de publication
10. **Objectifs** (`/dashboard/objectives`) : formulaire, labels
11. **Facturation** (`/dashboard/billing`) : plans, credits, historique
12. **Admin** (toutes les pages admin) : stats, gestion, parametres
13. **Pages legales** : privacy, terms
14. **Messages d'erreur et toasts** : tous les messages systeme

**Elements a traduire dans chaque page :**

- Titres et sous-titres
- Labels de boutons
- Textes de placeholder dans les inputs
- Messages de confirmation / erreur / succes (toasts)
- Labels de navigation (sidebar, breadcrumbs)
- Contenu des modales
- Textes des tooltips
- Formats de date (FR: 2 avril 2026, EN: April 2, 2026, DE: 2. April 2026)
- Formats de nombres (FR: 1 234,56, EN: 1,234.56, DE: 1.234,56)

**Selecteur de langue :**

- Position : dans la sidebar du dashboard ET dans le header/footer de la landing page
- Affichage : drapeaux + code langue (🇫🇷 FR / 🇬🇧 EN / 🇩🇪 DE)
- Comportement : change la langue immediatement, sauvegarde le choix dans un cookie
- Le changement de langue ne doit PAS recharger la page completement (navigation client-side)

**Contenu genere dynamiquement :**

- Les titres de videos generes par l'Agent IA doivent avoir des pools de titres dans les 3 langues
- Les legendes IA (`IA Légende`) doivent generer dans la langue active
- Les phrases de vente, sous-titres, CTA dans les videos composees doivent respecter la langue
- Le contenu du CMS admin (landing page) reste en francais sauf si l'admin le traduit

**Criteres de succes :**
- Un selecteur de langue est visible sur toutes les pages
- Toute l'interface est traduite dans les 3 langues (aucun texte en dur non traduit)
- Les dates et nombres sont formates selon la locale
- Le choix de langue persiste entre les sessions (cookie)
- Les contenus generes par l'IA (titres, legendes, CTA) sont dans la langue active
- Aucune regression fonctionnelle (batch, export, Agent IA marchent dans les 3 langues)

---

## TESTS PLAYWRIGHT

Ecrire des tests E2E Playwright couvrant les 3 systemes. Les tests doivent :

1. **Se connecter** a l'application (authentification)
2. **Tester le batch Infographie** : activer batch x10, exporter vers Studio Son, verifier que 10 posts arrivent, naviguer entre eux, exporter vers calendrier, verifier les 10 posts dans le calendrier
3. **Tester le batch Creator** : choisir x10, exporter vers Studio Son, verifier le flux complet
4. **Tester l'Agent IA** : ouvrir la modale, configurer 7 jours, uploader un rush, generer, verifier que 7 posts apparaissent dans le calendrier sur 7 jours differents
5. **Verifier les formats** : tester que 9:16 et 16:9 sont correctement appliques dans Studio Son
6. **Tester l'i18n** : changer la langue en EN, verifier que les labels sont traduits, changer en DE, verifier egalement, revenir en FR, confirmer la persistance du choix

Les tests doivent etre dans `tests/` ou `e2e/` a la racine du projet.

---

## REGLES IMPORTANTES

- Le site doit supporter 3 langues : Francais (defaut), Anglais, Allemand
- Aucun texte en dur dans les composants — tout doit passer par les fichiers de traduction
- TypeScript avec `ignoreBuildErrors: true` dans next.config.js
- Tailwind CSS : NE PAS utiliser de classes arbitraires comme `aspect-[9/16]` (purgees en prod), utiliser des inline styles
- Chrome autoplay : toujours `muted` sur les `<video>` avec autoPlay
- POST /api/posts retourne `{ success: true, post: data }` (champ `post`)
- GET/PATCH /api/posts/[id] retourne `{ success: true, data }` (champ `data`)
- Le format du post est `post.format` : `'reel'` (9:16) ou `'tv'` (16:9)
- Upload via signed URLs (POST /api/upload/media) pour contourner la limite 4.5MB Vercel
- Auto-deploy Vercel depuis la branche main
