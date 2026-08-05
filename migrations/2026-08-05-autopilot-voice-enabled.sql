-- Autopilote — la voix off devient une option EXPLICITE.
--
-- Elle passe par ElevenLabs, facture a l'usage : personne ne doit se
-- retrouver a payer une narration qu'il n'a pas demandee. Le defaut est donc
-- FALSE, et un Autopilote deja configure continue de produire exactement ce
-- qu'il produisait — sans voix, sans cout.
--
-- TANT QUE CETTE MIGRATION N'EST PAS APPLIQUEE
-- La colonne est absente : `sanitizeConfig` lit alors `undefined`, ce qui
-- vaut `false`. L'interrupteur s'affiche mais ne retient pas son etat. Rien
-- d'autre ne change, et surtout aucune synthese n'est declenchee.

alter table autopilot_config
  add column if not exists voice_enabled boolean not null default false;

-- Sans ces deux etapes, PostgREST repond « Could not find the table ... in
-- the schema cache » (cf. CLAUDE.md) : la colonne existe en base mais reste
-- invisible a l'application.
grant all on table public.autopilot_config to public;

-- Puis, sur le serveur :
--   docker kill -s SIGUSR1 studiio-postgrest
