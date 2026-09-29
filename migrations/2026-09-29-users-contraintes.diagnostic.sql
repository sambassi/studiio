-- ═══════════════════════════════════════════════════════════════════════════
-- DIAGNOSTIC — users : a lancer AVANT `2026-09-29-users-contraintes.sql`.
--
-- LECTURE SEULE. Aucune ecriture, aucun verrou au-dela d'un SELECT.
-- Chaque requete doit renvoyer ZERO LIGNE (sauf la 0 et la 5, informatives)
-- pour que la migration puisse s'appliquer. Si une requete renvoie des
-- lignes, la migration ECHOUERA volontairement : ne rien supprimer, suivre
-- la procedure manuelle decrite en tete de la migration.
--
-- Execution suggeree (depuis le serveur, sans exposer de secret) :
--   docker exec -i studiio-db psql -U studiio -d studiio -v ON_ERROR_STOP=1 \
--     -f - < migrations/2026-09-29-users-contraintes.diagnostic.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- 0. Colonnes presentes (informatif) : `stripe_customer_id` existe-t-elle ?
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'users'
 order by ordinal_position;

-- 1. Doublons d'e-mail a la casse / aux espaces pres.
--    Chaque ligne = un groupe de comptes qui deviendraient illegaux.
select lower(btrim(email))                        as email_normalise,
       count(*)                                   as nb_comptes,
       array_agg(id order by created_at)          as ids,
       array_agg(email order by created_at)       as emails_bruts,
       array_agg(credits order by created_at)     as credits
  from public.users
 group by lower(btrim(email))
having count(*) > 1
 order by nb_comptes desc;

-- 2. E-mails vides ou faits d'espaces (NOT NULL ne les empeche pas).
select id, email, created_at
  from public.users
 where btrim(email) = '';

-- 3. Doublons de stripe_customer_id (a ne lancer que si la requete 0 montre
--    la colonne ; sinon PostgreSQL repond « column does not exist », ce qui
--    signifie simplement : aucun doublon possible).
select stripe_customer_id,
       count(*)                          as nb_comptes,
       array_agg(id order by created_at) as ids,
       array_agg(email order by created_at) as emails
  from public.users
 where stripe_customer_id is not null
 group by stripe_customer_id
having count(*) > 1;

-- 4. Chaines vides dans stripe_customer_id (deux '' entreraient en conflit).
select id, email
  from public.users
 where stripe_customer_id is not null and btrim(stripe_customer_id) = '';

-- 5. Etat des contraintes deja en place (informatif) : `users_email_key`
--    (unicite sensible a la casse) et `users_credits_non_negatif`
--    (posee NOT VALID par 2026-08-27-credits-atomiques.sql).
select conname, contype, convalidated, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'public.users'::regclass
 order by conname;

-- 6. Soldes negatifs : si 0 ligne, `users_credits_non_negatif` peut etre
--    validee a part (hors de ce lot) :
--      alter table public.users validate constraint users_credits_non_negatif;
select id, email, credits
  from public.users
 where credits < 0;
