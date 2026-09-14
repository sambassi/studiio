-- ============================================================================
-- A2 — LA BIBLIOTHEQUE DE LUT DU COMPTE : `lut_assets`
-- ============================================================================
--
-- Une ligne par (compte, empreinte). C'est la SEULE source des LUT importees :
-- le wizard Creer, l'Autopilote, l'apercu et le moteur de rendu la lisent tous
-- par le meme contrat (`LutAsset`, src/lib/luts/types.ts). Elle ne vit PAS
-- dans `autopilot_config.design_style` : une LUT est un objet du compte, pas
-- une preference de l'Autopilote, et Creer ne doit rien devoir a l'Autopilote.
--
-- ---------------------------------------------------------------------------
-- 1. CE QUE LA BASE GARANTIT ELLE-MEME
-- ---------------------------------------------------------------------------
--
--   - DEDUPLICATION : `unique (user_id, empreinte)`. Deux imports simultanes
--     des memes octets ne peuvent pas produire deux fiches.
--   - PLAFOND : `lut_assets_ajouter` prend un verrou consultatif PAR COMPTE
--     avant de compter puis d'inserer. Un `count -> insert` en deux requetes
--     laisserait passer 41 fiches quand deux imports comptent 39 en meme
--     temps ; ici le second attend le premier, recompte, et est refuse.
--   - CONTRAT A1 : chaque `check` reprend une borne du socle. Une fiche que
--     `lutAssetValide` rejetterait ne peut pas entrer en base.
--   - PROPRIETE : la cle est EXACTEMENT `<user_id>/lut/<empreinte>.cube`. Une
--     cle d'un autre compte, ou un chemin fabrique, est refusee par la base
--     elle-meme — pas seulement par le code.
--   - AUCUNE URL : la cle ne peut pas contenir `://`. L'identite est
--     l'empreinte, l'acces passe par une route authentifiee.
--
-- ---------------------------------------------------------------------------
-- 2. LA TABLE
-- ---------------------------------------------------------------------------

create table if not exists public.lut_assets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,

  -- SHA-256 hexadecimal minuscule des octets `.cube` CANONIQUES.
  empreinte    text not null check (empreinte ~ '^[0-9a-f]{64}$'),

  -- La cle de l'objet prive. Verifiee EXACTEMENT contre le compte et
  -- l'empreinte : ni traversee, ni URL, ni autre compte, ni autre extension.
  cle          text not null,

  nom          text not null check (length(btrim(nom)) between 1 and 100),
  titre        text check (titre is null or length(titre) <= 100),

  kind         text not null check (kind in ('3d', '1d')),
  origine      text not null check (origine in ('cube', 'png')),

  -- Bornes du socle : MAX_LUT_SIZE = 65 (cube), MAX_LUT_1D_SIZE = 65536.
  taille       integer not null,
  -- MAX_LUT_BYTES = 8 Mio.
  octets       integer not null check (octets > 0 and octets <= 8388608),

  -- `double precision[3]` n'impose RIEN a PostgreSQL sur la longueur : la
  -- dimension declaree est documentaire. Les `check` ci-dessous, eux, exigent
  -- exactement trois valeurs sur une seule dimension.
  --
  -- ⚠️ `cardinality`, PAS `array_length` : sur un tableau VIDE, `array_length`
  -- et `array_ndims` rendent NULL, un `check` NULL passe, et `'{}'` entrait.
  -- `cardinality('{}') = 0` est faux, donc refuse.
  domain_min   double precision[] not null default '{0,0,0}',
  domain_max   double precision[] not null default '{1,1,1}',

  importee_le  timestamptz not null default now(),

  constraint lut_assets_user_empreinte_key unique (user_id, empreinte),

  constraint lut_assets_taille_par_nature check (
    (kind = '3d' and taille between 2 and 65)
    or (kind = '1d' and taille between 2 and 65536)
  ),

  constraint lut_assets_cle_du_compte check (
    cle = user_id::text || '/lut/' || empreinte || '.cube'
  ),
  constraint lut_assets_cle_sans_url check (cle not like '%://%'),

  constraint lut_assets_domain_min_3 check (
    cardinality(domain_min) = 3 and array_ndims(domain_min) = 1
  ),
  constraint lut_assets_domain_max_3 check (
    cardinality(domain_max) = 3 and array_ndims(domain_max) = 1
  )
);

create index if not exists lut_assets_user_idx
  on public.lut_assets (user_id, importee_le desc);

comment on table public.lut_assets is
  'Bibliotheque de LUT du compte (A2). Une fiche par (user_id, empreinte) ; '
  'objet prive media/<user_id>/lut/<empreinte>.cube ; contrat LutAsset (src/lib/luts/types.ts).';

