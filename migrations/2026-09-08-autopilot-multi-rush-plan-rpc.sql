-- ---------------------------------------------------------------------------
-- A_7B0 — CREER UN PLAN MULTI-RUSH ET SES SOURCES EN UNE SEULE TRANSACTION
-- ---------------------------------------------------------------------------
--
-- ⚠️ CE QUI MANQUAIT, EXACTEMENT
--
-- A_7a a ouvert le contrat source-aware et pose deux helpers de persistance.
-- Ils ecrivent en DEUX appels PostgREST :
--
--   1.  insert into rush_montage_plans      (creerPlan)
--   2.  insert into rush_montage_plan_sources[]  (ecrireSourcesPlan)
--
-- Pris separement, chacun est atomique. Ensemble, ils ne le sont pas : entre
-- les deux, le processus peut mourir, le reseau tomber, la base refuser. Il
-- resterait alors un plan multi-rush SANS AUCUNE SOURCE — c'est-a-dire une
-- ligne qui porte une `source_set_fingerprint` decrivant une matiere que la
-- base ne contient plus. L'empreinte cesse de correspondre aux lignes
-- survivantes, ce qui est precisement le signal d'amputation qu'A_7M avait
-- concu pour detecter la PERTE d'une source. Un plan ne serait pas seulement
-- incomplet : il serait indiscernable d'un plan corrompu.
--
-- Tant qu'aucun plan multi-rush n'est cree, le probleme est theorique. A_7b
-- en creera. Cette migration ferme la porte AVANT.
--
-- ---------------------------------------------------------------------------
-- ⚠️ CE QUE CETTE MIGRATION NE FAIT PAS
-- ---------------------------------------------------------------------------
--
--   • elle ne cree, n'efface et ne modifie AUCUNE table, AUCUNE colonne,
--     AUCUN index, AUCUNE contrainte. Elle ajoute UNE fonction, et rien
--     d'autre ;
--   • elle ne touche pas la politique de suppression d'A_7M2 : les lignes
--     qu'elle ecrit tombent sous les memes cles etrangeres, avec le meme
--     `no action deferrable initially deferred` ;
--   • elle ne decide RIEN de creatif. Ni quel rush, ni quel clip, ni quel
--     ordre, ni quelle duree. Elle recoit un plan DEJA calcule par le serveur
--     et se contente de le poser sans qu'il puisse arriver a moitie ;
--   • elle ne recalcule pas l'empreinte. Voir le point 2.
--
-- ---------------------------------------------------------------------------
-- 1. LE CHEMIN MONO-RUSH N'EST PAS TOUCHE
-- ---------------------------------------------------------------------------
--
-- ⚠️ ET C'EST DELIBERE. Faire passer AUSSI les plans a une seule source par
-- cette fonction aurait l'air d'une simplification ; ce serait un changement
-- de comportement pour la totalite du parc. Un plan mono-rush laisse
-- `source_set_fingerprint` a NULL, vit sous `rush_montage_plans_identite_
-- unique`, et son numero de version se compte par jeu de clips. Le faire
-- entrer ici lui donnerait une empreinte, donc l'autre index, donc une autre
-- identite — et ses MP4 deja rendus deviendraient introuvables.
--
-- `creerPlan` reste donc le chemin des plans a une source, inchange. Cette
-- fonction REFUSE d'ailleurs les appels a moins de deux sources, pour que le
-- jour ou quelqu'un serait tente d'unifier les deux chemins, la base le lui
-- dise plutot que de le laisser faire.
--
-- ---------------------------------------------------------------------------
-- 2. L'EMPREINTE EST CALCULEE PAR LE SERVEUR, PAS ICI
-- ---------------------------------------------------------------------------
--
-- ⚠️ UNE SEULE VERITE, ET ELLE EST EN TYPESCRIPT.
--
-- `empreinteJeuxSources` (A_7a) canonicalise les sources ordonnees puis les
-- hache en SHA-256 tronque. Reimplementer cette canonicalisation en PL/pgSQL
-- donnerait DEUX algorithmes qui doivent rester d'accord pour toujours : le
-- jour ou l'un des deux change un separateur, deux plans identiques recoivent
-- deux empreintes, l'index d'unicite cesse de les rapprocher, et le meme
-- montage est recalcule et refacture indefiniment. Le bug serait silencieux.
--
-- La fonction recoit donc l'empreinte deja calculee, et ne verifie que ce
-- qu'elle PEUT verifier sans la recalculer : qu'elle est presente, de la
-- bonne forme, et accompagnee d'au moins deux sources. Le lien entre la
-- valeur et les sources est tenu par le service TypeScript, qui les derive
-- des memes lignes.
--
-- ---------------------------------------------------------------------------
-- 3. LES SCALAIRES HISTORIQUES RESTENT NULS
-- ---------------------------------------------------------------------------
--
-- `clip_set_id`, `clip_set_version`, `candidate_set_id`, `analysis_id` : NULL,
-- comme A_7M l'a decide et pour la meme raison. Y mettre la premiere source
-- ferait parler une colonne d'identite au nom de toutes les autres ; le jour
-- ou quelqu'un s'y fierait pour retrouver la transcription d'un segment, il
-- lirait le mauvais rush sans que rien ne le signale.
--
-- Consequence voulue : la cle etrangere composite historique
-- `rush_montage_plans_jeu_proprietaire`, en `match simple`, ne verifie pas une
-- cle dont une colonne est nulle. La propriete des plans multi-rush est donc
-- etablie AILLEURS — par `rush_montage_plan_sources_jeu_proprietaire`, sur
-- chaque source, et par le controle explicite ci-dessous qui rend un message
-- utilisable plutot qu'un code SQL brut.
-- ---------------------------------------------------------------------------

