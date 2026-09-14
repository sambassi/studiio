-- A_8f (correctif Gap-1) — UNE GENERATION SAIT POURQUOI ELLE EXISTE.
--
-- Migration ADDITIVE. Aucune colonne supprimee, aucun type change, aucune
-- ligne reecrite ni effacee. Elle se rejoue sans effet.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 1. POURQUOI UNE COLONNE D'INTENTION
-- ─────────────────────────────────────────────────────────────────────────
--
-- Valider son clone exige de l'avoir VU : la route de validation cherche une
-- generation terminee, et c'est elle qui sert d'apercu. Mais generer exigeait
-- jusqu'ici... rien du tout, ni validation ni limite. Deux intentions
-- differentes passaient par la meme porte :
--
--   apercu   → « montre-moi mon clone pour que je decide » — AVANT validation,
--              une seule fois par version, sur un script court fixe par Studiio.
--   normale  → « fais-lui dire ce texte » — APRES validation seulement.
--
-- Sans colonne, la route ne pourrait distinguer les deux qu'en devinant
-- depuis `validated_at`, et la limite « un apercu par version » ne tiendrait
-- qu'en memoire d'un seul processus.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 2. LES LIGNES EXISTANTES SONT DES GENERATIONS NORMALES
-- ─────────────────────────────────────────────────────────────────────────
--
-- Elles ont ete produites sans notion d'apercu ; les qualifier d'« apercu »
-- ferait valider un clone sur une video qui n'a jamais ete demandee pour ca.
-- Le defaut `normale` decrit exactement ce qu'elles sont.
alter table public.avatar_generations
  add column if not exists intention text not null default 'normale';

-- Deux valeurs, et aucune autre : une intention libre serait une intention
-- que personne ne lit.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'avatar_generations_intention_check'
       and conrelid = 'public.avatar_generations'::regclass
  ) then
    alter table public.avatar_generations
      add constraint avatar_generations_intention_check
      check (intention in ('apercu', 'normale'));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. UN APERCU PORTE TOUJOURS SA VERSION
-- ─────────────────────────────────────────────────────────────────────────
--
-- `avatar_version` est nullable pour l'historique (A_8b : « on ne sait pas »
-- vaut mieux qu'un « 1 » invente). Mais un apercu SANS version ne pourrait
-- etre rattache a aucune validation — et l'index ci-dessous, ou deux NULL ne
-- se heurtent jamais, ne le limiterait pas. La base le refuse donc.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'avatar_generations_apercu_versionne_check'
       and conrelid = 'public.avatar_generations'::regclass
  ) then
    alter table public.avatar_generations
      add constraint avatar_generations_apercu_versionne_check
      check (intention <> 'apercu' or avatar_version is not null);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. UN SEUL APERCU NON ECHOUE PAR VERSION — ET C'EST LA BASE QUI ARBITRE
-- ─────────────────────────────────────────────────────────────────────────
--
-- ⚠️ CE N'EST PAS UNE OPTIMISATION, C'EST LA GARANTIE. Deux requetes qui
-- lisent « aucun apercu » au meme instant inserent toutes les deux ; sans cet
-- index, les deux partent chez le fournisseur et les deux sont facturees. Un
-- verrou en memoire ne tiendrait qu'un seul processus a la fois.
--
-- L'insertion de la reservation (status = 'pending') precede l'appel au
-- fournisseur : le perdant recoit 23505 et ne l'appelle jamais.
--
-- `status <> 'failed'` : un apercu echoue libere la place. La limite porte
-- sur UN apercu reussi ou en cours, pas sur une requete a vie.
create unique index if not exists avatar_generations_apercu_unique
  on public.avatar_generations (user_avatar_id, avatar_version)
  where intention = 'apercu' and status <> 'failed';

-- ─────────────────────────────────────────────────────────────────────────
-- DROITS POSTGREST
--
-- Sans droits, PostgREST n'inscrit pas la table dans son cache de schema.
-- ─────────────────────────────────────────────────────────────────────────
grant all on table public.avatar_generations to public;

-- ─────────────────────────────────────────────────────────────────────────
-- ⚠️ APRES CETTE MIGRATION — ETAPE OBLIGATOIRE
--
--     docker kill -s SIGUSR1 studiio-postgrest
--
-- Elle ne redemarre pas le conteneur : elle demande la relecture du schema.
-- Sans elle, la colonne `intention` reste invisible et l'insertion echoue.
-- ─────────────────────────────────────────────────────────────────────────
