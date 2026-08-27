-- ═══════════════════════════════════════════════════════════════════════════
-- CREDITS : DEBIT ATOMIQUE, PRIX SERVEUR, REFERENCE IDEMPOTENTE
--
-- ⚠️ TANT QU'ELLE N'EST PAS APPLIQUEE
--
-- `src/lib/credits/atomique.ts` sonde la fonction et, si elle est absente,
-- laisse le chemin historique en place. Rien ne casse — mais rien n'est
-- protege non plus. Le mode Serie reste ferme dans les deux cas.
--
-- ─────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE CORRIGE
-- ─────────────────────────────────────────────────────────────────────────
--
-- `deductCredits` (src/lib/credits/system.ts:33-46) lisait le solde, le
-- diminuait en JavaScript, reecrivait une valeur ABSOLUE, puis journalisait
-- dans une requete separee. Trois consequences, toutes constatees :
--
--   1. Deux debits concurrents lisaient le meme solde et ecrivaient la meme
--      valeur : un rendu gratuit. C'est une perte de mise a jour classique,
--      reproduite sur un vrai moteur dans `tests-pg/credits-atomiques.pg.test.ts`.
--   2. Rejouer la meme requete debitait deux fois : `reference_id` existait
--      en base mais n'etait ecrit par personne, et ne portait aucun index.
--   3. `users.credits` n'avait aucune contrainte : un solde negatif etait
--      accepte sans bruit.
--
-- ─────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE NE PRETEND PAS FAIRE
-- ─────────────────────────────────────────────────────────────────────────
--
-- Elle rend le DEBIT sur : atomique, idempotent, au prix du serveur. Elle ne
-- prouve pas qu'un rendu a eu lieu — cette preuve n'existe nulle part dans
-- l'architecture actuelle, le montage etant compose et televerse par le
-- navigateur. C'est un socle, pas la fin du sujet.
--
-- Additive et rejouable : aucune donnee historique n'est supprimee, corrigee
-- ni reecrite. Les lignes existantes portent `reference_id IS NULL` et le
-- restent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. TARIFS — la source de verite du PRIX, cote serveur
--
-- Une table, et non un argument de la fonction : c'est ce qui rend
-- impossible le choix d'un montant par l'appelant. Meme si la fonction
-- devenait joignable depuis un navigateur, il ne pourrait choisir qu'un
-- FORMAT, dont le prix est ici.
--
-- Les valeurs refletent `RENDER_COSTS` (src/lib/stripe/constants.ts:94), et
-- un test compare les deux pour qu'elles ne divergent pas en silence.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.tarifs_rendu (
  format     text primary key,
  credits    integer not null check (credits >= 0),
  updated_at timestamptz not null default now()
);

insert into public.tarifs_rendu (format, credits) values ('reel', 10), ('tv', 15)
  on conflict (format) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. IDEMPOTENCE — un debit par (utilisateur, reference)
--
-- Index PARTIEL, et c'est indispensable : toutes les lignes deja en
-- production ont `reference_id IS NULL`. Un index unique complet les
-- refuserait en bloc et rendrait la migration inapplicable. Ici, elles
-- restent valides et peuvent rester nombreuses.
--
-- La cle porte l'UTILISATEUR autant que la reference : deux personnes
-- peuvent legitimement produire le meme jeton, et l'une ne doit jamais
-- empecher l'autre de payer — ni, pire, se voir opposer un « deja debite »
-- qui appartient a quelqu'un d'autre.
-- ─────────────────────────────────────────────────────────────────────────
-- La colonne AVANT l'index qui l'indexe.
--
-- Elle etait supposee presente : `src/lib/db/migrations/002_complete_schema.sql:58`
-- la declare. Mais ce fichier date de l'ere Supabase et n'a jamais ete applique
-- INTEGRALEMENT a la base Hetzner — il contient `create policy if not exists`,
-- une syntaxe qui n'existe dans aucune version de PostgreSQL, et toute
-- execution s'interrompt avant la fin. La production n'a donc jamais eu cette
-- colonne, et le precontrole l'a montre :
--
--   ERROR: column "reference_id" does not exist
--
-- Sans cette instruction, la migration echoue ici meme. On ne corrige PAS
-- `002_complete_schema.sql` pour masquer l'ecart : ce fichier decrit une base
-- qui n'est plus la notre, et le reecrire ferait croire que le schema du depot
-- decrit la production.
--
-- Nullable, sans defaut, sans remplissage : les lignes existantes restent
-- exactement ce qu'elles sont, avec `reference_id IS NULL`.
alter table public.credit_transactions
  add column if not exists reference_id varchar(255);

