Termine le système commercial de Studiio : rentabilité vérifiable, crédits
protégés, fournisseurs invisibles. Rien n'est activé — tous les prix de
production sont inchangés et les formules proposées restent fermées.

## Ce que ça corrige

**Trois tarifs se vendaient sous leur coût sans que rien ne le dise.** À
40 crédits (3,27 CHF encaissés), une génération d'avatar coûte 6,92 USD en
Qualité et 10,32 USD en Premium. Le catalogue allait jusqu'à *proposer*
10 / 25 / 40 crédits pour ces moteurs — trois montants figés, tous sous le
coût. Ils sont retirés, remplacés par un prix conseillé **calculé** à partir
du coût réel et d'un taux de change daté.

**Quatorze tarifs étaient marqués « coût inconnu ».** Les quatorze avaient un
prix public, lisible sans compte et sans appel payant. Relevés le 12/11, pire
palier retenu, source et date inscrites dans le code.

**Sept outils IA renvoyaient au navigateur l'URL du fournisseur**, qui
devenait le `src` de l'image dans l'éditeur. Les octets sont désormais
rapatriés dans le stockage Studiio, vérifiés par signature, **avant** le
débit : un échec ne facture rien.

**Une clé de traduction manquante affichait son chemin technique** à l'écran
(`billing.transactionHistory`). Le français sert maintenant de socle, clé par
clé — ce qui rend une langue partielle utilisable au lieu d'être cassée.

**`payment_method_types: ['card']` figeait la carte dans le code** : TWINT,
PayPal ou Apple Pay ne pouvaient pas apparaître, même activés sur le compte.

## Ce que ça ajoute

- Contrôle de rentabilité par tarif dans `/admin/tarifs` : verdict, plancher,
  prix conseillé, motif, alerte de vente à perte.
- Taux de change **daté et sourcé**, lu en un clic depuis les taux de
  référence de la BCE. Sans taux, aucune marge n'est inventée : le module
  rend le taux d'équilibre et suspend son verdict.
- Prix d'une recharge en **franc CFA**, vérifiable : parité fixe à l'euro
  (655,957) × un taux CHF→EUR daté. Sans taux, on refuse d'afficher un prix.
- Bilan mensuel crédits / recette estimée / marge, nommé comme une estimation.
- L'assistant reçoit le plan, le solde et les **tarifs réels** du compte à
  chaque message : il chiffre un projet sans inventer un prix, et ne lance
  rien.
- Garde : une opération payante sans coût vérifié est refusée avant tout
  appel et tout débit. Active par défaut, et **sans effet aujourd'hui** —
  aucun tarif actuel n'est concerné, un test le tient.

## Ce qui n'est pas activé

Les formules 12,90 / 34,90 / 69,90 CHF (200 / 550 / 1 100 crédits) sont
portées comme **propositions**, `activee: false` par construction du type. Le
Mobile Money est fermé par défaut : il attend un compte marchand indépendant,
qui est une décision commerciale et non du code. Aucun réglage Stripe n'a été
touché.

## Migration

Une seule, **non appliquée** :
`2026-10-30-remboursement-credits-operation.sql`. Elle ne crée qu'une
fonction, ne touche aucune donnée, et son retour arrière la supprime sans
rien perdre. Procédure complète, contrôles et ordre d'exécution dans
`migrations/2026-10-30-remboursement-credits-operation.procedure.md`. Les
quatre appelants de remboursement ne sont **pas** basculés : les basculer
avant l'application ferait échouer tout remboursement en production.

## Vérifications

- **16 067 tests** passent (743 fichiers).
- **26 tests E2E** Playwright, ordinateur et mobile, avec un compte **non
  administrateur** : aucune requête du navigateur ne nomme un prestataire sur
  les trois pages couvertes, et les écrans d'administration ne lui servent
  aucune donnée commerciale.
- **Aucun paiement réel, aucun appel IA payant** : un garde *aborte* toute
  requête d'encaissement pendant les tests.
- **Aucun prix de production modifié**, aucune donnée de production lue.

## Intégration

`origin/main` n'a pas bougé depuis le départ de la branche : fusion en
*fast-forward*, **aucun rebase**. Le seul conflit introduit, où que ce soit,
est `tasks/lessons.md` — garder les deux blocs. Les conflits des branches
Créer/LUT et Cinéma Wizard existent déjà contre `main` seule (la première est
490 commits en retard) et ne sont pas aggravés.

Fusion en **merge commit**, pas en squash : les 12 commits portent chacun une
décision.

Détail complet : `tasks/INTEGRATION-commerce-abonnements-credits.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
