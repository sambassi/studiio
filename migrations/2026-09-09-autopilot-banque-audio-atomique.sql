-- Autopilote — MUTATIONS ATOMIQUES DE LA BANQUE AUDIO.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LE DEFAUT QUE CES FONCTIONS CORRIGENT
-- ─────────────────────────────────────────────────────────────────────────
--
-- `autopilot_design_style_merge` (2026-09-06) fusionne `design_style` avec un
-- patch, et `||` fusionne AU PREMIER NIVEAU. C'est la bonne granularite pour
-- des reglages independants — « le montage », « l'audio », « le profil » —
-- mais elle ne protege PAS une LISTE que l'on rallonge.
--
-- Ajouter une piste se faisait ainsi : lire la bibliotheque, calculer
-- `[...pistes, nouvelle]` en JavaScript, renvoyer la cle `bibliothequeCreative`
-- entiere. Deux ajouts qui se croisent lisent tous deux N pistes, ecrivent
-- tous deux N+1, et le second efface le premier. La fusion atomique s'applique
-- fidelement — a une valeur deja perimee.
--
-- ⚠️ CE N'EST PAS UNE COURSE DE LABORATOIRE. Elle a ete observee sur trois
-- fichiers deposes en une seule selection : le televersement en lance deux de
-- front (`CONCURRENCE_IMPORT_MEDIA = 2`), les deux `POST` ont repondu 200, et
-- une seule des deux pistes est restee. L'ecran annoncait « 3 / 3 importees »
-- au-dessus d'une banque qui n'en portait que deux.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POURQUOI LA LECTURE DOIT AVOIR LIEU ICI, ET NON DANS L'APPLICATION
-- ─────────────────────────────────────────────────────────────────────────
--
-- La seule facon de rallonger une liste sans perdre une ecriture voisine est
-- de la RELIRE au moment ou on l'ecrit, sous verrou. `select … for update`
-- dans le corps de la fonction fait exactement cela : la seconde transaction
-- attend la premiere, puis lit la liste TELLE QU'ELLE EST DEVENUE. Aucune
-- fenetre ne subsiste entre la lecture et l'ecriture, et la garantie tient
-- entre processus, entre instances et apres redemarrage — ce qu'un verrou en
-- memoire Node ne sait pas faire.
--
-- ─────────────────────────────────────────────────────────────────────────
-- CE QUI RESTE DANS L'APPLICATION, ET POURQUOI
-- ─────────────────────────────────────────────────────────────────────────
--
-- Ces fonctions ne savent RIEN d'un fichier audio : ni le sonder, ni mesurer
-- son blanc, ni dessiner sa forme d'onde, ni juger ses `moods`. Tout cela
-- reste en TypeScript, ou il n'en existe qu'une version. Elles ne tiennent
-- que la comptabilite de la liste — appartenance, doublon, capacite — qui est
-- precisement ce qui ne peut PAS se decider hors de la transaction.
--
-- C'est la meme frontiere que `creer_plan_montage_multi_rush` (A_7B0) : la
-- canonicalisation reste en TypeScript, l'atomicite descend dans le moteur.

-- ═══════════════════════════════════════════════════════════════════════════
-- AJOUTER — OU METTRE A JOUR — UNE PISTE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `issue` vaut :
--   `creee`     la piste n'existait pas, elle a ete ajoutee
--   `existante` la cle etait deja la, sa fiche a ete remplacee
--   `pleine`    la banque est a `p_max`, rien n'a ete ecrit
--   `argument_invalide` compte ou cle manquants, rien n'a ete ecrit
--
-- `pistes` est la liste APRES mutation : l'appelant n'a pas a relire pour
-- savoir ce qui est reellement persiste — une relecture separee rouvrirait
-- exactement la fenetre que cette fonction ferme.
create or replace function public.autopilot_banque_audio_ajouter(
  p_user_id uuid,
  p_piste   jsonb,
  p_max     integer
) returns table(issue text, pistes jsonb)
language plpgsql
-- ⚠️ `security definer`, COMME LES RPC AUTOPILOTE DEJA EN PLACE : la fonction
-- travaille sur `autopilot_config` au nom de son proprietaire, et le compte
-- n'est jamais celui que le navigateur pretend — la route le tient de la
-- session serveur.
security definer
set search_path = public, pg_temp
as $$
declare
  v_cle    text := p_piste->>'cle';
  v_style  jsonb;
  v_biblio jsonb;
  v_audio  jsonb;
  v_pistes jsonb;
  v_piste  jsonb;
  v_rang   integer;
  v_max    integer := greatest(coalesce(p_max, 0), 0);
