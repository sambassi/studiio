# BRIEF CLAUDE CODE — Finalisation studiio.pro

## Contexte

studiio.pro est une plateforme SaaS Next.js 14 de creation video IA pour les reseaux sociaux.
Repo GitHub : `sambassi/studiio` (branche main, auto-deploy Vercel).

---

## OBJECTIF GLOBAL

Rendre les 3 systemes suivants **prets a l'emploi, fonctionnels de bout en bout, sans bugs** :

1. **Batch x10 depuis Infographie**
2. **Batch x10 depuis Creer (Creator)**
3. **Agent IA (7, 14, 30 jours) depuis Calendrier**

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

## TESTS PLAYWRIGHT

Ecrire des tests E2E Playwright couvrant les 3 systemes. Les tests doivent :

1. **Se connecter** a l'application (authentification)
2. **Tester le batch Infographie** : activer batch x10, exporter vers Studio Son, verifier que 10 posts arrivent, naviguer entre eux, exporter vers calendrier, verifier les 10 posts dans le calendrier
3. **Tester le batch Creator** : choisir x10, exporter vers Studio Son, verifier le flux complet
4. **Tester l'Agent IA** : ouvrir la modale, configurer 7 jours, uploader un rush, generer, verifier que 7 posts apparaissent dans le calendrier sur 7 jours differents
5. **Verifier les formats** : tester que 9:16 et 16:9 sont correctement appliques dans Studio Son

Les tests doivent etre dans `tests/` ou `e2e/` a la racine du projet.

---

## REGLES IMPORTANTES

- Le site est en francais
- TypeScript avec `ignoreBuildErrors: true` dans next.config.js
- Tailwind CSS : NE PAS utiliser de classes arbitraires comme `aspect-[9/16]` (purgees en prod), utiliser des inline styles
- Chrome autoplay : toujours `muted` sur les `<video>` avec autoPlay
- POST /api/posts retourne `{ success: true, post: data }` (champ `post`)
- GET/PATCH /api/posts/[id] retourne `{ success: true, data }` (champ `data`)
- Le format du post est `post.format` : `'reel'` (9:16) ou `'tv'` (16:9)
- Upload via signed URLs (POST /api/upload/media) pour contourner la limite 4.5MB Vercel
- Auto-deploy Vercel depuis la branche main
