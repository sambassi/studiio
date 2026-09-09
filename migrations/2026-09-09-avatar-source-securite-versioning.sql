-- A_8b — LA SOURCE D'UN AVATAR DEVIENT PRIVEE, ET L'HISTORIQUE SURVIT.
--
-- Migration ADDITIVE. Aucune colonne supprimee, aucun type change, aucune
-- donnee perdue. Elle peut se rejouer sans effet.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 1. POURQUOI UNE CLE D'OBJET PLUTOT QU'UNE URL
-- ─────────────────────────────────────────────────────────────────────────
--
-- `user_avatars.source_url` porte aujourd'hui une URL PUBLIQUE PERMANENTE,
-- fabriquee par `getPublicUrl`. Le relais public sert tout objet d'un
-- compartiment autorise sans session : la photo — ou la video de 2 a 5
-- minutes — du visage de quelqu'un se trouve donc derriere un lien que
-- personne ne peut revoquer.
--
-- Une URL n'est pas une bonne verite canonique : elle melange l'objet et la
-- facon d'y acceder. `source_object_key` ne dit QUE l'objet ; la maniere de le
-- lire redevient une decision du serveur, prise a chaque requete, apres
-- verification du proprietaire.
--
-- ⚠️ ET SURTOUT : ON N'Y ECRIT JAMAIS UNE URL SIGNEE. Une URL signee est un
-- droit d'acces temporaire ; la ranger en base la rendrait permanente par
-- accident, et on aurait remplace une fuite par une autre.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 2. POURQUOI `source_url` N'EST PAS SUPPRIMEE
-- ─────────────────────────────────────────────────────────────────────────
--
-- Les lignes deja creees n'ont que cette colonne pour retrouver leur source.
-- La supprimer maintenant rendrait ces avatars aveugles. Elle reste donc, en
-- LECTURE HISTORIQUE SEULEMENT : plus aucune ecriture publique n'y atterrit.
-- Son retrait sera un lot a part, apres un report deterministe.

alter table public.user_avatars
  -- La cle de l'objet prive dans `media`. Nullable : les lignes historiques
  -- n'en ont pas, et deviner leur cle depuis une URL serait une reconstruction,
  -- pas une donnee.
  add column if not exists source_object_key text;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. QUI L'AVATAR REPRESENTE — ET POURQUOI 'self' EST HONNETE ICI
-- ─────────────────────────────────────────────────────────────────────────
--
-- A_8 est SELF ONLY : on ne cree un clone que de soi-meme. La colonne existe
-- pour que cette regle soit LISIBLE dans la donnee, et pour qu'un futur tiers
-- autorise ait sa place sans migration destructive.
--
-- ⚠️ LE REPORT SUR L'HISTORIQUE N'EST PAS UNE SUPPOSITION. `consent_text` est
-- `not null` depuis l'origine, et les deux seuls textes que le produit ait
-- jamais ecrits certifient l'un et l'autre que la personne EST le sujet :
--
--   « Je certifie etre la personne visible sur l'image […] »
--   « Je certifie etre la personne visible dans la video […] »
--
-- Toute ligne existante porte donc deja la preuve de 'self'. La condition
-- ci-dessous le verifie quand meme, ligne par ligne : si un texte inconnu
-- apparaissait, sa ligne resterait NULL plutot que d'etre affirmee.
alter table public.user_avatars
  add column if not exists subject_type text;

update public.user_avatars
   set subject_type = 'self'
 where subject_type is null
   and consent_text ilike 'Je certifie etre la personne%';

-- La version du texte de consentement accepte. Nullable pour l'historique :
-- ces lignes ont un TEXTE, pas un numero de version — inventer « v1 » leur
-- ferait dire quelque chose qu'elles n'ont jamais dit.
alter table public.user_avatars
  add column if not exists consent_version text;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. VALIDATION HUMAINE — RIEN N'EST VALIDE D'OFFICE
