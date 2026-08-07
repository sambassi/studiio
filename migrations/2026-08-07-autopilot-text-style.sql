-- Autopilote — le style de TEXTE constant : police, taille, position, icônes.
--
-- ⚠️ UNE SEULE COLONNE, ET C'EST UN CHOIX. Ces réglages sont quatre zones
-- (titre, sous-titre, CTA, icônes de cartes) fois sept propriétés, et ils sont
-- destinés à grandir. Une colonne par propriété aurait imposé une migration à
-- chaque ajout — et une migration oubliée se lit en production comme une
-- fonctionnalité qui ne marche pas, pas comme une erreur.
--
-- Le contenu est validé par `sanitizeDesignStyle`
-- (`src/lib/autopilot/textStyle.ts`), le MÊME code à la lecture et à
-- l'écriture : polices restreintes au catalogue, échelles et positions
-- bornées, icônes restreintes aux noms lucide connus.
--
-- ⚠️ `{}` = LE COMPORTEMENT ACTUEL, EXACTEMENT. Une propriété absente n'est
-- jamais remplacée par un défaut inventé : `buildAutopilotDesign` garde le
-- sien. Aucune configuration existante ne change de rendu.

alter table public.autopilot_config
  add column if not exists design_style jsonb not null default '{}'::jsonb;

-- Sans ces deux étapes, PostgREST répond « Could not find the table ... in the
-- schema cache » (cf. CLAUDE.md) : la colonne existe en base mais reste
-- invisible à l'application.
grant all on table public.autopilot_config to public;

-- Puis, sur le serveur :
--   docker kill -s SIGUSR1 studiio-postgrest
