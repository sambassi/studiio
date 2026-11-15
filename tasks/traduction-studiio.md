# Chantier — Traduction de Studiio (9 langues)

Branche `feat/traduction-studiio`, worktree `/Users/afroboost/studiio-i18n` (depuis origin/main 8c9854b).
Indépendant d'Afroboost (PR #39) et des worktrees Créer / Cinéma IA / Commerce.

## Décisions
- Réutiliser `src/i18n/*` + `messages/*.json` (1 166 clés fr/en/de). Pas de second moteur.
- Codes : fr, en, de, ln, wo, sw, bm, bas (« BA »), ht (« CR »).
- Le français est la BASE : le catalogue d'une langue est une surcouche, tout manque retombe en français (jamais une clé brute).
- Statut honnête par langue : complete (fr,en,de) · draft (sw,ht : traduits, jamais relus par un natif) · partial (ln,wo,bm,bas : vocabulaire minimal, le reste en français). Aucune traduction inventée présentée comme vérifiée.
- Contenus de l'utilisateur (projets, scripts, légendes, noms) jamais traduits ni modifiés.
- Admin (staff) hors périmètre : reste en français.
- Aucun appel IA payant, aucune migration, aucune écriture de base.

## Étapes
1. Fondation : config 9 langues, provider (base fr + surcouche), client (repli, dates/nombres), sélecteur SVG.
2. Inventaire + conversion par zone : public, espaces, CRÉER, Cinéma IA, Autopilote, abonnements/crédits/paiements, assistant.
3. Notifications / e-mails / messages API selon la langue du cookie `locale` (repli fr).
4. Tests ciblés + navigateur (9 langues × bureau/mobile), PR distincte.