create or replace function public.creer_plan_montage_multi_rush(
  p_user_id                 uuid,
  p_sources                 jsonb,
  p_source_set_fingerprint  text,
  p_algorithme              text,
  p_methode_materialisation text,
  p_algorithme_plan         text,
  p_format                  text,
  p_duree_cible_secondes    numeric,
  p_largeur_cible           integer,
  p_hauteur_cible           integer,
  p_fps                     integer,
  p_plans                   jsonb,
  p_duree_totale_secondes   numeric,
  p_ecart_secondes          numeric,
  p_clips_ecartes           integer,
  p_usage                   jsonb
) returns table (issue text, plan_id uuid, cree boolean)
language plpgsql
-- ⚠️ `security definer`, COMME LES QUATRE RPC AUTOPILOTE DEJA EN PLACE. Les
-- tables `rush_*` n'ont recu aucun `grant` : elles appartiennent au role qui
-- a joue les migrations, et le role de service passe par ces fonctions. Sans
-- `definer`, la fonction s'executerait sous un role sans droit de lecture sur
-- `rush_clip_sets` et le controle de propriete ne pourrait pas avoir lieu.
security definer
-- ⚠️ `search_path` FIXE. Une fonction `definer` dont le chemin de recherche
-- vient de l'appelant peut etre detournee : il suffit de creer un schema en
-- tete de chemin contenant une table `rush_clip_sets` complaisante. `pg_temp`
-- est mis EN DERNIER, jamais en premier, pour la meme raison.
set search_path = public, pg_temp
as $$
declare
  v_nb          integer;
  v_conformes   integer;
  v_distinctes  integer;
  v_possedees   integer;
  v_plan_id     uuid;
  v_version     integer;
