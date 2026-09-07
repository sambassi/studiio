-- ============================================================================
-- A_0c — LE VERROU DE CONCURRENCE DE L'AUTOPILOTE AUTOMATIQUE
-- ============================================================================
--
-- ---------------------------------------------------------------------------
-- LE DEFAUT QUE CETTE MIGRATION FERME
-- ---------------------------------------------------------------------------
--
-- `creneauxExistants()` lit les posts deja produits et les compare en
-- JavaScript. C'est un CONTROLE, pas un verrou. Deux executions du cron qui
-- se croisent lisent toutes les deux « creneau libre », puis toutes les deux :
--
--   analysent (ffmpeg + moteur visuel), appellent Sonnet, materialisent des
--   clips, encodent une video, debitent des credits
--
-- ... avant que la premiere n'ecrive la preuve que l'autre attendait. Le
-- deuxieme travail est entierement perdu, et il a coute deux fournisseurs et
-- un rendu.
--
-- ---------------------------------------------------------------------------
-- POURQUOI UNE TABLE, ET NON UN VERROU CONSULTATIF
-- ---------------------------------------------------------------------------
--
-- `pg_try_advisory_lock` tient sur une SESSION PostgreSQL. Nos requetes
-- passent par PostgREST, qui prend une connexion dans un pool et la rend :
-- rien ne garantit que le `unlock` parte sur la meme session que le `lock`, ni
-- que la session survive aux minutes d'appels a des fournisseurs externes. Un
-- verrou qu'on ne peut pas relacher a coup sur est pire que pas de verrou.
--
-- `pg_try_advisory_xact_lock` ne vit que le temps d'une transaction. Le cycle
-- automatique dure plusieurs minutes ENTIEREMENT HORS transaction (ffmpeg,
-- HTTP, encodage). Il ne protegerait rien de ce qui coute.
--
-- Un index unique sur `scheduled_posts` ne protege pas davantage : la ligne
-- n'est ecrite qu'a la FIN, une fois tout paye. La collision arriverait apres
-- la depense. Detourner cette table pour y poser une reservation prealable
-- ferait apparaitre un brouillon dans le Calendrier avant qu'aucune video
-- n'existe — on echangerait une garantie contre un mensonge d'ecran.
--
-- Reste une petite table dediee, ou l'unicite EST le verrou, et ou un BAIL
-- borne les degats d'un processus mort.
--
-- ---------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ---------------------------------------------------------------------------
--
-- Elle ne touche a aucune table existante, n'ajoute aucune colonne ailleurs,
-- ne modifie aucune donnee. `scheduled_posts`, `autopilot_config`, les rushes
-- et les rendus sont inchanges.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. LA TABLE
-- ---------------------------------------------------------------------------
create table if not exists public.autopilot_generation_slots (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,

  -- La cle de creneau telle que l'application la calcule deja :
  -- `<userId>|<date>|<heure>`. Elle n'est PAS recalculee ici — ce lot
  -- verrouille la cle existante, il ne la redefinit pas.
  slot_key    text not null check (length(btrim(slot_key)) between 1 and 200),

  -- Trois etats, et pas un de plus. Le travail M3 porte deja ses propres
  -- statuts detailles ; ce verrou est une couche de CONCURRENCE, pas une
  -- seconde file d'attente.
  statut      text not null default 'en_cours'
                check (statut in ('en_cours', 'terminee', 'echouee')),

  -- ⚠️ LE JETON EST CE QUI DONNE LE DROIT DE CONCLURE. Sans lui, un worker
  -- dont le bail a expire pourrait marquer « terminee » une generation reprise
  -- entre-temps par un autre — et le second travail disparaitrait sans trace.
  jeton       text not null check (length(jeton) between 16 and 128),

  reclame_le      timestamptz not null default now(),
  maj_le          timestamptz not null default now(),
  -- Au-dela, le creneau est reprenable : un processus tue par un
  -- redeploiement n'execute aucun `finally`, et sans bail son creneau
  -- resterait bloque pour toujours.
  bail_expire_le  timestamptz not null,
  termine_le      timestamptz,

  -- De quoi relier le creneau a ce qu'il a produit, sans dupliquer le travail.
  rendu_id        uuid,
  -- Motif ferme, ecrit par l'application. Jamais un message de fournisseur.
  motif_echec     text check (motif_echec is null or length(motif_echec) <= 64)
);

-- ⚠️ C'EST CET INDEX QUI EST LE VERROU. Le reste n'est que confort : sans
-- unicite, `on conflict` n'aurait rien sur quoi se declencher et deux
-- reclamations simultanees inserereraient deux lignes.
create unique index if not exists autopilot_generation_slots_unique
  on public.autopilot_generation_slots (user_id, slot_key);

-- La seule lecture de service : les creneaux d'une personne, recents d'abord.
create index if not exists autopilot_generation_slots_user_idx
  on public.autopilot_generation_slots (user_id, reclame_le desc);

