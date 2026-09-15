-- ============================================================================
-- AVATAR-1A — LE SCHEMA DU CLONE VIDEO : consentement, versions, validation,
--             enrolement sans fournisseur, apercu
-- ============================================================================
--
-- Migration ADDITIVE et REJOUABLE, ecrite pour le schema de `main` tel qu'il
-- est (`2026-07-28-user-avatars.sql` + `2026-07-28-avatar-type.sql`). Aucune
-- colonne supprimee, aucun type change, aucune donnee perdue, aucune table
-- nouvelle. Elle prepare le socle Avatar (contrat, enrolement video,
-- validation, apercu reel) qui arrive dans les lots suivants ; seule, elle
-- n'a aucun effet visible : les routes actuelles ignorent les nouvelles
-- colonnes et continuent d'ecrire les anciennes.
--
-- ---------------------------------------------------------------------------
-- 1. CE QU'ELLE CORRIGE — L'HISTORIQUE S'EFFACAIT
-- ---------------------------------------------------------------------------
--
-- `avatar_generations.user_avatar_id` est `on delete cascade` : supprimer un
-- avatar — ou simplement le RECREER, ce que `/api/avatar/create` fait par un
-- `delete` prealable (create/route.ts:235) — emporte TOUTES les videos deja
-- produites. Des rendus payes, disparus sans un mot.
--
-- Une video existe independamment du modele qui l'a faite. Le lien devient
-- `on delete set null` ; `drop not null` sur la colonne en est la contrepartie
-- exacte et minimale, sans changement de type. C'est le seul `drop` de cette
-- migration : une CONTRAINTE, recreee dans la meme transaction implicite,
-- jamais une colonne ni une ligne.
--
-- ---------------------------------------------------------------------------
-- 2. CE QU'ELLE AJOUTE
-- ---------------------------------------------------------------------------
--
--   user_avatars        source_object_key   cle PRIVEE de la video/photo de
--                                           reference (namespace `avatar/`) ;
--                                           `source_url` reste pour le flux photo
--                       subject_type        'self' | 'third_party' — qui est
--                                           la personne visible
--                       consent_version     version du texte de consentement
--                       validated_at        la personne a REGARDE son clone et
--                                           l'a accepte ; NULL = jamais
--                       version             numero de version du modele (>= 1)
--                       deleted_at          suppression logique ; NULL = vivant
--                       provider_avatar_id  devient NULLABLE : une source de
--                                           reference et son consentement
--                                           peuvent exister AVANT qu'aucun
--                                           fournisseur ne soit sollicite.
--                                           Aucune valeur n'est inventee.
--   avatar_generations  avatar_version      la version du clone qui a produit
--                                           la video ; NULL sur l'existant
--                       intention           'normale' | 'apercu' — l'apercu de
--                                           validation n'est pas une video
--                                           livrable
--
-- ---------------------------------------------------------------------------
-- 3. LE REPORT NE DIT QUE CE QU'IL SAIT
-- ---------------------------------------------------------------------------
--
--   - `subject_type = 'self'` est report SEULEMENT la ou `consent_text`
--     certifie « etre la personne visible » — les deux seuls textes que le
--     produit ait jamais ecrits (create/route.ts, CONSENT_TEXT). Un texte
--     inconnu reste NULL plutot que d'etre affirme : sur une donnee
--     biometrique, une invention est une faute.
--   - `version = 1` sur l'existant : une ligne existante EST la premiere
--     version de son avatar.
--   - `validated_at` reste NULL partout : « pret » chez le fournisseur n'est
--     pas « regarde et accepte ».
--   - `avatar_version` des generations existantes reste NULL : rien ne dit
--     quelle version a produit une video passee.
--   - `provider_avatar_id` existant n'est jamais touche.
--
-- ---------------------------------------------------------------------------
-- 4. user_avatars
-- ---------------------------------------------------------------------------

alter table public.user_avatars
  add column if not exists source_object_key text;

alter table public.user_avatars
  add column if not exists subject_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'user_avatars_subject_type_check'
       and conrelid = 'public.user_avatars'::regclass
  ) then
    alter table public.user_avatars
      add constraint user_avatars_subject_type_check
      check (subject_type is null or subject_type in ('self', 'third_party'));
  end if;
end $$;

-- Report prudent : uniquement les lignes dont le consentement le dit.
update public.user_avatars
   set subject_type = 'self'
 where subject_type is null
   and consent_text ilike 'Je certifie %tre la personne visible%';

alter table public.user_avatars
  add column if not exists consent_version text;

alter table public.user_avatars
  add column if not exists validated_at timestamptz;

alter table public.user_avatars
  add column if not exists version integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'user_avatars_version_check'
       and conrelid = 'public.user_avatars'::regclass
  ) then
    alter table public.user_avatars
      add constraint user_avatars_version_check check (version >= 1);
  end if;
end $$;

alter table public.user_avatars
  add column if not exists deleted_at timestamptz;

-- Enrolement sans fournisseur : `provider_avatar_id` peut etre NULL. Le
-- `status` porte alors l'etat local ('source_ready'…) ; aucun identifiant
-- n'est fabrique pour satisfaire une contrainte.
alter table public.user_avatars
  alter column provider_avatar_id drop not null;

-- Les avatars VIVANTS d'un compte, dans l'ordre ou l'ecran les lit.
create index if not exists user_avatars_actifs_idx
  on public.user_avatars (user_id, created_at desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 5. avatar_generations
-- ---------------------------------------------------------------------------

alter table public.avatar_generations
  add column if not exists avatar_version integer;

-- La video survit a son avatar (§1).
alter table public.avatar_generations
  alter column user_avatar_id drop not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'avatar_generations_user_avatar_id_fkey'
       and conrelid = 'public.avatar_generations'::regclass
       and confdeltype = 'c'
  ) then
    alter table public.avatar_generations
      drop constraint avatar_generations_user_avatar_id_fkey;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'avatar_generations_user_avatar_id_fkey'
       and conrelid = 'public.avatar_generations'::regclass
  ) then
    alter table public.avatar_generations
      add constraint avatar_generations_user_avatar_id_fkey
      foreign key (user_avatar_id) references public.user_avatars(id)
      on delete set null;
  end if;
end $$;

-- L'intention : un apercu de validation n'est pas une video livrable.
alter table public.avatar_generations
  add column if not exists intention text not null default 'normale';

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

-- Un apercu juge UNE version : sans version, il ne prouve rien.
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

-- Un seul apercu VIVANT par (avatar, version) : deux clics simultanes ne
-- lancent pas deux generations payantes ; un apercu echoue laisse la place
-- au suivant.
create unique index if not exists avatar_generations_apercu_unique
  on public.avatar_generations (user_avatar_id, avatar_version)
  where intention = 'apercu' and status <> 'failed';

-- ---------------------------------------------------------------------------
-- 6. DROITS
-- ---------------------------------------------------------------------------
--
-- Aucun changement : les deux tables portent deja les droits poses par
-- `2026-07-28-user-avatars.sql`, et une colonne ajoutee en herite.
--
-- ---------------------------------------------------------------------------
-- 7. APRES APPLICATION
-- ---------------------------------------------------------------------------
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- PostgREST ne relit son cache de schema qu'au demarrage : sans cela, les
-- nouvelles colonnes restent invisibles de l'API.