begin
  -- -------------------------------------------------------------------------
  -- Les parametres, avant toute ecriture
  --
  -- ⚠️ AUCUN `raise` POUR UN REFUS ATTENDU. Une exception remonterait a
  -- l'appelant comme une panne, et le produit ne saurait pas distinguer « ces
  -- sources ne t'appartiennent pas » d'une base injoignable. Les refus sont
  -- des VALEURS ; seules les vraies pannes restent des exceptions.
  -- -------------------------------------------------------------------------
  if p_user_id is null then
    return query select 'parametres_invalides'::text, null::uuid, false; return;
  end if;

  -- L'empreinte est opaque ici : on ne peut ni la recalculer, ni la
  -- contredire. Ce qui reste verifiable, c'est sa FORME — presente, de la
  -- longueur admise par la colonne, et hexadecimale comme le SHA-256 tronque
  -- qui la produit. Un appelant qui passerait autre chose se trompe de
  -- fonction, et l'apprend ici plutot qu'a la lecture d'un index.
  if p_source_set_fingerprint is null
     or length(p_source_set_fingerprint) < 8
     or length(p_source_set_fingerprint) > 128
     or p_source_set_fingerprint !~ '^[0-9a-f]+$' then
    return query select 'empreinte_invalide'::text, null::uuid, false; return;
  end if;

  if p_sources is null or jsonb_typeof(p_sources) <> 'array' then
    return query select 'parametres_invalides'::text, null::uuid, false; return;
  end if;

  select count(*) into v_nb from jsonb_array_elements(p_sources);

  -- ⚠️ DEUX SOURCES AU MINIMUM — voir le point 1 de l'en-tete. Un plan a une
  -- seule source appartient au chemin historique, et l'y laisser n'est pas
  -- une omission : c'est ce qui protege les rendus deja produits.
  if v_nb < 2 then
    return query select 'sources_insuffisantes'::text, null::uuid, false; return;
  end if;

  -- ⚠️ 64, PARCE QUE `ordinal` S'ARRETE A 63. La borne n'est pas une politique
  -- produit — celle-la vivra dans le serveur, ou elle pourra evoluer — mais la
  -- limite mecanique de la colonne posee par A_7M. La verifier ici rend un
  -- refus lisible la ou la contrainte aurait rendu un `check` viole.
  if v_nb > 64 then
    return query select 'sources_trop_nombreuses'::text, null::uuid, false; return;
  end if;

  -- ⚠️ LA FORME DE CHAQUE SOURCE AVANT TOUT CAST. `(e->>'clip_set_id')::uuid`
  -- sur une chaine malformee leve `invalid_text_representation` — une panne,
  -- alors qu'il s'agit d'un appel mal forme. On mesure donc la conformite par
  -- expression reguliere, puis on caste en sachant que cela ne peut plus
  -- echouer.
  select count(*) into v_conformes
    from jsonb_array_elements(p_sources) e
   where jsonb_typeof(e) = 'object'
     and e->>'clip_set_id' ~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and e->>'clip_set_version' ~ '^[0-9]+$'
     and (e->>'clip_set_version')::integer >= 1;

  if v_conformes <> v_nb then
    return query select 'parametres_invalides'::text, null::uuid, false; return;
  end if;

  -- ⚠️ UN JEU DE CLIPS N'APPARAIT QU'UNE FOIS DANS LA LISTE DES SOURCES.
  -- Reutiliser plusieurs passages du meme rush est le cas NORMAL, et cela
  -- s'ecrit par plusieurs SEGMENTS pointant la meme source — jamais par deux
  -- lignes de source identiques. La contrainte `rush_montage_plan_sources_
  -- jeu_unique` le refuserait de toute facon ; le dire ici evite d'avoir a
  -- traduire un `23505` en diagnostic.
  select count(distinct e->>'clip_set_id') into v_distinctes
    from jsonb_array_elements(p_sources) e;

  if v_distinctes <> v_nb then
    return query select 'source_dupliquee'::text, null::uuid, false; return;
  end if;

  -- -------------------------------------------------------------------------
  -- La propriete, et la version reelle du jeu
  --
  -- ⚠️ LA CLE ETRANGERE RESTE L'AUTORITE. `rush_montage_plan_sources_jeu_
  -- proprietaire` etablit deja que le jeu existe ET appartient a cet
  -- utilisateur ; ce controle ne la remplace pas, il la double pour rendre un
  -- refus nomme au lieu d'un `23503`.
  --
  -- ⚠️ MAIS IL VERIFIE AUSSI CE QU'AUCUNE CLE NE PEUT VERIFIER : que
  -- `clip_set_version` correspond a la version REELLE du jeu. La cle porte
  -- sur `(id, user_id)` ; rien n'empeche d'annoncer la v2 d'un jeu qui en est
  -- a la v5. L'empreinte serait alors calculee sur une version qui n'existe
  -- pas, et le plan reclamerait des octets introuvables au rendu.
  -- -------------------------------------------------------------------------
  select count(*) into v_possedees
    from jsonb_array_elements(p_sources) e
    join public.rush_clip_sets c
      on c.id = (e->>'clip_set_id')::uuid
     and c.user_id = p_user_id
     and c.version = (e->>'clip_set_version')::integer;

  if v_possedees <> v_nb then
    return query select 'source_inconnue'::text, null::uuid, false; return;
  end if;

  -- -------------------------------------------------------------------------
  -- Ce plan a-t-il deja ete calcule ?
  --
  -- ⚠️ CETTE LECTURE NE PROTEGE RIEN — et c'est assume. Deux appels
  -- concurrents la passent tous les deux avant qu'aucun n'ait ecrit. C'est
  -- l'index `rush_montage_plans_identite_sources_unique` qui tranche, et lui
  -- seul ; le bloc d'ecriture plus bas traduit son refus en relecture. Cette
  -- lecture-ci evite seulement de payer une insertion vouee a echouer dans le
  -- cas courant.
  --
  -- ⚠️ FILTREE PAR PROPRIETAIRE. L'index d'unicite d'A_7M ne porte pas
  -- `user_id` — il n'en a pas besoin, une empreinte derivant d'identifiants de
  -- jeux deja lies a un compte. Rendre ici un identifiant sans filtrer serait
  -- neanmoins divulguer le plan d'autrui sur une collision.
  -- -------------------------------------------------------------------------
  select p.id into v_plan_id
    from public.rush_montage_plans p
   where p.user_id = p_user_id
     and p.source_set_fingerprint = p_source_set_fingerprint
     and p.algorithme = p_algorithme
     and p.methode_materialisation = p_methode_materialisation
     and p.algorithme_plan = p_algorithme_plan
     and p.format = p_format
     and p.duree_cible_secondes = p_duree_cible_secondes
   limit 1;

  if v_plan_id is not null then
    return query select 'existant'::text, v_plan_id, false; return;
  end if;

  -- -------------------------------------------------------------------------
  -- L'ECRITURE — plan et sources, indivisibles
  --
  -- ⚠️ C'EST TOUT L'OBJET DE CE LOT. Un bloc `begin ... exception` de PL/pgSQL
  -- ouvre une SOUS-TRANSACTION : si l'insertion des sources echoue, celle du
  -- plan est defaite avec elle. Et une exception non capturee — cle etrangere
  -- violee, `check` refuse — abandonne l'instruction entiere, donc l'appel
  -- RPC entier. Dans les deux cas, la base ne garde RIEN. Il n'existe aucun
  -- chemin par lequel un plan multi-rush puisse exister avec une partie
  -- seulement de ses sources.
  --
  -- ⚠️ AUCUN `commit`, AUCUN `rollback` EXPLICITE. La fonction s'execute dans
  -- la transaction de l'appelant ; en prendre le controle briserait justement
  -- la garantie recherchee.
  -- -------------------------------------------------------------------------
  begin
    -- ⚠️ LA VERSION SE COMPTE PAR EMPREINTE, PAS PAR JEU DE CLIPS. Le chemin
    -- mono-rush compte par `clip_set_id` ; un plan multi-rush l'a a NULL, et
    -- `max()` sur une colonne nulle rendrait toujours 1. L'empreinte est le
    -- pendant exact de `clip_set_id` pour ces plans, donc le bon axe.
    select coalesce(max(p.version), 0) + 1 into v_version
      from public.rush_montage_plans p
     where p.user_id = p_user_id
       and p.source_set_fingerprint = p_source_set_fingerprint;

    insert into public.rush_montage_plans (
      user_id, clip_set_id, clip_set_version, candidate_set_id, analysis_id,
      algorithme, methode_materialisation, algorithme_plan, format,
      duree_cible_secondes, version, largeur_cible, hauteur_cible, fps,
      plans, duree_totale_secondes, ecart_secondes, clips_ecartes, usage,
      source_set_fingerprint
    ) values (
      p_user_id, null, null, null, null,
      p_algorithme, p_methode_materialisation, p_algorithme_plan, p_format,
      p_duree_cible_secondes, v_version, p_largeur_cible, p_hauteur_cible, p_fps,
      coalesce(p_plans, '[]'::jsonb), coalesce(p_duree_totale_secondes, 0),
      coalesce(p_ecart_secondes, 0), coalesce(p_clips_ecartes, 0),
      coalesce(p_usage, '{}'::jsonb),
      p_source_set_fingerprint
    ) returning id into v_plan_id;

    -- ⚠️ `with ordinality` DONNE L'ORDRE, ET L'ORDRE EST L'IDENTITE. C'est lui
    -- qui distingue `A,B,C` de `B,A,C` : l'empreinte est calculee sur cette
    -- suite, et deux montages employant la meme matiere dans un autre ordre ne
    -- sont pas le meme film. Les indices de `jsonb_array_elements` commencent
    -- a 1, la colonne `ordinal` a 0.
    insert into public.rush_montage_plan_sources
      (plan_id, user_id, ordinal, clip_set_id, clip_set_version)
    select v_plan_id, p_user_id, (t.rang - 1)::integer,
           (t.e->>'clip_set_id')::uuid,
           (t.e->>'clip_set_version')::integer
      from jsonb_array_elements(p_sources) with ordinality as t(e, rang);

  exception
    -- ⚠️ UN DOUBLON N'EST PAS UNE PANNE. Deux workers qui calculent le meme
    -- montage au meme instant sont le fonctionnement NORMAL de l'autopilote :
    -- l'un ecrit, l'autre se voit refuser par l'index, et doit repartir avec
    -- le plan du premier. Renvoyer `23505` au produit ferait echouer une
    -- generation qui a pourtant abouti.
    when unique_violation then
      select p.id into v_plan_id
        from public.rush_montage_plans p
       where p.user_id = p_user_id
         and p.source_set_fingerprint = p_source_set_fingerprint
         and p.algorithme = p_algorithme
         and p.methode_materialisation = p_methode_materialisation
         and p.algorithme_plan = p_algorithme_plan
         and p.format = p_format
         and p.duree_cible_secondes = p_duree_cible_secondes
       limit 1;

      -- ⚠️ RIEN A RELIRE : le refus ne vient donc pas d'un concurrent portant
      -- la meme identite. Une collision d'empreinte entre deux comptes, ou une
      -- source deja posee, laisserait ce cas. Le nommer vaut mieux que rendre
      -- un `null` que l'appelant prendrait pour une reussite.
      if v_plan_id is null then
        return query select 'identite_conflictuelle'::text, null::uuid, false;
        return;
      end if;

      return query select 'existant'::text, v_plan_id, false;
      return;
  end;

  return query select 'cree'::text, v_plan_id, true;
end;
$$;

comment on function public.creer_plan_montage_multi_rush(
  uuid, jsonb, text, text, text, text, text, numeric, integer, integer,
  integer, jsonb, numeric, numeric, integer, jsonb) is
  'A_7B0 — cree un plan de montage MULTI-RUSH et ses sources ordonnees dans '
  'UNE seule transaction. Refuse moins de deux sources : le mono-rush garde '
  'son chemin historique. N''evalue rien de creatif.';

-- ---------------------------------------------------------------------------
-- 4. DROITS
--
-- Meme regle que pour les creneaux d'A_0c : cette fonction appartient au
-- cycle serveur, qui tourne avec le role de service. Le navigateur n'a aucun
-- besoin de creer un plan de montage — le lui ouvrir donnerait au role anonyme
-- de PostgREST de quoi ecrire des lignes sous n'importe quel `user_id`, la
-- fonction etant `security definer`.
--
-- Aucun `grant` n'est pose : le proprietaire des objets n'en a pas besoin, et
-- en ouvrir un ici contredirait le choix d'A_7M de ne rien exposer.
-- ---------------------------------------------------------------------------
revoke all on function public.creer_plan_montage_multi_rush(
  uuid, jsonb, text, text, text, text, text, numeric, integer, integer,
  integer, jsonb, numeric, numeric, integer, jsonb) from public;

-- ---------------------------------------------------------------------------
-- 5. APRES APPLICATION
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- PostgREST ne relit son cache de schema qu'au demarrage : sans ce signal, la
-- fonction existe en base et reste invisible de l'API.
-- ---------------------------------------------------------------------------
