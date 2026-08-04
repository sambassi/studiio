-- Clonage vocal — voix clonee d'un utilisateur (ElevenLabs)
-- A executer sur la base Postgres auto-hebergee (studiio-db).
--
-- Une seule table NOUVELLE, aucune modification de table existante : cette
-- migration ne peut pas casser l'existant.
--
-- POURQUOI CETTE TABLE
--
-- `ELEVENLABS_API_KEY` designe UN SEUL compte ElevenLabs, partage par tous les
-- utilisateurs de Studiio. La voix clonee de chacun atterrit donc dans le meme
-- espace : `GET /v2/voices` les renvoie toutes, sans aucune notion de
-- proprietaire.
--
-- Sans cette table, il n'existe aucun moyen de savoir a QUI appartient une
-- voix clonee — et le selecteur proposerait la voix de chaque utilisateur a
-- tous les autres. C'est le rattachement, et lui seul, qui rend le clonage
-- utilisable au-dela d'un compte unique.
--
-- TANT QUE CETTE MIGRATION N'EST PAS APPLIQUEE
--
-- Le code degrade proprement, dans le sens SUR :
--   - la liste des voix ne renvoie que le catalogue ElevenLabs, comme
--     aujourd'hui (aucune voix clonee ne fuite) ;
--   - le clonage REFUSE de s'executer, avec un message explicite, plutot que
--     de creer chez ElevenLabs une voix que plus personne ne pourrait
--     rattacher a son proprietaire ni supprimer.

create table if not exists user_voices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- 'elevenlabs' aujourd'hui. La colonne existe pour que HeyGen — qui sait
  -- aussi cloner — puisse rejoindre la meme table sans migration.
  provider text not null default 'elevenlabs',
  -- Identifiant de la voix chez le fournisseur (voice_id ElevenLabs).
  provider_voice_id text not null,
  -- Nom affiche dans le selecteur, choisi par l'utilisateur.
  name text not null,
  -- Langue declaree, pour le drapeau du selecteur. Nullable : inconnue.
  lang text,
  -- Consentement obligatoire : l'utilisateur certifie que la voix est la
  -- sienne. Meme exigence que pour l'avatar (`user_avatars.consent_at`), et
  -- meme raison — c'est une donnee biometrique.
  consent_at timestamptz not null,
  consent_text text not null,
  created_at timestamptz not null default now()
);

-- Un meme voice_id ne doit pas pouvoir etre revendique par deux comptes.
create unique index if not exists user_voices_provider_voice_id_key
  on user_voices (provider, provider_voice_id);

create index if not exists user_voices_user_id_idx
  on user_voices (user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- DROITS POSTGREST
--
-- Sans ce grant, PostgREST voit bien la table mais repond
-- « table not in schema cache » / 404 : le role utilise par PostgREST n'a
-- aucun droit dessus, donc la table n'entre pas dans le cache de schema.
-- ─────────────────────────────────────────────────────────────────────────
grant all on table public.user_voices to public;

-- ─────────────────────────────────────────────────────────────────────────
-- ⚠️ APRES CETTE MIGRATION — ETAPE OBLIGATOIRE
--
-- PostgREST met son schema en cache au demarrage. Tant qu'il n'est pas
-- recharge, toute table fraichement creee reste invisible et l'API renvoie
-- « Could not find the table ... in the schema cache ».
--
-- Recharger le cache (sur le serveur Hetzner) :
--
--     docker kill -s SIGUSR1 studiio-postgrest
--
-- Cette commande ne redemarre PAS le conteneur : elle demande juste a
-- PostgREST de relire le schema. A refaire apres CHAQUE migration qui cree
-- ou modifie une table, sinon le bug se reproduira a l'identique.
-- ─────────────────────────────────────────────────────────────────────────