-- `description` subit exactement le meme sort : declaree dans
-- `002_complete_schema.sql`, jamais garantie en production, et ECRITE par la
-- fonction plus bas (`insert ... (user_id, amount, type, reference_id,
-- description)`). Son absence ne ferait pas echouer CETTE migration — elle
-- ferait echouer le premier debit reel, en production, apres deploiement.
-- Meme forme : nullable, sans defaut, sans remplissage.
alter table public.credit_transactions
  add column if not exists description text;

create unique index if not exists credit_transactions_reference_unique
  on public.credit_transactions (user_id, reference_id)
  where reference_id is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. AUCUN SOLDE NEGATIF
--
-- `not valid` : la contrainte s'applique a toute ecriture future sans
-- verifier les lignes existantes. Si un solde negatif traine deja en
-- production, la migration passe quand meme et ne le corrige PAS en silence
-- — le constater est un travail a part, avec ses propres yeux.
--
-- Pour la valider plus tard, une fois les donnees inspectees :
--   alter table public.users validate constraint users_credits_non_negatif;
-- ─────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'users_credits_non_negatif'
       and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_credits_non_negatif check (credits >= 0) not valid;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. LE DEBIT ATOMIQUE
--
-- Une seule instruction decide et ecrit :
--
--   update users set credits = credits - cout where id = ? and credits >= cout
--
-- Decrement RELATIF, jamais une valeur absolue calculee ailleurs : deux
-- transactions concurrentes ne peuvent plus lire le meme solde et ecrire la
-- meme valeur. Le `where credits >= cout` fait le refus dans la meme
-- instruction que le retrait — il n'y a pas d'intervalle entre les deux.
--
-- Le journal est ecrit dans la MEME transaction : une fonction plpgsql
-- s'execute tout entiere dans la transaction de l'appelant. Si l'insert
-- echoue, le retrait est annule avec lui. Il n'existe aucun etat ou le solde
-- aurait bouge sans trace.
--
-- L'unique_violation n'est pas une erreur, c'est la reponse a une course :
-- deux appels avec la meme reference partent ensemble, tous deux passent le
-- `update`, un seul insere. Le perdant remonte ici, son bloc est annule
-- jusqu'au savepoint implicite du EXCEPTION — donc son retrait aussi — et il
-- rend le resultat du gagnant. Une seule ligne, un seul debit.
--
-- SECURITY DEFINER avec `search_path` fige : sans lui, un appelant pourrait
-- placer devant `public` un schema a lui contenant une fausse table `users`.
-- Toutes les tables sont en plus qualifiees explicitement.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.debiter_credits(
  p_user_id   uuid,
  p_format    text,
  p_reference text
)
returns table (ok boolean, solde integer, deja_debite boolean, motif text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_cout  integer;
  v_solde integer;
begin
  if p_reference is null or length(trim(p_reference)) = 0 then
    return query select false, 0, false, 'reference_absente'::text;
    return;
  end if;

  select credits into v_cout from public.tarifs_rendu where format = p_format;
  if v_cout is null then
    return query select false, 0, false, 'format_inconnu'::text;
    return;
  end if;

  select credits into v_solde from public.users where id = p_user_id;
  if not found then
    return query select false, 0, false, 'utilisateur_inconnu'::text;
    return;
  end if;

  -- Rejeu d'un debit deja passe : on rend le resultat precedent, sans rien
  -- retirer. C'est ce qui rend une requete reseau repetee inoffensive.
  if exists (
    select 1 from public.credit_transactions
     where user_id = p_user_id and reference_id = p_reference
  ) then
    return query select true, v_solde, true, null::text;
    return;
  end if;

  -- Le retrait ET le journal dans le MEME bloc a EXCEPTION, et c'est le
  -- point delicat : plpgsql n'ouvre un savepoint que pour le bloc qui porte
  -- le EXCEPTION. Un `update` place AVANT ce bloc ne serait PAS annule par
  -- le handler — le perdant d'une course garderait son retrait sans avoir de
  -- ligne au journal, exactement le trou qu'on ferme ici.
  begin
    update public.users
       set credits = credits - v_cout
     where id = p_user_id and credits >= v_cout
     returning credits into v_solde;

    if not found then
      select credits into v_solde from public.users where id = p_user_id;
      return query select false, v_solde, false, 'solde_insuffisant'::text;
      return;
    end if;

    insert into public.credit_transactions (user_id, amount, type, reference_id, description)
    values (p_user_id, -v_cout, 'render', p_reference, 'rendu ' || p_format);

  exception when unique_violation then
    -- Course perdue : quelqu'un d'autre a insere la meme reference entre
    -- notre `exists` et notre `insert`. Le retour au savepoint annule NOTRE
    -- retrait avec le reste du bloc ; on relit le solde tel que le gagnant
    -- l'a laisse, et on rend son resultat.
    select credits into v_solde from public.users where id = p_user_id;
    return query select true, v_solde, true, null::text;
    return;
  end;

  return query select true, v_solde, false, null::text;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. DROITS
--
-- `revoke ... from public` retire l'execution a tout le monde : le proprietaire
-- de la fonction reste seul a pouvoir l'appeler. C'est deliberement plus
-- ferme que le reste du depot, qui fait `grant all ... to public` sur ses
-- tables — une table qu'on lit n'est pas une fonction qui deplace de l'argent.
--
-- Si le role PostgREST de production n'est pas proprietaire, lui accorder
-- l'execution NOMMEMENT, jamais a `public` :
--   grant execute on function public.debiter_credits(uuid,text,text) to <role>;
-- ─────────────────────────────────────────────────────────────────────────
revoke all on function public.debiter_credits(uuid, text, text) from public;

grant select on table public.tarifs_rendu to public;

-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ APRES CETTE MIGRATION — ETAPE OBLIGATOIRE
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- PostgREST ne relit son cache de schema qu'au demarrage : sans ce signal, il
-- ignore la nouvelle fonction et repond 404 sur /rpc/debiter_credits.
--
-- CONTROLES PREALABLES (avant d'appliquer) :
--   select exists(select 1 from information_schema.columns
--                  where table_schema='public' and table_name='credit_transactions'
--                    and column_name='reference_id');
--     -- `false` est l'etat NORMAL avant migration : la colonne est creee ici.
--     -- Si `true`, alors seulement :
--   select count(*) from public.credit_transactions where reference_id is not null;
--     -- attendu : 0. Sinon, verifier qu'il n'y a pas deja de doublon :
--   select user_id, reference_id, count(*) from public.credit_transactions
--    where reference_id is not null group by 1,2 having count(*) > 1;
--     -- attendu : aucune ligne. Sinon l'index unique echouera.
--   select count(*) from public.users where credits < 0;
--     -- pour information : la contrainte est `not valid`, elle ne les touchera pas.
--
-- CONTROLES POSTERIEURS :
--   select indexdef from pg_indexes where indexname = 'credit_transactions_reference_unique';
--   select format, credits from public.tarifs_rendu order by format;   -- reel|10, tv|15
--   select has_function_privilege('public', 'public.debiter_credits(uuid,text,text)', 'EXECUTE');
--     -- attendu : false
-- ═══════════════════════════════════════════════════════════════════════════
