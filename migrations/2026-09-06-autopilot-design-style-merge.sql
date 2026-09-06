-- Autopilote — FUSION ATOMIQUE de `design_style`.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LE DEFAUT QUE CETTE FONCTION CORRIGE
-- ─────────────────────────────────────────────────────────────────────────
--
-- `autopilot_config.design_style` est UNE colonne `jsonb` qui porte QUATRE
-- reglages independants — `montage`, `audio`, `profilCreatif`,
-- `objectifParDefaut` — et DEUX routes l'ecrivent.
--
-- Tant que chacune relisait le document, le modifiait en memoire et le
-- reecrivait en entier, deux ecritures qui se croisent faisaient disparaitre
-- la premiere. Sans erreur, sans message : le reglage revenait simplement a
-- sa valeur d'avant, et l'utilisateur croyait avoir mal clique.
--
-- ⚠️ ET LE CAS LE PLUS FREQUENT N'EST MEME PAS UNE COURSE. L'ecran de
-- configuration garde `design_style` en memoire depuis son chargement :
-- enregistrer « Mon style » puis toucher a la cadence reposait la valeur
-- PERIMEE et effacait le style. Trois gestes, un seul onglet, un seul
-- utilisateur.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE FONCTION, ET NON UN `UPDATE` DEPUIS L'APPLICATION
-- ─────────────────────────────────────────────────────────────────────────
--
-- `design_style || p_patch` doit lire et ecrire dans la MEME instruction.
-- PostgREST ne sait pas exprimer « la colonne, fusionnee avec ceci » dans un
-- PATCH : il envoie une valeur, jamais une expression qui reference la
-- colonne. Une fonction est le seul endroit ou l'operateur `||` s'applique a
-- la valeur courante sans fenetre entre la lecture et l'ecriture.
--
-- `||` fusionne au PREMIER niveau : `{"montage":…, "profilCreatif":A}` fusionne
-- avec `{"profilCreatif":B}` donne `{"montage":…, "profilCreatif":B}`. C'est
-- exactement la granularite voulue — une cle de reglage entiere, jamais un
-- melange a l'interieur d'un reglage.

create or replace function public.autopilot_design_style_merge(
  p_user_id uuid,
  p_patch jsonb
) returns void
language sql
as $$
  insert into public.autopilot_config (user_id, design_style, updated_at)
  values (p_user_id, coalesce(p_patch, '{}'::jsonb), now())
  on conflict (user_id) do update
    set design_style =
          coalesce(public.autopilot_config.design_style, '{}'::jsonb)
          || coalesce(p_patch, '{}'::jsonb),
        updated_at = now();
$$;

-- Sans ce grant, PostgREST voit la fonction mais repond 404 : le role qu'il
-- utilise n'a aucun droit d'execution.
grant execute on function public.autopilot_design_style_merge(uuid, jsonb) to public;

-- ─────────────────────────────────────────────────────────────────────────
-- ⚠️ APRES CETTE MIGRATION — ETAPE OBLIGATOIRE
--
--     docker kill -s SIGUSR1 studiio-postgrest
--
-- Cette commande ne redemarre PAS le conteneur : elle demande a PostgREST de
-- relire le schema. Sans elle, la fonction reste invisible et l'API repond
-- 404 (cf. CLAUDE.md).
--
-- ⚠️ TANT QU'ELLE N'EST PAS APPLIQUEE, RIEN NE CASSE. `fusionnerDesignStyle`
-- sonde la fonction et retombe sur un lire-modifier-ecrire : les cles voisines
-- sont conservees, seule la garantie d'atomicite manque. La fonction est
-- reprise d'elle-meme des qu'elle apparait, sans redeploiement.
-- ─────────────────────────────────────────────────────────────────────────
