# Studiio — ressources linguistiques librement utilisables (ln, wo, bm, bas)

Bilan du 14/11/2026. Principe : **aucune** traduction inventée, **aucune** restriction contournée, les propositions sont
classées **à part** des traductions validées. Une langue n'est jamais « complète » parce que des clés sont renseignées :
seule la relecture par un locuteur (statut « Validée » dans `/admin/traductions`) compte.

## 1. Utilisé (licence ouverte, téléchargement prévu par l'éditeur)

| Ressource | Licence | Contenu récupéré | Résultat |
|---|---|---|---|
| Wiktionnaire fr + Wiktionary en, extraits par kaikki.org (téléchargements publics, 6 fichiers, ~9 Mo) | CC BY-SA 4.0 (texte du Wiktionnaire/Wiktionary) | ln 4 608 + 1 608 entrées, wo 1 190 + 748, bm 3 460 + 791. Pas de fichier bàsàa (404). | `scripts/i18n/proposer-wiktionnaire.cjs` : correspondance **exacte** libellé ↔ définition, un seul mot candidat, jamais d'écrasement → **ln 43, wo 16, bm 39 propositions**, dans `docs/langues-africaines/<l>-propositions-wiktionnaire.csv`. **Non injectées dans les catalogues.** |
| Wikidata (lexèmes), 1 requête SPARQL | CC0 | ln 4, wo 168, bm 7, bàsàa 0 lexèmes | Trop peu et sans contexte d'interface : non retenu. |

Pourquoi les propositions restent hors des catalogues : l'essai à blanc a produit des faux rapprochements typiques
(« Mer » = mercredi pris pour *mer*, « Dim », « Bureau » = poste de travail, mots-outils). Les jours et mois sont exclus ;
le reste reste ambigu hors contexte. À relire, puis à importer via `/admin/traductions` (import CSV) : elles y apparaîtront
« Non validée ».

Obligation de la licence : mention de la source (colonne `source` de chaque CSV). Les CSV de propositions héritent de la
licence CC BY-SA 4.0 (partage dans les mêmes conditions) ; le code de Studiio n'est pas concerné, et rien n'est inséré dans
l'application avant relecture.

## 2. Existant, déjà intégré (voir `I18N-LANGUES-AFRICAINES.md`)
Wikimedia/MediaWiki i18n (ln 480, wo 766, bm 74, bas 3 paires), dic.lingala.be, Wolof Academy, Ankataa (consultations ciblées,
quelques dizaines d'entrées, aucune base copiée).

## 3. Jeux ouverts identifiés mais peu utiles pour une interface
| Ressource | Licence | Pourquoi non exploité |
|---|---|---|
| FLORES-200, NLLB-Seed (ln, wo, bm ; pas de bàsàa) | CC BY-SA 4.0 | Phrases de presse/voyage alignées, pas des libellés d'interface ; extraire des mots exigerait un alignement automatique peu fiable. Utile plus tard comme **jeu de contrôle** de relecteurs. |
| NLLB-MD | CC BY-NC 4.0 | Usage non commercial : **incompatible** avec un SaaS commercial. |
| Tatoeba | CC BY 2.0 FR | Phrases générales, volumes faibles pour ces langues, non vérifiés ici. |
| Mozilla Data Collective, jeu bàsàa « ALCAM » | NOODL-1.0 | Licence spécifique et jeu multimodal (voix) ; conditions à lire par le propriétaire avant tout usage. |

## 4. Impossible sans autorisation ou relecture humaine
| Élément | Raison |
|---|---|
| **Linganed** (Université de Gand, lingala) | Mentions légales : copie interdite, y compris requêtes répétées/automatisées. Écrire à l'université pour une autorisation. |
| **Webonary bàsàa** (SIL, dictionnaire Njock) et **lgidf.cnrs.fr** | Réponse 403 aux accès automatiques ; l'hébergement SIL n'est pas une licence de réutilisation. Demander l'export FLEx/licence à SIL Cameroun (silcam.org) ou au CNRS. |
| **Bamadaba** | Page vide à l'accès automatique. |
| Toute traduction **de phrases** (messages d'erreur, paiements, abonnements, assistant) | Aucun corpus ouvert ne couvre ce vocabulaire ; seule la relecture par un locuteur natif est fiable. |
| **Bàsàa, 5 entrées** | Aucune source ouverte exploitable trouvée ; priorité n°1 pour une demande d'export ou un locuteur. |

## 5. Conséquence sur l'affichage
Les quatre langues restent **« Partiel »**. Part du texte visible réellement traduit mesurée précédemment : ln 26 %, wo 28 %,
bm 8 %, bas 0 %. Cette étape n'ajoute **aucune** traduction aux catalogues : elle ajoute 98 propositions à relire.

## 6. Pour la suite (une décision à prendre)
Demander l'autorisation à SIL Cameroun (bàsàa) et à Linganed, ou recruter un relecteur par langue. La chaîne
CSV → `/admin/traductions` → « Validée » est prête.
