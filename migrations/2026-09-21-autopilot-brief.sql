-- Autopilote — le brief RÉCURRENT : objectif, message, public visé, CTA.
--
-- ⚠️ CE N'EST PAS LE SCRIPT DES VIDÉOS. Le brief est commun à toutes les
-- vidéos produites ; le script (la narration exacte) de chaque vidéo est
-- généré à sa production, à partir de ce brief et du sujet du jour. Un thème
-- comme « Danse » ne suffit pas à dire ce que la voix transmettra : c'est ce
-- que ce brief ajoute.
--
-- ⚠️ LE DÉFAUT REPRODUIT LE COMPORTEMENT ACTUEL : `{}`. Sans brief, le cron
-- génère les textes exactement comme avant (`sanitizeBrief({})` = `{}`).
-- Aucune configuration existante ne change de narration.
--
-- Forme relue par l'application : un objet dont les seules clés lues sont
-- `objectif`, `message`, `public`, `cta` — chaînes ≤ 300 caractères
-- (`sanitizeBrief`, src/lib/creer/brief.ts). La contrainte ci-dessous ne
-- garde que la forme « objet » : le contenu est nettoyé à la relecture.

alter table public.autopilot_config
  add column if not exists brief jsonb not null default '{}'::jsonb;

alter table public.autopilot_config
  drop constraint if exists autopilot_config_brief_objet;
alter table public.autopilot_config
  add constraint autopilot_config_brief_objet
  check (jsonb_typeof(brief) = 'object');

-- Sans ces deux étapes, PostgREST répond « Could not find the table ... in the
-- schema cache » (cf. CLAUDE.md) : la colonne existe en base mais reste
-- invisible à l'application — et la route l'omet alors de l'upsert, en le
-- disant à l'écran (`briefReady: false`).
grant all on table public.autopilot_config to public;

-- Puis, sur le serveur :
--   docker kill -s SIGUSR1 studiio-postgrest
