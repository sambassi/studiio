# Mobile Money — procédure d'application, de contrôle et de retour arrière

> **Cette migration n'est PAS appliquée en production.** Tant qu'elle ne l'est
> pas, aucun paiement mobile ne peut être ouvert ni crédité : le code le
> détecte (`socle_absent`) et le dit, au lieu de créditer sans la garantie
> d'unicité que porte son index.

## 1. Ce qu'elle change

| | |
|---|---|
| Crée | la table `pawapay_depots` (dont `derniere_verification_le`), deux index de travail, **un index unique partiel** sur `credit_transactions(reference_id) WHERE reference_id LIKE 'mm:%'`, et la fonction `crediter_credits_mobile_money` |
| Ne touche pas | `users`, les transactions existantes, les fonctions Stripe, aucune ligne de données |
| Rejouable | oui — `create table if not exists`, `create index if not exists`, `create or replace function` |

**L'index unique partiel est le cœur de la migration.** Sans lui, la fonction
ne garantit rien : c'est lui qui transforme deux confirmations concurrentes en
`unique_violation` — donc en un seul crédit — au lieu d'un double crédit.

## 2. Pourquoi une fonction séparée de celle de Stripe

`crediter_credits_stripe` refuse toute référence qui ne commence pas par
`stripe:` (`p_reference not like 'stripe:_%'`). Ce n'est pas un oubli : son
index unique ne couvre que `stripe:%`, et lui faire accepter un autre préfixe
lui ferait **promettre une unicité que l'index ne tient pas**. Le Mobile Money
a donc sa référence (`mm:<depositId>`), son index, et une fonction qui est la
copie conforme de l'autre — mêmes contrôles, même verrou de ligne, même
traitement du rejeu séquentiel et concurrent.

## 3. Préconditions

Vérifiée par la migration elle-même : `credit_transactions.reference_id` doit
exister (`2026-08-27-credits-atomiques.sql`, en production). Une précondition
absente arrête la migration avant toute écriture.

## 4. Sauvegarde

```bash
docker exec studiio-db pg_dump -U studiio -d studiio -Fc \
  -f /tmp/avant-mobile-money-$(date +%F).dump
docker cp studiio-db:/tmp/avant-mobile-money-$(date +%F).dump ./
pg_restore --list avant-mobile-money-$(date +%F).dump | head   # VÉRIFIER, pas seulement produire
```

La migration ne transforme aucune donnée ; la sauvegarde quotidienne de 03h00
suffirait. Celle-ci est la ceinture.

## 5. Application

```bash
docker exec -i studiio-db psql -U studiio -d studiio -v ON_ERROR_STOP=1 \
  < migrations/2026-11-13-mobile-money.sql
docker kill -s SIGUSR1 studiio-postgrest
```

> ⚠️ **Avec le rôle des migrations (`studiio`), jamais en superutilisateur.**
> Les privilèges par défaut du 29/09 n'ouvrent une fonction et une table à
> `service_role` que si elles sont créées par ce rôle. Jouée autrement, la
> table serait illisible par l'API et la fonction inexécutable — sans erreur
> à l'application, seulement des paiements qui restent en attente.

## 6. Contrôles — lecture seule, dans l'ordre

```sql
-- 1. La table et ses index.
select count(*) from public.pawapay_depots;                      -- 0
-- La colonne qui fait TOURNER la file de reconciliation : sans elle, des
-- depots jamais honores occuperaient la fenetre de relecture pour toujours.
select column_name from information_schema.columns
 where table_name = 'pawapay_depots'
   and column_name = 'derniere_verification_le';                 -- 1 ligne
select indexname from pg_indexes
 where indexname = 'credit_transactions_mm_reference_unique';    -- 1 ligne

-- 2. La fonction, en SECURITY DEFINER, search_path figé.
select proname, prosecdef, proconfig from pg_proc
 where proname = 'crediter_credits_mobile_money';                -- prosecdef = t

-- 3. PUBLIC ne peut pas l'exécuter.
select has_function_privilege('public',
  'public.crediter_credits_mobile_money(uuid,integer,text,text,text)', 'EXECUTE');  -- false

-- 4. ⚠️ LE CONTRÔLE QUI COMPTE : le rôle serveur, lui, le peut.
select has_function_privilege('service_role',
  'public.crediter_credits_mobile_money(uuid,integer,text,text,text)', 'EXECUTE');  -- true
select has_table_privilege('service_role', 'public.pawapay_depots', 'INSERT');      -- true
-- false = migration jouée par le mauvais rôle (cf. § 5). Corriger par :
--   grant execute on function public.crediter_credits_mobile_money(uuid,integer,text,text,text) to service_role;
--   grant select, insert, update on table public.pawapay_depots to service_role;
--   puis  docker kill -s SIGUSR1 studiio-postgrest

-- 5. Les crédits Stripe ne sont pas touchés.
select count(*) from credit_transactions where reference_id like 'stripe:%';        -- inchangé
```

## 6 bis. Ce qui est deja eprouve sur un vrai PostgreSQL

`tests-pg/mobile-money.pg.test.ts` joue CETTE migration sur un Postgres 16
reel (`npm run test:pg`, et le job « Credits - PostgreSQL reel » en CI). Dix
ouvertures **simultanees** n'y laissent passer que cinq depots, deux
confirmations concurrentes ne creditent qu'une fois, et un statut invente est
refuse. Ces proprietes sont celles du moteur : aucune ne peut etre etablie
par un double en memoire.

## 7. Retour arrière

```bash
docker exec -i studiio-db psql -U studiio -d studiio -v ON_ERROR_STOP=1 \
  < migrations/rollback/2026-11-13-mobile-money.rollback.sql
docker kill -s SIGUSR1 studiio-postgrest
```

Il supprime **la fonction et l'index**. La table `pawapay_depots` **reste** :
elle porte le journal des paiements, et un encaissement doit rester traçable
après un retour arrière. Les crédits déjà accordés ne sont pas repris — ce
sont des lignes `credit_transactions` ordinaires, de type `purchase`.

La suppression de la table est donnée en commentaire dans le fichier de
retour arrière, volontairement inactive, à n'exécuter que si elle est vide.

## 8. Ordre par rapport à l'ouverture du service

L'application de la migration **n'ouvre rien**. Le paiement mobile reste fermé
tant que les variables d'environnement ne sont pas posées
(`MOBILE_MONEY_ACTIF=1`, jeton, adresse de notification), et le drapeau exige
la valeur exacte `1`. L'ordre est donc :

1. appliquer la migration et passer les contrôles ;
2. poser les variables **en bac à sable** et éprouver le parcours ;
3. **seulement ensuite**, et sur décision, basculer l'adresse de base en
   production.
