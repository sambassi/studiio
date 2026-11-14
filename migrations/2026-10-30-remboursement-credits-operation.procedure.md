# Remboursement atomique — procédure d'application, de contrôle et de retour arrière

> **Cette migration n'est PAS appliquée en production.** Ce document la prépare :
> il dit ce qu'elle change, pourquoi elle est sûre, comment la vérifier, et
> comment revenir en arrière. L'application elle-même demande une autorisation
> explicite.

## 1. Ce qu'elle change, et ce qu'elle ne change pas

| | |
|---|---|
| Crée | **une fonction**, `public.rembourser_credits_operation(uuid, integer, text, text)` |
| Ne crée pas | aucune table, aucune colonne, aucun index, aucune contrainte |
| N'écrit pas | aucune ligne de `users` ni de `credit_transactions` |
| Réutilise | l'index unique `credit_transactions_reference_unique`, déjà en production depuis le 27/08 |

C'est la raison pour laquelle le risque est faible : **il n'y a pas de données
à migrer.** La migration ajoute une capacité, elle ne transforme rien
d'existant.

Elle est **rejouable** (`create or replace function`) : l'appliquer deux fois
donne le même résultat.

## 2. Préconditions — vérifiées par la migration elle-même

Elle refuse de s'installer, avec un message explicite, si l'un des deux socles
manque :

1. l'index `credit_transactions_reference_unique`
   (`2026-08-27-credits-atomiques.sql`) ;
2. la fonction `debiter_credits_operation`
   (`2026-08-30-debit-operation.sql`).

Les deux sont en production. Aucune vérification manuelle préalable n'est donc
nécessaire : une précondition absente arrête la migration avant toute écriture.

## 3. Droits — pourquoi aucun `grant` n'est à écrire

`2026-09-29-postgrest-moindre-privilege.sql` a posé des **privilèges par
défaut** : toute fonction créée ensuite dans `public` par le rôle qui joue les
migrations est automatiquement ouverte à `service_role` et fermée à `PUBLIC`.

> ⚠️ **Cela ne vaut que si la migration est jouée par CE rôle** (`studiio` en
> production). Appliquée en tant que superutilisateur, la fonction
> n'hériterait pas de ces privilèges par défaut et `service_role` ne pourrait
> pas l'exécuter — le symptôme serait un remboursement qui échoue, pas une
> erreur à l'application. Le contrôle n° 3 ci-dessous le détecte.

## 4. Sauvegarde

La base est sauvegardée **quotidiennement à 03h00** par Coolify. Comme la
migration ne touche aucune donnée, cette sauvegarde suffit. Pour une ceinture
supplémentaire, juste avant d'appliquer :

```bash
docker exec studiio-db pg_dump -U studiio -d studiio -Fc \
  -f /tmp/avant-remboursement-$(date +%F).dump
docker cp studiio-db:/tmp/avant-remboursement-$(date +%F).dump ./
```

## 5. Application

```bash
# 1. Jouer la migration AVEC LE RÔLE DES MIGRATIONS (pas en superutilisateur)
docker exec -i studiio-db psql -U studiio -d studiio -v ON_ERROR_STOP=1 \
  < migrations/2026-10-30-remboursement-credits-operation.sql

# 2. Recharger le cache de schéma de PostgREST — il ne le relit qu'au
#    démarrage. Sans cette étape, la fonction « n'existe pas » pour l'API.
docker kill -s SIGUSR1 studiio-postgrest
```

## 6. Contrôles — lecture seule, à passer dans l'ordre

```sql
-- 1. La fonction existe, en SECURITY DEFINER, avec un search_path figé.
select proname, prosecdef, proconfig
  from pg_proc where proname = 'rembourser_credits_operation';
-- attendu : prosecdef = t, proconfig contient search_path=pg_catalog, public

-- 2. PUBLIC ne peut pas l'exécuter.
select has_function_privilege(
  'public',
  'public.rembourser_credits_operation(uuid,integer,text,text)', 'EXECUTE');
-- attendu : false

-- 3. ⚠️ LE CONTRÔLE QUI COMPTE : le rôle serveur, lui, le peut.
select has_function_privilege(
  'service_role',
  'public.rembourser_credits_operation(uuid,integer,text,text)', 'EXECUTE');
-- attendu : true. false = migration jouée par le mauvais rôle (cf. § 3) ;
-- corriger par :  grant execute on function
--   public.rembourser_credits_operation(uuid,integer,text,text) to service_role;
-- puis  docker kill -s SIGUSR1 studiio-postgrest

-- 4. Rien d'autre n'a bougé.
select count(*) from credit_transactions;   -- inchangé
select count(*) from pg_indexes where schemaname = 'public';  -- inchangé
```

## 7. Retour arrière

```bash
docker exec -i studiio-db psql -U studiio -d studiio -v ON_ERROR_STOP=1 \
  < migrations/rollback/2026-10-30-remboursement-credits-operation.rollback.sql
docker kill -s SIGUSR1 studiio-postgrest
```

Le retour arrière **supprime la fonction et rien d'autre**. Les
remboursements déjà écrits restent en place : ce sont des lignes
`credit_transactions` de type `refund`, un type accepté bien avant cette
migration. Aucun solde n'est repris, aucune ligne n'est effacée.

Fenêtre de risque pendant le retour arrière : les appels en vol échouent
proprement (fonction absente détectée par `lib/credits/atomique.ts`, qui rend
un échec explicite plutôt qu'un remboursement silencieusement perdu).

## 8. Ce que l'application fait avant, pendant et après

**Rien ne change tant que les appelants n'ont pas été basculés.** Les quatre
chemins de remboursement (échec de génération d'avatar, jumeau, statut,
ajustement administrateur) passent encore par `addCredits`, qui est atomique
sur le solde mais **ni idempotent ni protégé contre deux remboursements
concurrents**.

Les basculer **avant** l'application de la migration ferait échouer tout
remboursement en production : la fonction n'existerait pas. L'ordre est donc :

1. appliquer la migration et passer les contrôles (ce document) ;
2. **puis seulement** basculer les quatre appelants, dans un lot séparé.

## 9. Ce qui est déjà prouvé, et où

`tests-pg/remboursement-credits-operation.pg.test.ts` exécute la migration sur
un **PostgreSQL 16 réel** (job `credits-postgres` de la CI, image
`postgres:16-alpine`) et couvre :

- le remboursement nominal, et l'écriture d'une transaction `refund` unique ;
- l'absence de contrôle de solde minimum ;
- **le rejeu** : deuxième appel, puis dix appels — `deja_rembourse`, solde
  inchangé ;
- la nécessité d'une référence **différente** de celle du débit ;
- deux utilisateurs portant la même référence : indépendants ;
- les garde-fous (référence vide, montant nul ou négatif, plafond,
  utilisateur inconnu) ;
- **la concurrence** : huit remboursements simultanés sur la même référence,
  un seul crédite ;
- l'installation (SECURITY DEFINER, `search_path` figé, exécution retirée à
  `public`) et le refus de s'installer sans ses deux socles.

> Ces tests n'ont **pas** pu être rejoués en local pour ce lot : la machine n'a
> que le client `libpq`, pas de serveur PostgreSQL ni de Docker. Ils tournent
> en CI, où le service `postgres:16-alpine` est démarré pour eux.
