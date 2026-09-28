# Runbook — migration PawaPay (`pawapay_deposits` + `crediter_depot_pawapay`)

Application MANUELLE en production par le coordinateur. Aucun secret dans ce
document : les commandes s'appuient sur les conteneurs et rôles déjà en place.

Fichiers :
- `migrations/2026-09-28-pawapay-deposits.sql`
- `migrations/2026-09-28-pawapay-deposits.rollback.sql`

Ordre global (règle durable) : **migration → vérification → SIGUSR1 PostgREST
→ SEULEMENT ENSUITE `PAWAPAY_ENABLED=true`**. Tant que la variable n'est pas
posée, `obtenirStore()` renvoie `null` et aucun code ne touche la table.

> Les noms `studiio-db` / `studiio-postgrest` sont ceux de `CLAUDE.md`. Sous
> Coolify, le nom réel du conteneur peut porter un suffixe : le vérifier avec
> `docker ps --format '{{.Names}}' | grep -E 'studiio-(db|postgrest)'` et
> l'adapter dans chaque commande.

---

## 0. Pré-contrôles (lecture seule)

```bash
docker exec -i studiio-db psql -U studiio -d studiio -v ON_ERROR_STOP=1 <<'SQL'
-- Le socle crédits doit être là (la migration refuse sinon) :
select indexname from pg_indexes where indexname = 'credit_transactions_reference_unique';
  -- attendu : 1 ligne
-- La table ne doit pas déjà exister sous une autre forme :
select to_regclass('public.pawapay_deposits');
  -- attendu : NULL (première application)
-- Qui est le propriétaire des tables ? (doit être le rôle qui applique la migration)
select pg_get_userbyid(relowner) from pg_class where oid = 'public.credit_transactions'::regclass;
  -- attendu : studiio
-- Le type 'purchase' est accepté par credit_transactions :
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.credit_transactions'::regclass and contype = 'c';
  -- attendu : la liste des types contient 'purchase'
-- Témoins métier AVANT (à noter) :
select count(*) as users, sum(credits) as credits from public.users;
select count(*) as transactions from public.credit_transactions;
SQL
```

