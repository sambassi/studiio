-- Migration Instagram : « Instagram API with Instagram Login »
-- A executer sur la base Postgres auto-hebergee (studiio-db).
--
-- Aucune table creee ni modifiee : cette migration ne fait que MARQUER les
-- comptes Instagram existants comme a reconnecter.
--
-- POURQUOI
-- Meta a deprecie l'acces Instagram via Facebook Login. Les lignes deja en
-- base portent le format herite :
--   - `account_id`   = identifiant du compte IG Business rattache a une Page
--   - `access_token` = token Facebook
-- Le nouveau code de publication parle a graph.instagram.com avec un token
-- Instagram Login. Sur une ligne heritee, il echoue systematiquement
-- (« code=190 — Invalid OAuth access token »), et le rafraichissement echoue
-- lui aussi puisque `ig_refresh_token` n'accepte pas un token Facebook.
--
-- Sans cette migration, la panne est SILENCIEUSE : /dashboard/social affiche
-- toujours le compte comme connecte, et l'utilisateur ne sait pas qu'il doit
-- le reconnecter. Chaque publication programmee echoue une par une.
--
-- Effet : le compte apparait deconnecte, l'utilisateur relance « Connecter »
-- et repasse par le nouveau flux. Aucune donnee n'est supprimee — le token
-- herite reste en base, inerte, et sera ecrase par l'upsert a la reconnexion.

update social_accounts
   set connected = false,
       updated_at = now()
 where platform = 'instagram'
   and connected = true;

-- Verification (doit renvoyer 0) :
--   select count(*) from social_accounts where platform = 'instagram' and connected = true;

-- ─────────────────────────────────────────────────────────────────────────
-- Pas de rechargement du cache PostgREST necessaire : aucune table n'est
-- creee ni modifiee, seulement des lignes mises a jour.
-- ─────────────────────────────────────────────────────────────────────────