begin
  if p_user_id is null or v_cle is null or v_cle = '' then
    issue := 'argument_invalide';
    pistes := null;
    return next;
    return;
  end if;

  -- La ligne doit exister pour etre verrouillee. `do nothing` plutot que
  -- `do update` : un compte qui a deja sa configuration ne doit rien perdre.
  insert into public.autopilot_config (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  -- ⚠️ LE VERROU EST LA GARANTIE. Sans `for update`, deux appels liraient la
  -- meme liste et le second effacerait le premier — le defaut meme que cette
  -- migration corrige.
  select coalesce(design_style, '{}'::jsonb)
    into v_style
    from public.autopilot_config
   where user_id = p_user_id
     for update;

  v_biblio := coalesce(v_style->'bibliothequeCreative', '{}'::jsonb);
  v_audio  := coalesce(v_biblio->'audio', '{}'::jsonb);
  v_pistes := coalesce(v_audio->'pistes', '[]'::jsonb);
  if jsonb_typeof(v_pistes) <> 'array' then v_pistes := '[]'::jsonb; end if;

  select i - 1
    into v_rang
    from generate_series(1, jsonb_array_length(v_pistes)) as i
   where v_pistes->(i - 1)->>'cle' = v_cle
   limit 1;

  v_piste := p_piste;

  if v_rang is not null then
    -- ⚠️ LA DATE DE CONFIRMATION DES DROITS NE SE REECRIT PAS. Elle atteste
    -- une declaration faite un jour donne ; la remplacer par « aujourd'hui » a
    -- chaque nouvelle sonde effacerait la seule trace de cette declaration.
    if v_pistes->v_rang ? 'droitsConfirmesLe' then
      v_piste := jsonb_set(
        v_piste, '{droitsConfirmesLe}', v_pistes->v_rang->'droitsConfirmesLe', true);
    end if;
    v_pistes := jsonb_set(v_pistes, array[v_rang::text], v_piste);
    issue := 'existante';
  elsif jsonb_array_length(v_pistes) >= v_max then
    -- La capacite est verifiee ICI, sous le meme verrou que l'ajout : deux
    -- appels concurrents sur une banque a `p_max - 1` ne peuvent pas la faire
    -- passer a `p_max + 1`.
    issue := 'pleine';
    pistes := v_pistes;
    return next;
    return;
  else
    v_pistes := v_pistes || jsonb_build_array(v_piste);
    issue := 'creee';
  end if;

  v_audio  := jsonb_set(v_audio, '{pistes}', v_pistes, true);
  v_biblio := jsonb_set(v_biblio, '{audio}', v_audio, true);
  v_style  := jsonb_set(v_style, '{bibliothequeCreative}', v_biblio, true);

  update public.autopilot_config
     set design_style = v_style, updated_at = now()
   where user_id = p_user_id;

  pistes := v_pistes;
  return next;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- RENOMMER — OU RETIRER — UNE PISTE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Le meme verrou, pour la meme raison : un retrait qui se croise avec un ajout
-- reecrivait la liste entiere depuis une lecture perimee et faisait disparaitre
-- la piste que l'autre venait d'ajouter.
--
-- `issue` vaut `retiree`, `renommee`, `absente` ou `argument_invalide`.
create or replace function public.autopilot_banque_audio_muter(
  p_user_id uuid,
  p_cle     text,
  p_retirer boolean,
  p_nom     text,
  p_moods   jsonb
) returns table(issue text, pistes jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_style   jsonb;
  v_biblio  jsonb;
  v_audio   jsonb;
  v_pistes  jsonb;
  v_piste   jsonb;
  v_rang    integer;
  v_favoris jsonb;
  v_autom   jsonb;
  v_autoris jsonb;
begin
  if p_user_id is null or p_cle is null or p_cle = '' then
    issue := 'argument_invalide';
    pistes := null;
    return next;
    return;
  end if;

  select coalesce(design_style, '{}'::jsonb)
    into v_style
    from public.autopilot_config
   where user_id = p_user_id
     for update;

  if not found then
    issue := 'absente';
    pistes := '[]'::jsonb;
    return next;
    return;
  end if;

  v_biblio := coalesce(v_style->'bibliothequeCreative', '{}'::jsonb);
  v_audio  := coalesce(v_biblio->'audio', '{}'::jsonb);
  v_pistes := coalesce(v_audio->'pistes', '[]'::jsonb);
  if jsonb_typeof(v_pistes) <> 'array' then v_pistes := '[]'::jsonb; end if;

  select i - 1
    into v_rang
    from generate_series(1, jsonb_array_length(v_pistes)) as i
   where v_pistes->(i - 1)->>'cle' = p_cle
   limit 1;

  if v_rang is null then
    issue := 'absente';
    pistes := v_pistes;
    return next;
    return;
  end if;

  if coalesce(p_retirer, false) then
    v_pistes := (
      select coalesce(jsonb_agg(x), '[]'::jsonb)
        from jsonb_array_elements(v_pistes) as x
       where x->>'cle' is distinct from p_cle
    );

    -- ⚠️ RETIRER UNE PISTE LA RETIRE PARTOUT OU ELLE EST NOMMEE, ET DANS LA
    -- MEME TRANSACTION. Un favori ou une autorisation qui survivrait au retrait
    -- designerait une fiche disparue : carte vide a l'ecran, musique
    -- introuvable au choix de la bande-son. Le faire en deux ecritures
    -- laisserait un instant ou l'un des deux etats est vrai et l'autre non.
    v_favoris := coalesce(v_biblio->'favoris', '{}'::jsonb);
    v_favoris := jsonb_set(v_favoris, '{audio}', (
      select coalesce(jsonb_agg(x), '[]'::jsonb)
        from jsonb_array_elements(
          case when jsonb_typeof(v_favoris->'audio') = 'array'
               then v_favoris->'audio' else '[]'::jsonb end) as x
       where x #>> '{}' is distinct from p_cle
    ), true);
    v_biblio := jsonb_set(v_biblio, '{favoris}', v_favoris, true);

    v_autom   := coalesce(v_biblio->'automatisation', '{}'::jsonb);
    v_autoris := coalesce(v_autom->'autorises', '{}'::jsonb);
    v_autoris := jsonb_set(v_autoris, '{audio}', (
      select coalesce(jsonb_agg(x), '[]'::jsonb)
        from jsonb_array_elements(
          case when jsonb_typeof(v_autoris->'audio') = 'array'
               then v_autoris->'audio' else '[]'::jsonb end) as x
       where x #>> '{}' is distinct from p_cle
    ), true);
    v_autom  := jsonb_set(v_autom, '{autorises}', v_autoris, true);
    v_biblio := jsonb_set(v_biblio, '{automatisation}', v_autom, true);

    issue := 'retiree';
  else
    v_piste := v_pistes->v_rang;
    if p_nom is not null then
      v_piste := jsonb_set(v_piste, '{nom}', to_jsonb(p_nom), true);
    end if;
    if p_moods is not null then
      v_piste := jsonb_set(v_piste, '{moods}', p_moods, true);
    end if;
    v_pistes := jsonb_set(v_pistes, array[v_rang::text], v_piste);
    issue := 'renommee';
  end if;

  v_audio  := jsonb_set(v_audio, '{pistes}', v_pistes, true);
  v_biblio := jsonb_set(v_biblio, '{audio}', v_audio, true);
  v_style  := jsonb_set(v_style, '{bibliothequeCreative}', v_biblio, true);

  update public.autopilot_config
     set design_style = v_style, updated_at = now()
   where user_id = p_user_id;

  pistes := v_pistes;
  return next;
end;
$$;

-- Sans ce grant, PostgREST voit la fonction mais repond 404 : le role qu'il
-- utilise n'a aucun droit d'execution (cf. 2026-09-06).
grant execute on function public.autopilot_banque_audio_ajouter(uuid, jsonb, integer) to public;
grant execute on function public.autopilot_banque_audio_muter(uuid, text, boolean, text, jsonb) to public;

-- ─────────────────────────────────────────────────────────────────────────
-- ⚠️ APRES CETTE MIGRATION — ETAPE OBLIGATOIRE
--
--     docker kill -s SIGUSR1 studiio-postgrest
--
-- Cette commande ne redemarre PAS le conteneur : elle demande a PostgREST de
-- relire le schema. Sans elle, les fonctions restent invisibles et l'API
-- repond 404 (cf. CLAUDE.md).
--
-- ⚠️ TANT QU'ELLE N'EST PAS APPLIQUEE, LA BANQUE AUDIO REFUSE D'ECRIRE. C'est
-- deliberé, et c'est le meme choix que « Mon objectif » (`fusionnerDesignStyle
-- Strict`) : un ecran qui annonce « importee » au-dessus d'une piste qui vient
-- d'etre effacee par une ecriture voisine est PIRE qu'un refus lisible. Le
-- refus dit quoi faire ; la perte silencieuse ne dit rien.
-- ─────────────────────────────────────────────────────────────────────────
