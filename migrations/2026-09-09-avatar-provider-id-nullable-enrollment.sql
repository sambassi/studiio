-- A_8c — UNE SOURCE PEUT ETRE PRETE AVANT QU'UN FOURNISSEUR EXISTE.
--
-- UNE seule instruction. Aucun type change, aucune colonne ajoutee ou
-- supprimee, aucune valeur existante reecrite.
--
-- ─────────────────────────────────────────────────────────────────────────
-- CE QUE LA CONTRAINTE SUPPOSAIT
-- ─────────────────────────────────────────────────────────────────────────
--
-- `provider_avatar_id not null` decrivait fidelement l'ordre d'origine : la
-- route appelait HeyGen, obtenait un identifiant, PUIS inserait la ligne. Un
-- avatar naissait donc chez le fournisseur, et la base ne faisait que
-- l'enregistrer.
--
-- Cet ordre s'inverse. La source de reference — deux a cinq minutes de la
-- personne — et son consentement existent AVANT tout entrainement, qui est
-- reporte. Au stade `source_ready`, il n'y a legitimement aucun identifiant
-- fournisseur a ecrire.
--
-- ⚠️ ET IL NE FAUT SURTOUT PAS EN INVENTER UN. Poser `'PLACEHOLDER'`,
-- `'pending'` ou `'local'` dans une colonne qui signifie « identifiant chez le
-- fournisseur » ferait mentir la donnee — et la route de statut irait
-- interroger HeyGen avec cette valeur. NULL dit exactement ce qui est vrai :
-- aucun avatar n'a encore ete cree chez le fournisseur.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LA SEMANTIQUE, DESORMAIS
-- ─────────────────────────────────────────────────────────────────────────
--
--   provider_avatar_id IS NULL  + status = 'source_ready'
--     → la source de l'utilisateur est prete ; rien n'a ete envoye nulle part.
--
--   provider_avatar_id IS NOT NULL
--     → un avatar EXISTE chez le fournisseur. Cette colonne ne devient non
--       nulle qu'apres une creation reellement reussie.
--
-- ⚠️ AUCUNE LIGNE EXISTANTE N'EST TOUCHEE. Relacher une contrainte ne modifie
-- pas les valeurs deja ecrites : les avatars deja entraines gardent leur
-- identifiant, intact.

alter table public.user_avatars
  alter column provider_avatar_id drop not null;

-- ─────────────────────────────────────────────────────────────────────────
-- DROITS POSTGREST
--
-- Sans droits, PostgREST n'inscrit pas la table dans son cache de schema.
-- ─────────────────────────────────────────────────────────────────────────
grant all on table public.user_avatars to public;

-- ─────────────────────────────────────────────────────────────────────────
-- ⚠️ APRES CETTE MIGRATION — ETAPE OBLIGATOIRE
--
--     docker kill -s SIGUSR1 studiio-postgrest
--
-- Elle ne redemarre pas le conteneur : elle demande la relecture du schema.
-- ─────────────────────────────────────────────────────────────────────────
