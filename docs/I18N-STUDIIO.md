# Traduction de Studiio — neuf langues

## Langues et statut

| Code | Langue | Sigle | Statut | Signification |
|---|---|---|---|---|
| `fr` | Français | FR | source | Langue d'origine. |
| `en`, `de` | English, Deutsch | EN, DE | complète | Interface traduite. |
| `sw`, `ht` | Kiswahili, Kreyòl ayisyen | SW, CR | **bêta** | Interface entièrement traduite, **jamais relue par un locuteur natif**. Le menu l'indique (« bêta »). |
| `ln`, `wo`, `bm`, `bas` | Lingála, Wolof, Bamanankan, Bàsàa | LN, WO, BM, BA | **partielle** | Un seul mot traduit (« Fermer », sauf bàsàa : aucun). **Tout le reste s'affiche en français.** Aucune phrase n'a été inventée : sans lexique validé ni relecteur natif, une traduction serait trompeuse. Le menu l'indique (« partiel »). |

Les codes sont techniques et stables (cookie `locale`, fichiers `messages/<code>.json`). Le sigle visible diffère du code pour le bàsàa (BA/`bas`) et le créole (CR/`ht`).

## Comment ça marche

- `src/i18n/config.ts` : langues, noms complets, sigles, statuts, locales Intl.
- `src/i18n/messages.ts` : **le français est la base**, le catalogue d'une langue est une surcouche ; tout manque retombe en français (jamais une clé brute).
- `src/i18n/provider.tsx` : charge français + surcouche ; cookie `locale` ; `<html lang>` ; enregistre aussi la langue dans `user_settings.creator_preferences.locale` (sans migration) pour les e-mails.
- `src/i18n/client.ts` : `useTranslations(ns)` → `t('clé', {variables})` ; `t.fr('Texte français')` traduit un libellé de constante par texte exact et **renvoie l'original sans entrée** (un contenu utilisateur n'est jamais altéré).
- `src/components/LanguageSelector.tsx` : sélecteur unique (globe SVG, noms complets, langue active, menu en portail).
- `src/lib/i18n/serveur.ts` : traduction serveur synchrone (e-mails) ; langue lue dans les préférences enregistrées.
- Notifications (cloche) : texte stocké en français par le cron, **localisé à l'affichage** d'après le `kind` (`src/lib/notifications/affichage.ts`).
- Assistant IA : l'interface est traduite ; la langue de réponse suit la langue choisie (`src/lib/chat/system-prompts.ts`). Pour ln/wo/bm/bas, l'assistant répond en français simple.

## Ce qui n'est PAS traduit (par choix ou limite)

- **Contenus de l'utilisateur** (projets, scripts, légendes, noms, notes) : jamais traduits ni modifiés.
- **Contenus générés / modèles** : thèmes d'infographie, textes d'exemple de l'agent, scripts produits par l'IA (leur langue est une décision produit distincte).
- **Espace administrateur** : reste en français (équipe interne).
- **Messages d'erreur renvoyés par l'API** (~255 chaînes) : restent en français ; l'interface les affiche tels quels.
- **Métadonnées SEO** (titre, description du site), **page d'erreur serveur « lien incomplet »** de `/dashboard/creer`.
- **Fragments de phrase** : une phrase coupée par une variable ou une balise est traduite par morceaux ; l'ordre des mots peut être imparfait en allemand, kiswahili ou créole.
- Le nom « HeyGen » apparaît dans deux textes français préexistants (jamais ajouté par la traduction).

## Outils (scripts/i18n)

- `inventaire.cjs` : mesure le français encore en dur.
- `convertir.cjs`, `libelles.cjs` : conversions automatiques (déjà appliquées ; rejouables sans collision de clés).
- `lots.cjs`, `valider-traduction.cjs`, `fusionner-lots.cjs` : extraire, contrôler (variables `{x}`, emoji, fournisseurs) et fusionner des lots de traduction.
- `exporter-relecture.cjs <langue>` : CSV pour un relecteur natif.

## Relecture à faire

1. `node scripts/i18n/exporter-relecture.cjs sw > sw.csv` (idem `ht`) → relecture par un locuteur natif → corriger `messages/sw.json` / `ht.json`.
2. Quand une langue est relue en entier, passer son statut de `draft` à `complete` dans `src/i18n/config.ts` : la mention « bêta » disparaît du menu.
3. Pour ln/wo/bm/bas : fournir un lexique validé (ou un relecteur) avant toute traduction.