Rôle utilisé par PostgREST (sans afficher l'URI qui contient le mot de passe) :

```bash
docker inspect studiio-postgrest --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^PGRST_DB_(ANON_ROLE|SCHEMAS)='
```

Attendu : `PGRST_DB_ANON_ROLE=studiio`. Si c'est un AUTRE rôle, voir § 3.

## 1. Sauvegarde

```bash
docker exec studiio-db pg_dump -U studiio studiio > ~/backup-studiio-avant-pawapay-$(date +%Y%m%d-%H%M%S).sql
ls -lh ~/backup-studiio-avant-pawapay-*.sql   # taille non nulle
```

## 2. Application du SQL

Depuis un checkout du commit à déployer (fichier copié sur le serveur) :

```bash
docker exec -i studiio-db psql -U studiio -d studiio -v ON_ERROR_STOP=1 \
  < migrations/2026-09-28-pawapay-deposits.sql
```

La migration est additive et rejouable. Elle s'arrête d'elle-même
(`Prerequis absent`) si `2026-08-27-credits-atomiques.sql` n'a pas été
appliquée.

## 3. Droits minimaux

La migration pose déjà :
- `revoke all ... from public` sur la fonction ET sur la table ;
- `grant execute` sur la fonction et `grant select, insert, update` sur la
  table au rôle `studiio`, s'il existe.

Si PostgREST tourne en `studiio` (propriétaire), **rien d'autre à faire**.

Si `PGRST_DB_ANON_ROLE` (ou le rôle porté par le JWT de `SUPABASE_SERVICE_KEY`)
est un AUTRE rôle `<role_serveur>`, lui accorder NOMMÉMENT, jamais à `public` :

```sql
grant execute on function public.crediter_depot_pawapay(uuid, uuid, integer, text) to <role_serveur>;
grant select, insert, update on table public.pawapay_deposits to <role_serveur>;
```

⚠️ Ne PAS appliquer ici le `grant all on table ... to public` décrit dans
`CLAUDE.md` pour les autres tables : cette table porte des paiements, et la
fonction déplace des crédits. Pour que PostgREST la voie, il suffit que SON
rôle ait les droits.

## 4. Rechargement du cache PostgREST

```bash
docker kill -s SIGUSR1 studiio-postgrest
docker logs --since 1m studiio-postgrest 2>&1 | tail -5   # « Schema cache loaded »
```

## 5. Vérifications

```bash
docker exec -i studiio-db psql -U studiio -d studiio -v ON_ERROR_STOP=1 <<'SQL'
-- Table, colonnes, contraintes
\d public.pawapay_deposits
-- Index du cron
select indexdef from pg_indexes where indexname = 'pawapay_deposits_statut_verifie_le';
  -- attendu : (statut, verifie_le NULLS FIRST, cree_le)
-- Fonction : SECURITY DEFINER, search_path figé
select prosecdef, proconfig from pg_proc
 where oid = 'public.crediter_depot_pawapay(uuid,uuid,integer,text)'::regprocedure;
  -- attendu : t | {"search_path=pg_catalog, public"}
-- Droits
select has_function_privilege('public', 'public.crediter_depot_pawapay(uuid,uuid,integer,text)', 'EXECUTE');
  -- attendu : f
select has_function_privilege('studiio', 'public.crediter_depot_pawapay(uuid,uuid,integer,text)', 'EXECUTE');
  -- attendu : t
-- Témoins métier APRÈS : identiques aux valeurs notées au § 0
select count(*) as users, sum(credits) as credits from public.users;
select count(*) as transactions from public.credit_transactions;
select count(*) from public.pawapay_deposits;   -- attendu : 0
SQL
```

Vérification PostgREST SANS écriture, depuis le conteneur de l'application
(réseau Docker interne ; la clé est lue dans l'environnement du conteneur,
jamais recopiée) :

```bash
docker exec studiio-app sh -c 'curl -s -o /dev/null -w "%{http_code}\n" \
  -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  "$SUPABASE_URL/pawapay_deposits?select=deposit_id&limit=1"'
# attendu : 200 (et non 404 « Could not find the table »)
```

Ne PAS appeler la RPC pour tester : elle n'accepte qu'un dépôt réel et un
appel réussi crédite un compte.

## 6. Activation (étape séparée)

Seulement après les §§ 1-5 : poser `PAWAPAY_ENABLED=true` (et `PAWAPAY_RATES`,
clés PawaPay) dans Coolify → `studiio-app`, puis redéployer.

## 7. Rollback

1. Retirer `PAWAPAY_ENABLED` (ou la passer à `false`) dans Coolify et
   redéployer — sinon les routes PawaPay répondront 500.
2. Sauvegarder les dépôts (le rollback supprime la table) :
   ```bash
   docker exec studiio-db pg_dump -U studiio -t public.pawapay_deposits studiio \
     > ~/backup-pawapay-deposits-$(date +%Y%m%d-%H%M%S).sql
   ```
3. Appliquer :
   ```bash
   docker exec -i studiio-db psql -U studiio -d studiio -v ON_ERROR_STOP=1 \
     < migrations/2026-09-28-pawapay-deposits.rollback.sql
   docker kill -s SIGUSR1 studiio-postgrest
   ```
4. Vérifier :
   ```sql
   select to_regclass('public.pawapay_deposits');   -- NULL
   select to_regprocedure('public.crediter_depot_pawapay(uuid,uuid,integer,text)');   -- NULL
   select indexname from pg_indexes where indexname = 'credit_transactions_reference_unique';   -- toujours là
   ```

Le rollback ne retire AUCUN crédit déjà accordé : `users.credits` et les
lignes `credit_transactions` `reference_id = 'pawapay:<id>'` restent.
