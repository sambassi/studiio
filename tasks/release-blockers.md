# Bloqueurs avant déploiement Studiio.pro

> DEPLOY_ALLOWED=NON tant qu'un point ci-dessous reste ouvert (ou n'est pas
> explicitement accepté). Un point ne disparaît de cette liste que corrigé,
> vérifié, et noté comme tel — jamais « parce qu'il était hors périmètre ».

| # | Point | État |
|---|-------|------|
| 1 | Admin Settings / Landing : faux succès (`updated_by` absent, erreurs d'upsert ignorées) | Corrigé — #548 |
| 2 | **PUBLIC_STORAGE_RELAY_RISK** : le relais public `/storage/v1/object/public/…` sert encore tout fichier à qui connaît son URL exacte (issue #547). Mission sécurité séparée obligatoire. | Ouvert |
| 3 | Autopilote : rush expiré compté comme source valide | Corrigé — #549 |
| 4 | Positions titre / carte / CTA en 9:16 | Corrigé — #550 |
| 5 | Surimpressions Créer en 16:9 et 1:1 | En cours — `fix/overlay-layout-wide-formats` |
| 6 | Ancien fondu single-rush (`t*0.3`) | Ouvert |
| 7 | Contrôle visuel « Mon avatar » (#540) | Vérifié 12/10 (banc local, API simulées, 1440×900 + 390×844 : valide, formats 9:16/16:9/1:1, rendu récent, génération en cours, entraînement, échec, nouvelle version en préparation / en échec) — aucun défaut bloquant |
| 8 | Comportement du curseur de lissage à décider | Corrigé dans `fix/avatar-smoke-smoothing` : l'aperçu en direct suit la réduction 4K → 1920 faite par ffmpeg avant le filtre (le fichier final était jusqu'à 2× plus lissé que l'aperçu) — à fusionner |
| 9 | Vérifier les variables Coolify `SUPABASE_URL` / `SUPABASE_LEGACY_STORAGE_URL` | Ouvert |
| 10 | Autres éléments d'audit classés « limites acceptées » à confirmer | Ouvert |

## Suivi UX non bloquant

Ne bloque pas la release, mais ne doit pas être oublié.

| Clé | Point |
|-----|-------|
| UX_TITLE_MANUAL_SAFE_ZONE_WARNING | Titre déplacé à la main au-delà de x 55 % en 9:16 : il peut entrer dans la colonne de boutons sociaux. Afficher un guide / avertissement plutôt que déplacer le titre. |
| UX_TITLE_WIDTH_HANDLE_CONSTRAINED | Quand la largeur du titre est contrainte en 9:16, la poignée de largeur ne réagit qu'après avoir dépassé la largeur affichée. La rendre plus intuitive. |
