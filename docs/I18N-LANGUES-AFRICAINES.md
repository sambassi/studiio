# Lingala, wolof, bambara, bàsàa — état réel de la traduction

> **Aucune de ces quatre langues n'est complète, et aucune ne doit être présentée comme telle.**
> Ce document dit ce qui existe, d'où ça vient, et ce qu'un locuteur natif doit valider.

## Méthode (et ses limites)

1. **Ressources fiables utilisées** : (a) le lexique de salutations déjà vérifié du dépôt Afroboost (lecture seule) ; (b) des **traductions humaines publiques** de l'interface de MediaWiki (communautés Wikimedia) : lingala 480 paires exploitables, wolof 766, bambara 74, bàsàa 3 ; (c) des vérifications de mots sur le web (dictionnaire bambara *ankataa* notamment).
2. **Qui a écrit les traductions** : des modèles Claude lancés dans cette session (pas d'API de traduction payante), sous la règle « ne jamais fabriquer » : une entrée n'est écrite que si elle est défendable, sinon elle est **omise** et l'interface reste en français. Chaque entrée porte une **confiance** (`attestée` : chaque mot est attesté par une source ; `à vérifier en priorité` : composée à partir de mots attestés, plausible mais non validée) et une **source**.
3. **Incident de méthode** : un agent a utilisé *une* recherche Firecrawl (outil payant) malgré l'interdiction. Elle n'a servi qu'à vérifier « kalandriye » (calendrier). Interdit explicitement pour tous les lots suivants.
4. **Aucune de ces traductions n'a été relue par un locuteur natif.** « Attestée » signifie « trouvée dans une source écrite », pas « validée par un locuteur ».

## Couverture réelle

Interface retenue : 2 906 clés (hors espace administrateur, e-mails, textes légaux, qui ne se traduisent pas sans relecteur humain).

| Langue | Entrées | Attestées | À vérifier en priorité | Part du texte visible traduit (tableau de bord, bureau) |
|---|---|---|---|---|
| Lingala | 438 | 156 | 282 | **36 %** |
| Wolof | 388 | 169 | 219 | **26 %** |
| Bamanankan | 80 | 36 | 44 | **10 %** |
| Bàsàa | 5 | 3 | 2 | **5 %** |

Part du texte visible mesurée dans un navigateur : textes du tableau de bord qui diffèrent du français. Ailleurs (bureau) : connexion 80 % / 80 % / 20 % / 20 % ; bibliothèque 51 % / 44 % / 24 % / 6 % ; CRÉER 16 % / 13 % / 6 % / 2 % ; **Cinéma IA 0 % pour les quatre** (aucune phrase de ce parcours n'a pu être défendue).

## Pourquoi si peu

- **Bàsàa** : aucune ressource d'interface n'existe en ligne accessible ; les dictionnaires en ligne ont refusé l'accès ou ne montrent pas leurs entrées. Seuls 5 textes sont traduits (langue = Hɔp, oui = Èè, non = Tô, plus = Ǹtoŋ, bienvenue = Malô malam).
- **Bambara** : 74 paires seulement ; les mots de base ont été vérifiés un à un, mais ni « paramètres », « bibliothèque », « calendrier », « abonnement » ni « crédits » n'ont pu être attestés.
- **Lingala et wolof** : le vocabulaire de wiki permet les boutons et libellés courts ; les phrases longues (Autopilote, avatar, montage, voix, consentements, erreurs) ne peuvent pas être rendues sans inventer du vocabulaire.

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