-- ---------------------------------------------------------------------------
-- 3. L'AJOUT ATOMIQUE : dedoublonnage ET plafond sous le meme verrou
-- ---------------------------------------------------------------------------
--
-- `pg_advisory_xact_lock(cle1, cle2)` : verrou par COMPTE, libere avec la
-- transaction. Deux imports du meme compte se serialisent ; deux comptes ne
-- s'attendent pas. Sous ce verrou, le compte des fiches est exact au moment
-- de l'insertion : le plafond ne peut pas etre depasse, meme sous concurrence.
--
-- L'ORDRE COMPTE : le doublon est tranche AVANT le plafond. Reimporter un
-- fichier deja present alors que la bibliotheque est pleine doit rendre
-- « existante », pas « pleine » : rien n'est ajoute, donc rien ne deborde.
--
-- `security definer` + `search_path` fige, comme les autres fonctions du depot.
-- Retiree a `public` : seul le role de service, proprietaire, peut l'appeler.

create or replace function public.lut_assets_ajouter(
  p_user_id    uuid,
  p_empreinte  text,
  p_cle        text,
  p_nom        text,
  p_titre      text,
  p_kind       text,
  p_origine    text,
  p_taille     integer,
  p_octets     integer,
  p_domain_min double precision[],
  p_domain_max double precision[],
  p_max        integer
)
returns table (issue text, id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id     uuid;
  v_nombre integer;
begin
  if p_user_id is null then
    return query select 'invalide'::text, null::uuid;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('lut_assets'), hashtext(p_user_id::text));

  select a.id into v_id
    from public.lut_assets a
   where a.user_id = p_user_id and a.empreinte = p_empreinte;
  if v_id is not null then
    return query select 'existante'::text, v_id;
    return;
  end if;

  select count(*) into v_nombre from public.lut_assets a where a.user_id = p_user_id;
  if v_nombre >= greatest(0, coalesce(p_max, 0)) then
    return query select 'pleine'::text, null::uuid;
    return;
  end if;

  insert into public.lut_assets (
    user_id, empreinte, cle, nom, titre, kind, origine, taille, octets,
    domain_min, domain_max
  ) values (
    p_user_id, p_empreinte, p_cle, p_nom, p_titre, p_kind, p_origine, p_taille,
    p_octets, coalesce(p_domain_min, '{0,0,0}'), coalesce(p_domain_max, '{1,1,1}')
  )
  returning public.lut_assets.id into v_id;

  return query select 'creee'::text, v_id;
exception
  -- Ceinture et bretelles : le verrou rend ce cas impossible, la contrainte
  -- le rendrait visible. Une violation d'unicite EST une fiche existante.
  when unique_violation then
    select a.id into v_id
      from public.lut_assets a
     where a.user_id = p_user_id and a.empreinte = p_empreinte;
    return query select 'existante'::text, v_id;
end;
$$;

revoke all on function public.lut_assets_ajouter(
  uuid, text, text, text, text, text, text, integer, integer,
  double precision[], double precision[], integer
) from public;

-- ---------------------------------------------------------------------------
-- 4. AUCUN DROIT OUVERT
-- ---------------------------------------------------------------------------
--
-- Pas de `grant`. Le role qui execute cette migration possede la table et la
-- fonction ; un `grant ... to public` les ouvrirait au role anonyme de
-- PostgREST. Le code passe par le role de service.
--
-- ---------------------------------------------------------------------------
-- 5. OBJETS ORPHELINS — documente, pas traite ici
-- ---------------------------------------------------------------------------
--
-- Le stockage objet et PostgreSQL ne partagent pas de transaction. L'API ecrit
-- l'objet PUIS la fiche : si la fiche est refusee (plafond atteint entre-temps,
-- panne), l'objet reste. Il porte le nom de son empreinte, dans le namespace
-- prive du compte : personne d'autre ne peut le designer, le relais public le
-- refuse, il ne coute que quelques kilo-octets, et le supprimer detruirait
-- celui d'un import concurrent qui vient de reussir avec les memes octets.
-- Un orphelin prive vaut mieux qu'une suppression croisee. Un nettoyage
-- (objets `<user_id>/lut/*.cube` sans fiche) est possible plus tard, hors ligne.
--
-- ---------------------------------------------------------------------------
-- 6. APRES APPLICATION
-- ---------------------------------------------------------------------------
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- Sans cela la table et la fonction existent en base et restent invisibles de
-- l'API : PostgREST ne relit son cache de schema qu'au demarrage.