-- ─────────────────────────────────────────────────────────────────────────
--
-- Un avatar « pret » cote fournisseur n'est pas un avatar que son proprietaire
-- accepte de voir parler a sa place. `validated_at` reste NULL tant que
-- personne n'a regarde le resultat — y compris pour les lignes existantes.
alter table public.user_avatars
  add column if not exists validated_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. VERSION — POUR QUE REENTRAINER NE REECRIVE PAS LE PASSE
-- ─────────────────────────────────────────────────────────────────────────
--
-- Reentrainer un clone produit une AUTRE personne numerique : meme visage,
-- autre modele. Sans numero, une video d'il y a un mois et une video de demain
-- se reclameraient du meme avatar sans qu'on puisse les distinguer.
--
-- Defaut 1 : une ligne existante est, par construction, la premiere version de
-- son avatar. C'est le seul report certain de cette migration.
alter table public.user_avatars
  add column if not exists version integer not null default 1;

-- Suppression douce : la fiche part de l'ecran sans emporter l'historique.
-- A_8b n'ecrit pas encore cette colonne — elle attend son workflow.
alter table public.user_avatars
  add column if not exists deleted_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. CHAQUE VIDEO SE SOUVIENT DE LA VERSION QUI L'A FAITE
-- ─────────────────────────────────────────────────────────────────────────
--
-- ⚠️ NULLABLE, ET AUCUN REPORT. Les generations existantes ont ete produites
-- par l'avatar tel qu'il etait a ce moment-la — et rien en base ne dit lequel.
-- Ecrire « 1 » partout serait une affirmation inventee : si un avatar avait
-- deja ete refait, on attribuerait ses anciennes videos au nouveau modele.
-- NULL dit la verite : « on ne sait pas ».
alter table public.avatar_generations
  add column if not exists avatar_version integer;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. SUPPRIMER UN AVATAR NE DOIT PLUS EFFACER SES VIDEOS
-- ─────────────────────────────────────────────────────────────────────────
--
-- ⚠️ LE DEFAUT LE PLUS COUTEUX DU SCHEMA D'ORIGINE. La cle etrangere etait
-- `on delete cascade` : supprimer un avatar — ou simplement le RECREER, ce que
-- la route de creation fait par un `delete` prealable — emportait TOUTES les
-- videos deja produites. Des rendus payes, disparus sans un mot.
--
-- Une video existe independamment du modele qui l'a faite. Le lien devient
-- donc `set null` : la video reste, elle perd seulement son renvoi vers une
-- fiche disparue — et `avatar_version` garde ce qu'on savait d'elle.
--
-- `drop not null` est la contrepartie EXACTE et minimale de ce choix : sans
-- elle, `set null` ne peut pas s'appliquer. Aucun type ne change.
alter table public.avatar_generations
  alter column user_avatar_id drop not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'avatar_generations_user_avatar_id_fkey'
       and conrelid = 'public.avatar_generations'::regclass
  ) then
    alter table public.avatar_generations
      drop constraint avatar_generations_user_avatar_id_fkey;
  end if;
end $$;

alter table public.avatar_generations
  add constraint avatar_generations_user_avatar_id_fkey
  foreign key (user_avatar_id) references public.user_avatars(id)
  on delete set null;

-- Retrouver les avatars vivants d'un compte sans lire les supprimes.
create index if not exists user_avatars_actifs_idx
  on public.user_avatars (user_id, created_at desc)
  where deleted_at is null;

-- ─────────────────────────────────────────────────────────────────────────
-- DROITS POSTGREST
--
-- Sans droits, PostgREST n'inscrit pas la table dans son cache de schema et
-- repond « table not in schema cache » / 404.
-- ─────────────────────────────────────────────────────────────────────────
grant all on table public.user_avatars, public.avatar_generations to public;

-- ─────────────────────────────────────────────────────────────────────────
-- ⚠️ APRES CETTE MIGRATION — ETAPE OBLIGATOIRE
--
--     docker kill -s SIGUSR1 studiio-postgrest
--
-- Cette commande ne redemarre PAS le conteneur : elle demande a PostgREST de
-- relire le schema. Sans elle, les colonnes ajoutees restent invisibles et les
-- ecritures echouent (cf. CLAUDE.md).
-- ─────────────────────────────────────────────────────────────────────────
