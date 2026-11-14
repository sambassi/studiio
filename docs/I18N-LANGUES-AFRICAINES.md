# Lingala, wolof, bambara, bàsàa — état réel de la traduction

> **Aucune de ces quatre langues n'est complète, et aucune ne doit être présentée comme telle.**
> Ce document dit ce qui existe, d'où ça vient, et ce qu'un locuteur natif doit valider.

## Méthode (et ses limites)

1. **Ressources fiables utilisées** : (a) le lexique de salutations déjà vérifié du dépôt Afroboost (lecture seule) ; (b) des **traductions humaines publiques** de l'interface de MediaWiki (communautés Wikimedia) : lingala 480 paires exploitables, wolof 766, bambara 74, bàsàa 3 ; (c) des vérifications de mots sur le web (dictionnaire bambara *ankataa* notamment).
2. **Qui a écrit les traductions** : des modèles Claude lancés dans cette session (pas d'API de traduction payante), sous la règle « ne jamais fabriquer » : une entrée n'est écrite que si elle est défendable, sinon elle est **omise** et l'interface reste en français. Chaque entrée porte une **confiance** (`attestée` : chaque mot est attesté par une source ; `à vérifier en priorité` : composée à partir de mots attestés, plausible mais non validée) et une **source**.
3. **Incident de méthode** : un agent a utilisé *une* recherche Firecrawl (outil payant) malgré l'interdiction. Elle n'a servi qu'à vérifier « kalandriye » (calendrier). Interdit explicitement pour tous les lots suivants.
4. **Aucune de ces traductions n'a été relue par un locuteur natif.** « Attestée » signifie « trouvée dans une source écrite », pas « validée par un locuteur ».

## Sources consultées et conditions d'utilisation (passe « dictionnaires »)

Consultations **ciblées** pour bâtir un glossaire d'interface (≈ 130 termes par langue) ; aucune base n'est copiée dans le dépôt (seulement le glossaire : mot, traduction, source) et chaque entrée garde son origine.

| Source | Langue | Ce qui a été fait | Conditions / incidents |
|---|---|---|---|
| dic.lingala.be | lingala | 60 consultations, une entrée par mot | aucune restriction affichée ; à citer |
| **Linganed (Université de Gand)** | lingala | **non utilisée** | sa mention légale **interdit toute copie, y compris par requêtes répétées ou automatisées** |
| dictionary.wolofacademy.com | wolof | 56 requêtes ciblées | aucune restriction affichée ; **7 réponses HTTP 429 (limitation de débit) après une rafale de requêtes de l'un de mes agents** : arrêt immédiat, aucun réessai |
| dictionary.ankataa.com | bambara | 32 requêtes | aucune restriction affichée ; la recherche n'étant pas exploitable automatiquement, l'agent a lu l'**index par lettre** (22 pages) — **écart à la règle « une recherche = un terme »**, signalé ; seules ~70 entrées utiles sont conservées |
| bamadaba.coastsystems.net | bambara | page vide (site dynamique) | non exploitable |
| webonary.org/basaa, lgidf.cnrs.fr | bàsàa | **HTTP 403 : accès automatique refusé — non contourné** | l'index de recherche public n'expose pas les définitions : 2 termes attestés (prix = ndàmbà, demain = lìkɛɛ) |
| Corpus Wikimedia (MediaWiki) | ln / wo / bm | traductions humaines publiques anglais → langue | — |

Les glossaires (terme, traduction, confiance, source) sont dans `docs/langues-africaines/glossaire-<langue>.csv`.

## Couverture réelle

**Catalogue** (3 336 clés ; interface retenue ≈ 2 900) :

| Langue | Entrées | Attestées | À vérifier en priorité |
|---|---|---|---|
| Lingala | 556 | 167 | 389 |
| Wolof | 485 | 181 | 304 |
| Bamanankan | 134 | 51 | 83 |
| Bàsàa | 5 | 3 | 2 |

**Texte réellement visible dans l'application** (Chrome/Playwright, bureau, 8 pages, part des textes affichés différents du français) :

| Page | Lingala | Wolof | Bamanankan | Bàsàa |
|---|---|---|---|---|
| Tableau de bord | 32 % | 33 % | 7 % | 0 % |
| CRÉER | 16 % | 19 % | 3 % | 0 % |
| Calendrier | 33 % | 35 % | 12 % | 0 % |
| Bibliothèque | 46 % | 50 % | 20 % | 0 % |
| Avatar | 23 % | 28 % | 6 % | 0 % |
| Réglages | 22 % | 22 % | 12 % | 0 % |
| Réseaux sociaux | 29 % | 25 % | 6 % | 0 % |
| **Ensemble (8 pages)** | **26 %** | **28 %** | **8 %** | **0 %** |

Avant la passe dictionnaires : lingala 25 %, wolof 16 %, bambara 5 %, bàsàa 0 %. Cinéma IA : 0 % (page non rendue dans l'environnement de test, et aucune phrase défendable).

**Inventaire précis de ce qui reste en français à l'écran** : `docs/langues-africaines/<langue>-restant-a-l-ecran.csv` (clé, texte français, page).

## Pourquoi si peu

- **Les dictionnaires donnent des mots, pas des interfaces** : ils n'attestent presque jamais « tableau de bord », « calendrier », « abonnement », « aperçu », « montage », « séquence » ni les verbes d'une application. Sans mot attesté, une phrase d'interface ne peut pas être composée sans inventer.
- **Bàsàa** : les deux sources demandées refusent les accès automatiques et leur index public n'expose pas les définitions. Pour avancer, il faut que quelqu'un exporte le dictionnaire Webonary (SIL propose des exports de ses données selon sa licence) ou qu'un locuteur fournisse un CSV ; l'import et l'approbation sont prêts (`/admin/traductions`).
- **Bambara** : l'index d'Ankataa n'atteste ni « paramètres », « bibliothèque », « calendrier », « abonnement » ni « crédits » (« juru » signifie dette/prêt).
- **Lingala / wolof** : les libellés courts sont couverts ; les phrases longues (Autopilote, avatar, montage, voix, consentements, erreurs) restent en français.

## Ce qui reste en français (par choix)

Tout ce qui n'est pas défendable : phrases longues, textes marketing, messages d'erreur, notifications, termes techniques sans équivalent attesté (rush, séquence, aperçu de montage, jumeau…), et le parcours Cinéma IA.

## Expressions à faire valider en priorité (exemples signalés par les traducteurs)

- **Lingala** : « Kokanga » (fermer), « Kokitisa » (télécharger), « Kosomba » (acheter), « Kokoba » (continuer), « Kokangana » (connexion), « Bibliotɛkɛ » (confirmé par un seul extrait), « Mongongo » (voix), « Miziki » (musique), « Langi » (couleur), « Ebakisami », « Ebómbami », « Esalemi te », les phrases de l'assistant (`assistant.greeting`, `assistant.error`), l'ordre des nombres dans les libellés de forfaits.
- **Wolof** : « Tëj » (fermer ; le corpus l'écrit « Neenal », comme annuler), « Dellu » (retour), « Jéemaat » (réessayer), « Wéy » (continuer), « Jeex » (terminé), « kredi », « Baat » (voix), « Musik », « Koj » (titre), « Xibaar » (informations), « Tëj palanteer bi », « Sos avatar bu bees », « Sama avatar vidéo ».
- **Bambara** : « A bɔ » (supprimer — le corpus propose « A la tounou », or « tunun » signifie « perdre »), « A mara » (enregistrer), « Gundo daɲɛ » (mot de passe), « Don » (connexion), « Bɔ » (déconnexion), « Ci » (envoyer), « Banna » (terminé), « Vidéow » (pluriel construit par analogie).
- **Bàsàa** : « Ǹtoŋ » (plus : tiré du menu « More » d'un wiki). Le lexique existant donne « mɛ̀ ǹyega » à la fois pour *bonjour* et *merci*, ce qui paraît suspect : non utilisé.

La liste **complète** (clé, français, traduction, confiance, source) est dans `docs/langues-africaines/<langue>-a-valider.csv`.

## Comment les compléter

1. **Administration → Traductions** (`/admin/traductions`) : choisir la langue, filtrer « Non validées » ou « À vérifier en priorité », corriger puis valider entrée par entrée.
2. Ou **exporter** le CSV de la langue depuis cette page, le faire relire/compléter par un locuteur natif (colonne `traduction`, y compris les clés manquantes), puis le **réimporter** (case « relecteur natif » = entrées validées). Une cellule vide est ignorée.
3. Les corrections vivent dans `app_settings` (`i18n_overrides_<langue>`) : aucun redéploiement, aucune migration.
4. Quand une langue atteint une couverture suffisante **et validée**, passer son statut de `partial` à `draft` (ou `complete`) dans `src/i18n/config.ts` ; tant que ce n'est pas fait, le menu affiche « Partiel ».

Sans locuteur natif ni lexique d'interface validé, **la couverture ne peut pas progresser honnêtement** : ce n'est pas une limite du code.