-- ---------------------------------------------------------------------------
-- 2. LA RECLAMATION, EN UNE SEULE INSTRUCTION
--
-- ⚠️ AUCUN `SELECT` PUIS `INSERT`. Entre les deux, un autre worker passe.
-- C'est PostgreSQL qui tranche, dans la meme instruction :
--
--   * le creneau n'existe pas          -> insere, et rend `reclame` ;
--   * il existe, echoue OU bail expire -> repris, et rend `reclame` ;
--   * il existe, tenu, bail valide     -> aucune ligne : `deja_tenu` ;
--   * il existe, terminee              -> aucune ligne : `deja_terminee`.
--
-- Les deux derniers cas se distinguent par une lecture QUI SUIT la decision
-- atomique. Elle ne peut donc pas la fausser : on sait deja qu'on n'a pas eu
-- le creneau, on cherche seulement le mot juste pour le dire.
-- ---------------------------------------------------------------------------
create or replace function public.reclamer_creneau_autopilote(
  p_user_id       uuid,
  p_slot_key      text,
  p_jeton         text,
  p_bail_secondes integer
) returns table (issue text, jeton text, rendu_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ligne public.autopilot_generation_slots%rowtype;
  v_existante public.autopilot_generation_slots%rowtype;
begin
  if p_user_id is null or coalesce(btrim(p_slot_key), '') = '' then
    return query select 'parametres_invalides'::text, null::text, null::uuid;
    return;
  end if;
  -- Un jeton court serait devinable, et le droit de conclure avec.
  if coalesce(length(p_jeton), 0) < 16 then
    return query select 'parametres_invalides'::text, null::text, null::uuid;
    return;
  end if;
  -- Un bail nul rendrait tout creneau immediatement reprenable : le verrou
  -- existerait sans rien verrouiller.
  if coalesce(p_bail_secondes, 0) <= 0 or p_bail_secondes > 86400 then
    return query select 'parametres_invalides'::text, null::text, null::uuid;
    return;
  end if;

  insert into public.autopilot_generation_slots as s
    (user_id, slot_key, statut, jeton, reclame_le, maj_le, bail_expire_le)
  values
    (p_user_id, btrim(p_slot_key), 'en_cours', p_jeton, now(), now(),
     now() + make_interval(secs => p_bail_secondes))
  on conflict (user_id, slot_key) do update
    set statut         = 'en_cours',
        jeton          = excluded.jeton,
        reclame_le     = now(),
        maj_le         = now(),
        bail_expire_le = excluded.bail_expire_le,
        termine_le     = null,
        motif_echec    = null
    where s.statut = 'echouee'
       or (s.statut = 'en_cours' and s.bail_expire_le < now())
  returning * into v_ligne;

  if found then
    return query select 'reclame'::text, v_ligne.jeton, v_ligne.rendu_id;
    return;
  end if;

  select * into v_existante from public.autopilot_generation_slots
   where user_id = p_user_id and slot_key = btrim(p_slot_key);

  if not found then
    -- Inatteignable en pratique : l'insertion a echoue sur un conflit, donc
    -- la ligne existe. La ceinture reste, car un `null` silencieux ici
    -- ressemblerait a une reclamation reussie du cote appelant.
    return query select 'indisponible'::text, null::text, null::uuid;
    return;
  end if;

  if v_existante.statut = 'terminee' then
    return query select 'deja_terminee'::text, null::text, v_existante.rendu_id;
  else
    return query select 'deja_tenu'::text, null::text, v_existante.rendu_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. CONCLURE — reserve au porteur du jeton
-- ---------------------------------------------------------------------------
create or replace function public.conclure_creneau_autopilote(
  p_user_id     uuid,
  p_slot_key    text,
  p_jeton       text,
  p_statut      text,
  p_rendu_id    uuid,
  p_motif_echec text
) returns table (issue text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_maj integer;
begin
  if p_statut not in ('terminee', 'echouee') then
    return query select 'parametres_invalides'::text;
    return;
  end if;

  -- ⚠️ LE JETON EST DANS LE `WHERE`, PAS DANS UN `IF`. Un worker dont le bail
  -- a expire, et dont le creneau a ete repris, ne doit pas pouvoir conclure
  -- le travail d'un autre : la condition est evaluee par la base, en meme
  -- temps que l'ecriture.
  update public.autopilot_generation_slots
     set statut      = p_statut,
         maj_le      = now(),
         termine_le  = now(),
         rendu_id    = coalesce(p_rendu_id, rendu_id),
         motif_echec = case when p_statut = 'echouee' then p_motif_echec else null end
   where user_id = p_user_id
     and slot_key = btrim(p_slot_key)
     and jeton = p_jeton;

  get diagnostics v_maj = row_count;
  return query select case when v_maj > 0 then 'conclu' else 'jeton_perime' end::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. DROITS
--
-- Ces fonctions et cette table appartiennent au cycle automatique, qui tourne
-- avec le role de service. Le navigateur n'a AUCUN besoin de les lire : un
-- creneau de generation n'est pas une information d'ecran, et l'exposer
-- offrirait a l'API anonyme de quoi reclamer ou conclure des creneaux.
-- ---------------------------------------------------------------------------
revoke all on table public.autopilot_generation_slots from public;
revoke all on function
  public.reclamer_creneau_autopilote(uuid, text, text, integer) from public;
revoke all on function
  public.conclure_creneau_autopilote(uuid, text, text, text, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- 5. APRES APPLICATION — recharger le cache de schema de PostgREST
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- Sans cela les fonctions existent en base mais restent invisibles de l'API,
-- et le code les croit absentes — il retombera alors sur son repli, qui
-- refuse de produire plutot que de produire en double.
--
-- CONTROLES (lecture seule) :
--   select proname from pg_proc where proname like '%creneau_autopilote';
--   select indexname from pg_indexes
--    where tablename = 'autopilot_generation_slots';
--   select has_table_privilege('public','public.autopilot_generation_slots','SELECT');
--     -- attendu : false
-- ---------------------------------------------------------------------------
