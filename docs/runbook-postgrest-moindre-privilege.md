# Runbook — PostgREST au moindre privilège

> **Statut : PRÉPARÉ, RIEN N'EST APPLIQUÉ.** Toute étape qui touche un rôle, un GRANT,
> une variable Coolify ou un redémarrage exige le feu vert explicite de l'utilisateur
> (règle « STOP préalable », mémoire `securite-gate-staging`).
>
> Fichiers :
> - `migrations/2026-09-29-postgrest-moindre-privilege.sql` : la migration (rejouable)
> - `migrations/2026-09-29-postgrest-moindre-privilege.verif.sql` : la vérification, en **lecture seule**
> - `migrations/2026-09-29-postgrest-moindre-privilege.rollback.sql` : le rollback SQL
> - `tests-pg/postgrest-moindre-privilege.pg.test.ts` : les tests sur un vrai PostgreSQL (35 tests)

## 0. Constat CONFIRMÉ en production (lecture seule, 2026-10-09)

Script : `scripts/audit/postgrest-roles.lecture-seule.sh`, à coller dans Coolify → Terminal → localhost.

| Contrôle | Valeur réelle |
|---|---|
| Utilisateur de `PGRST_DB_URI` | `studiio` |
| `PGRST_DB_ANON_ROLE` | `studiio` |
| Attributs de `studiio` | SUPERUSER, CREATEROLE, CREATEDB, LOGIN, BYPASSRLS |
| claim `role` de `SUPABASE_SERVICE_ROLE_KEY` | `studiio` |
| anonyme : SELECT `users` / EXECUTE `crediter_credits_stripe` | oui / oui |
| `GET /users` **sans jeton**, en interne | **200** |

L'exposition **depuis Internet** se mesure avec `scripts/audit/postgrest-exposition.lecture-seule.sh`.
Ce script relève les réseaux, les ports publiés, les règles Traefik et la configuration du proxy
(valeurs sensibles masquées), puis fait des `GET` sans jeton dont seul le code HTTP est affiché.

**La preuve HTTP de bout en bout est désormais automatisée** dans `tests-pg/postgrest-http.pg.test.ts`.
Un vrai PostgREST tourne en CI. Le test reproduit la configuration actuelle et prouve la faille :
- lecture de `users` sans jeton ;
- écriture des crédits de B sans jeton ;
- débit de B par RPC sans jeton ;
- clé `role=studiio` acceptée ;
- `anon` hérité, membre du superutilisateur.

Il prouve ensuite les 14 contrôles de la cible, puis le rollback.

## 0 bis. Fonctions SECURITY DEFINER (toutes : `search_path` figé, EXECUTE au seul propriétaire)

| Fonction | `p_user_id` libre | Appelée par |
|---|---|---|
| `debiter_credits` | oui | `lib/credits` (rendus) |
| `debiter_credits_operation` | oui | `lib/credits` (avatar, voix, opérations) |
| `confirmer_rendu`, `confirmer_rendu_sans_debit`, `clore_rendu` | oui | routes de rendu |
| `lut_assets_ajouter` | oui | import de LUT |
| `crediter_credits_stripe` | oui | webhook Stripe |
| `stripe_event_claim` / `complete` / `fail` | non | webhook Stripe |
| `lut_assets_verifier_plafond` | non (déclencheur) | base |

Avec `PGRST_DB_ANON_ROLE=studiio`, n'importe quel appel **sans jeton** peut les exécuter pour n'importe quel compte.
C'est la cause unique : les fonctions vérifient bien le compte qu'on leur passe, mais la confiance repose sur
l'appelant, qui doit être le backend. Dans la cible, seul `service_role` (clé serveur, jamais le navigateur)
peut les exécuter. Les futures fonctions de #532 (`activer_version_avatar`, `definir_avatar_par_defaut`)
suivent la même règle, sans aucun GRANT à écrire, grâce aux privilèges par défaut (section 5 de la migration).

Ajouts du 2026-10-10 à la migration (jamais appliquée) :
- les rôles hérités `anon` et `authenticated` sont neutralisés : NOLOGIN, NOSUPERUSER, NOBYPASSRLS, aucune appartenance ;
- toute fonction SECURITY DEFINER sans `search_path` en reçoit un ;
- `verif.sql` contrôle ces quatre points.

**Choix des noms.** L'anonyme reste `web_anon` (rôle neuf) et non `anon`. Un `anon` hérité d'un dump Supabase
peut porter des droits ou des appartenances qu'aucune migration du dépôt ne connaît. `authenticated` n'a aucun
usage : le navigateur n'appelle jamais PostgREST, et `authenticator` ne peut pas y basculer.

## 0 ter. Ce qui casserait à la bascule (cartographie du code, 2026-10-10)

- **Navigateur** : aucun appel PostgREST, ni client Supabase côté navigateur.
  Le module `src/lib/db/supabase.ts` n'exporte plus que `supabaseAdmin`.
- **Serveur** : tout passe par `supabaseAdmin` : routes, crons, auth NextAuth (table `users`), crédits,
  calendrier, Créer, Autopilote, avatar, social. Il utilise `SUPABASE_URL` et
  `SUPABASE_SERVICE_KEY` (à défaut `SUPABASE_SERVICE_ROLE_KEY`).
  - **Il faut une clé `role=service_role`**, sinon tout répond 403.
  - Les deux variables portent aujourd'hui `role=studiio`.
- **10 RPC** appelées : `debiter_credits`, `debiter_credits_operation`, `confirmer_rendu`,
  `confirmer_rendu_sans_debit`, `clore_rendu`, `lut_assets_ajouter`, `crediter_credits_stripe`,
  `stripe_event_claim`, `stripe_event_complete`, `stripe_event_fail`. Toutes s'ouvrent à `service_role`.
- **Hors périmètre de PostgREST** :
  - le stockage, qui passe par MinIO (`STORAGE_PROVIDER=s3`) et non par PostgREST ;
  - `src/lib/email/notifications.ts`, qui n'utilise plus son propre client.
- **Aucune DDL à l'exécution** : seulement des `select` de sondage de colonnes (`colonneReady`),
  autorisés à `service_role`.

## 0 quater. Exposition (lecture seule, 2026-10-09)

- **Internet : non joignable d'après les preuves ci-dessous**, à confirmer par `scripts/audit/postgrest-exposition-complement.lecture-seule.sh` (configuration dynamique Traefik/Caddy, règles NAT, ports d'écoute de l'hôte). Les éléments relevés :
  - aucun port publié sur l'hôte pour `studiio-postgrest` ni pour `studiio-pgrst-proxy` ;
  - aucun label Traefik ni Caddy sur ces deux conteneurs ;
  - `https://studiio.pro/users` et `https://studiio.pro/rest/v1/users` → **404** (réponse de Next) ;
  - le proxy n'injecte aucun `Authorization` ni `apikey`.
- **Interne : OUI.** Les deux conteneurs sont sur `studiio-internal` **et sur `coolify`**, le réseau partagé
  avec les autres projets du serveur. Tout conteneur de ce réseau atteint `studiio-postgrest:3000` sans jeton,
  en superutilisateur. C'est le risque latéral réel tant que les étapes 3 à 5 ne sont pas faites.
- **Durcissement proposé, à part, avec GO** : retirer `studiio-postgrest` du réseau `coolify` s'il n'en a pas
  besoin. L'application l'atteint par le proxy, et le proxy est sur `studiio-internal`. À vérifier d'abord sur
  le staging.

## 1. Le problème

D'après le dépôt (`tests-pg/lut-assets.pg.test.ts` §0b, mémoire `securite-gate-staging`),
`studiio` joue **quatre rôles** en production :

| Où | Valeur actuelle |
|---|---|
| `PGRST_DB_URI` (utilisateur de connexion de PostgREST) | `studiio` |
| `PGRST_DB_ANON_ROLE` (rôle des requêtes **sans jeton**) | `studiio` |
| claim `role` du JWT serveur (`SUPABASE_SERVICE_KEY`) | `studiio` |
| attribut du rôle | **SUPERUSER**, propriétaire de toutes les tables |

**Conséquence :** quiconque atteint PostgREST, même sans aucun jeton, agit en superutilisateur.
Il peut lire et modifier `users` (crédits, rôle admin), `subscriptions`, `credit_transactions`,
`social_accounts` (jetons OAuth) et appeler les fonctions de débit.

L'étape 0 doit **confirmer** ces valeurs sur le serveur : le dépôt ne fait que les documenter.

## 2. Ce dont l'application a réellement besoin (audit du code)

- **Aucun appel PostgREST depuis le navigateur.** Aucun fichier `'use client'` n'importe
  `@/lib/db/supabase` ni `@supabase/supabase-js`. Le client `supabase` (clé anon) exporté par
  `src/lib/db/supabase.ts` n'est importé nulle part. Ses helpers `getUser`, `getUserCredits`
  et `updateUserCredits` sont du code mort.
- **Tout passe par `supabaseAdmin`**, côté serveur : routes API, crons, `lib/credits`. Il
  s'authentifie avec `SUPABASE_SERVICE_KEY`, à défaut `SUPABASE_SERVICE_ROLE_KEY`. Environ
  40 tables et 6 fonctions RPC sont concernées : `debiter_credits`, `debiter_credits_operation`,
  `confirmer_rendu`, `confirmer_rendu_sans_debit`, `clore_rendu`, `lut_assets_ajouter`.
  S'y ajoutent les 4 fonctions Stripe de la PR #471.
- ⚠️ `getSupabaseAdmin()` **retombe sur la clé anon** si aucune des deux variables serveur
  n'est posée. Après la bascule, cela donnerait des 401 partout. L'étape 0.c vérifie que la clé
  serveur est bien présente.
- Hors périmètre, à signaler : `src/lib/email/notifications.ts` crée son propre client avec
  `NEXT_PUBLIC_SUPABASE_URL` (Supabase **cloud**) et `SUPABASE_SERVICE_ROLE_KEY`. Il ne passe pas
  par notre PostgREST.

**Conclusion : le rôle anonyme n'a besoin d'AUCUN droit.**

## 3. Le modèle cible

```
authenticator  LOGIN, NOINHERIT, aucun droit propre      ← PGRST_DB_URI
   ├── web_anon      NOLOGIN, aucun droit, pas même USAGE sur `public`   ← PGRST_DB_ANON_ROLE
   └── service_role  NOLOGIN, BYPASSRLS, DML sur les tables de `public`,
                     EXECUTE sur ses fonctions                            ← claim `role` du JWT serveur
studiio        inchangé : propriétaire, superuser, rôle des migrations (psql -U studiio)
```

- Le nom `service_role` est aligné sur la PR #471 (stripe_events), qui accorde l'EXECUTE de ses
  fonctions à `service_role` « s'il existe ». **Les deux ordres d'application sont couverts.**
  - Si #471 passe avant : la section 4 de la migration accorde l'EXECUTE sur toutes les fonctions existantes.
  - Si #471 passe après : ce sont les privilèges par défaut qui l'accordent.
- **BYPASSRLS** garde le comportement actuel (un superuser ignore la RLS). La table `stripe_events`
  a la RLS activée, sans politique : sans BYPASSRLS, le serveur y lirait 0 ligne.
- **USAGE sur le schéma `public` retiré à PUBLIC.** Même si une migration future refait
  `grant all ... to public`, `web_anon` n'atteint rien. C'est prouvé en test et en bout-en-bout.
- **Tables et fonctions futures** : les privilèges par défaut de `studiio` les ouvrent
  automatiquement à `service_role` et les ferment à PUBLIC. Aucun GRANT n'est à écrire dans les
  migrations.

## 4. Preuve locale (déjà faite, Postgres 16 et PostgREST 16.2 jetables, secrets de test)

| Requête | Transition (connexion superuser, `anon=web_anon`) | Cible (`authenticator`) |
|---|---|---|
| anonyme `GET /users` | **401** permission denied for schema public | **401** |
| anonyme `PATCH /users` (crédits) | **401** | **401** |
| anonyme `GET /` (OpenAPI) | 200, **aucune table listée** | 200, aucune table |
| JWT `role=anon` | 403 | **403** permission denied to set role |
| JWT `role=studiio` (ancienne clé) | ⚠️ passe encore en prod (studiio superuser) | **403** permission denied to set role |
| JWT `role=service_role` : `GET /users`, `PATCH`, RPC `debiter_credits_operation` | 200 | 200 |
| anonyme, après un `grant all on users to public` + SIGUSR1 | **401** | **401** |
| `/ready` (serveur admin) | 200 | 200 |

## 5. Variables Coolify concernées (noms seulement)

| Service | Variable | Nouvelle valeur |
|---|---|---|
| `studiio-postgrest` | `PGRST_DB_ANON_ROLE` | `web_anon` |
| `studiio-postgrest` | `PGRST_DB_URI` | même hôte et même base, utilisateur `authenticator`, **nouveau** mot de passe |
| `studiio-app` | `SUPABASE_SERVICE_KEY` | **nouveau** JWT, claim `role=service_role` |
| `studiio-app` | `SUPABASE_SERVICE_ROLE_KEY` | idem, **seulement si** elle porte aujourd'hui une clé de notre PostgREST (étape 0.c) |

- `PGRST_JWT_SECRET` **ne change pas**. L'ancienne clé `role=studiio` devient inutilisable
  d'elle-même à l'étape 5, car `authenticator` n'est pas membre de `studiio`. Une rotation du
  secret reste une bonne hygiène, mais c'est un chantier séparé : elle invalide toutes les clés
  d'un coup.
- **La clé serveur doit être régénérée**, puisque son claim `role` change. Seul le claim `role`
  change : `aud`, `iss` et `exp` éventuels sont recopiés de l'ancienne clé.

## 6. Procédure — staging d'abord

**Le staging existe.** C'est un projet Coolify séparé, sur le réseau Docker `staging-net`, avec
les alias `studiio-staging-postgrest`, `studiio-staging-pgrst-proxy` et `studiio-staging-minio`.
L'app staging (`g4e2bclxt0wqob84ws9j2kza`) répond sur https://staging.studiio.pro. On y déroule
d'abord les étapes 0 à 5 complètes, **puis** la production (étape 6).

Conventions de toutes les commandes : on n'affiche jamais une valeur de secret, et
`umask 077` s'applique avant d'écrire un fichier.

### Identifier les conteneurs — STAGING (toujours par alias réseau, jamais par nom)

Les conteneurs staging se retrouvent par **alias sur `staging-net`**, comme dans `stg2.sh`. On ne
les cherche **jamais** par nom : un `grep studiio-db` ou `grep studiio-postgrest` peut attraper la
**production**. La base se déduit de l'hôte de `PGRST_DB_URI` du PostgREST staging, et le script
s'arrête s'il retombe sur `studiio-db`.

```bash
set -euo pipefail
NET=staging-net
envde(){ docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n "s/^$2=//p"; }
alias_on(){ local c; for c in $(docker ps --format '{{.Names}}'); do
  docker inspect "$c" --format "{{with index .NetworkSettings.Networks \"$1\"}}{{range .Aliases}}{{println .}}{{end}}{{end}}" 2>/dev/null \
    | grep -qx "$2" && echo "$c"; done; return 0; }
un(){ [ "$(printf '%s\n' $2 | grep -c .)" = 1 ] || { echo "STOP : $1 introuvable ou ambigu [$2]"; exit 1; }; }

docker network inspect "$NET" >/dev/null
PG="$(alias_on "$NET" studiio-staging-postgrest)";      un postgrest "$PG"
PROXY="$(alias_on "$NET" studiio-staging-pgrst-proxy)"; un proxy "$PROXY"
APP=""; for c in $(docker ps --format '{{.Names}}'); do
  envde "$c" SUPABASE_URL | grep -qE '^http://studiio-staging-(pgrst-proxy|postgrest)(:[0-9]+)?/?$' && APP="${APP:+$APP }$c"; done
un app "$APP"
H="$(envde "$PG" PGRST_DB_URI | sed -nE 's#^[a-z]+://[^@]*@([^:/?]+).*#\1#p')"   # hote seulement
DB="$(alias_on "$NET" "$H")"; un db "$DB"
case "$DB" in studiio-db|studiio-db-*) echo "STOP : db = PRODUCTION"; exit 1;; esac
DBU="$(envde "$PG" PGRST_DB_URI | sed -nE 's#^[a-z]+://([^:@/]+).*#\1#p')"       # utilisateur, sans mot de passe
DBN="$(envde "$PG" PGRST_DB_URI | sed -nE 's#^[a-z]+://[^/]*/([^?]+).*#\1#p')"   # nom de base
echo "STAGING : app=$APP postgrest=$PG proxy=$PROXY db=$DB user=$DBU base=$DBN"
```

Sur le staging, les commandes `psql -U studiio -d studiio` des étapes suivantes deviennent
`psql -U "$DBU" -d "$DBN"`. L'URL publique de contrôle (0.e) est
`https://staging.studiio.pro`, plus l'éventuel domaine du proxy staging trouvé en 0.d.

### Identifier les conteneurs — PRODUCTION (étape 6 seulement)

Après le succès complet sur le staging, on reprend la même méthode sur le réseau de production.
Le nom du réseau se lit dans `docker inspect <conteneur studiio-app de prod> --format '{{json .NetworkSettings.Networks}}'`.
Les alias attendus sont `studiio-postgrest`, `studiio-pgrst-proxy` et `studiio-db`. Il faut
vérifier explicitement que **`APP` n'est pas l'app staging** : son `SUPABASE_URL` ne doit pas
contenir `staging`.

### Option : répétition sur une restauration jetable

Elle reste possible en plus du staging, par exemple pour rejouer la migration sur les **données
de production** sans toucher au staging. On restaure la sauvegarde de 03h00 dans un conteneur
`postgres:16-alpine` sans réseau Coolify ni port publié, avec un PostgREST jetable et des secrets
de test. On y déroule les étapes 2 à 5, puis on détruit les deux conteneurs.

### Ordre SANS COUPURE et contrôle après chaque étape

Le script `scripts/bascule/controle-postgrest.lecture-seule.sh` passe par le même chemin que l'application :
la clé posée dans `studiio-app`, puis `SUPABASE_URL/rest/v1` (le proxy). Il ne lit aucune donnée (`limit=0`)
et n'affiche aucun secret. Il vérifie :
- le rôle de la clé ;
- le code renvoyé à une requête anonyme ;
- l'accès aux 19 tables utilisées par l'application (`media` n'en fait pas partie : c'est un bucket MinIO, pas une table) ;
- le droit d'exécution des 10 RPC serveur pour le rôle de la clé ;
- l'avatar v3, par version, statut et empreinte.

Il conclut `VERDICT=CONTINUER` ou `VERDICT=ROLLBACK <motifs>`. La séquence complète a été validée en local avec un vrai
PostgREST et un proxy identique au nginx de production. Chaque étape a rendu CONTINUER. Avec l'ancienne clé encore posée
après le passage à `authenticator`, le script a bien rendu ROLLBACK.

| # | Étape | Réversible par | Contrôle pour continuer |
|---|---|---|---|
| 1 | Sauvegarde Coolify + `pg_dump --schema-only` + verif « avant » | — | sauvegarde listée ; `ETAPE=avant` → CONTINUER |
| 2 | Migration (rôles, grants, revokes) + SIGUSR1 | rollback SQL | verif Z OK partout ; `ETAPE=avant` → CONTINUER (rien ne change pour l'app) |
| 3 | `PGRST_DB_ANON_ROLE=web_anon`, redémarrer PostgREST | remettre `studiio`, redémarrer | `ETAPE=anon_ferme` → CONTINUER (anonyme 401) + §7 |
| 4 | Nouvelle clé `role=service_role` dans `SUPABASE_SERVICE_KEY` (et `_ROLE_KEY`), redéployer l'app | ancienne clé, redéployer | `ETAPE=cle_service` → CONTINUER + §7. La connexion est encore `studiio`, qui peut prendre le rôle `service_role` : aucune coupure |
| 5 | `authenticator` : mot de passe + LOGIN, puis `PGRST_DB_URI` en `authenticator`, redémarrer | ancien `PGRST_DB_URI`, redémarrer | `ETAPE=authenticator` → CONTINUER + §7 + l'ancienne clé `role=studiio` refusée (403) |

**Rollback** : si le verdict est `ROLLBACK`, on annule **la dernière étape seulement**, avec la colonne « Réversible par »,
puis on relance le contrôle de l'étape précédente. Les variables Coolify ne se changent que dans l'interface : le
script signale l'échec, mais ne modifie rien lui-même.

### Étape 0 — Pré-vol, lecture seule

**0.a — Les rôles.** On attend `studiio | t`, et vraisemblablement aucun autre rôle LOGIN.

```bash
docker exec "$DB" psql -U studiio -d studiio -Atc \
  "select rolname, rolsuper, rolcanlogin from pg_roles where rolname !~ '^pg_' order by 1"
```

Un autre rôle LOGIN utilisé par un outil (sauvegarde, BI…) est à signaler avant d'aller plus
loin. Il perdra l'USAGE sur `public` et devra le recevoir nommément.

**0.b — La configuration PostgREST.** On affiche les **noms** des variables, et les valeurs des
seules variables non secrètes.

```bash
docker inspect "$PG" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed 's/=.*//' | grep '^PGRST_'
docker inspect "$PG" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^PGRST_(DB_ANON_ROLE|DB_SCHEMAS|JWT_AUD|JWT_SECRET_IS_BASE64|JWT_ROLE_CLAIM_KEY|DB_PRE_REQUEST|ADMIN_SERVER_PORT)='
# Utilisateur de PGRST_DB_URI, SANS le mot de passe :
docker inspect "$PG" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sed -n 's#^PGRST_DB_URI=[a-z]*://\([^:@]*\).*#DB_URI user = \1#p'
```

Attendu : `PGRST_DB_ANON_ROLE=studiio`, `DB_URI user = studiio`.

- Si `PGRST_JWT_ROLE_CLAIM_KEY` ou `PGRST_DB_PRE_REQUEST` est posé : **STOP**, à analyser.
- Si `PGRST_DB_SCHEMAS` liste un autre schéma que `public` : **STOP**. La migration ne couvre que `public`.

**0.c — Les clés côté app.** On affiche le claim `role` seulement, jamais le jeton.

```bash
docker exec "$APP" node -e '
for (const k of ["SUPABASE_SERVICE_KEY","SUPABASE_SERVICE_ROLE_KEY","NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
  const t = process.env[k]; if (!t) { console.log(k, "ABSENTE"); continue; }
  try { const p = JSON.parse(Buffer.from(t.split(".")[1], "base64url"));
        console.log(k, "role=" + p.role, "aud=" + (p.aud ?? "-"), "exp=" + (p.exp ? "oui" : "non")); }
  catch { console.log(k, "illisible"); } }
console.log("SUPABASE_URL hote =", (process.env.SUPABASE_URL || "ABSENTE").replace(/\/\/[^@]*@/, "//"));'
```

Attendu : `SUPABASE_SERVICE_KEY role=studiio`, et `SUPABASE_URL` vers `http://studiio-pgrst-proxy`. C'est la valeur constatée le 2026-10-09 : le proxy nginx ne sert que `/rest/v1/` (vers `studiio-postgrest:3000`) et répond 404 à tout le reste. **Toute sonde doit donc viser `$SUPABASE_URL/rest/v1/...`**, comme le fait `supabase-js`.

- Si `NEXT_PUBLIC_SUPABASE_ANON_KEY` porte `role=studiio`, une clé superuser est **publiée
  dans le bundle navigateur**. Cela reste vrai jusqu'à l'étape 5, qui la neutralise : il faut
  alors accélérer l'étape 5.
- Si `SUPABASE_SERVICE_KEY` est **ABSENTE** : **STOP**. L'app tourne sur la clé anon, voir le §2.

**0.d — Le proxy `studiio-pgrst-proxy`.** Sa configuration **n'est pas dans le dépôt**. Il faut
vérifier deux choses : qu'il n'**injecte pas** d'en-tête `Authorization` ou `apikey`, et
savoir sur quels domaines il répond.

```bash
docker inspect "$PROXY" --format '{{.Config.Image}} {{json .Config.Cmd}} {{json .Mounts}}'
docker inspect "$PROXY" --format '{{range $k,$v := .Config.Labels}}{{println $k "=" $v}}{{end}}' | grep -iE 'rule|host|port'
# Recherche d'une injection, en masquant la valeur :
docker exec "$PROXY" sh -c 'grep -rniE "authorization|apikey|bearer" /etc/nginx /etc/caddy /etc/traefik 2>/dev/null' \
  | sed -E 's/(Bearer|bearer)[^;"]*/\1 ***MASQUE***/'
```

S'il injecte une clé serveur, **tout Internet est `service_role`** via ce proxy : **STOP**, à
corriger avant tout le reste.

**0.e — Le constat d'exposition.** Seul le code HTTP est affiché, aucune donnée. On répète
l'opération pour chaque URL publique trouvée en 0.d, et pour `http://178.105.201.62:3000`.

```bash
docker exec "$APP" node -e 'fetch(process.env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/users?select=id&limit=0").then(r => console.log("anonyme interne", r.status))'
curl -s -o /dev/null -w 'anonyme public %{http_code}\n' "https://<url-publique-du-proxy>/users?select=id&limit=1"
```

Un `200` confirme la faille.

**0.f — L'instantané des droits.** Il est à conserver avec la sauvegarde.

```bash
docker exec -i "$DB" psql -U studiio -d studiio -v ON_ERROR_STOP=1 \
  < migrations/2026-09-29-postgrest-moindre-privilege.verif.sql > /root/verif-avant-$(date +%F).txt
```

La section D liste les `grant ... to public` existants. Le verdict Z doit être `KO` partout,
puisque rien n'est encore appliqué.

### Étape 1 — Sauvegarde

- Lancer une sauvegarde Coolify **manuelle** de `studiio-db`, puis vérifier qu'elle est bien listée.
- Sauvegarder aussi les droits :

  ```bash
  docker exec "$DB" pg_dump -U studiio -d studiio --schema-only > /root/schema-avant-$(date +%F).sql
  ```

- Noter les valeurs actuelles des variables du §5 dans le coffre (pas dans un fichier du dépôt).

### Étape 2 — Migration

L'application n'est pas affectée : `studiio` reste superuser.

```bash
docker exec -i "$DB" psql -U studiio -d studiio -v ON_ERROR_STOP=1 \
  < migrations/2026-09-29-postgrest-moindre-privilege.sql
docker kill -s SIGUSR1 "$PG"
docker exec -i "$DB" psql -U studiio -d studiio -v ON_ERROR_STOP=1 \
  < migrations/2026-09-29-postgrest-moindre-privilege.verif.sql > /root/verif-apres-$(date +%F).txt
```

Critères de passage :

- le **verdict Z** est **OK partout** ;
- la section **F** (tables sans DML pour service_role) est vide ;
- la section **G** donne `web_anon=f` et `service_role=t` partout.

Faire ensuite un smoke test de l'app : elle doit rester inchangée.

### Étape 3 — Fermer l'anonyme (le correctif de sécurité immédiat)

Mettre `PGRST_DB_ANON_ROLE=web_anon` dans Coolify (`studiio-postgrest`), puis **redémarrer** le
service. Il n'y a aucun effet sur l'app : elle envoie toujours un JWT.

Smoke tests :

- l'anonyme interne et public (commandes du 0.e) doit répondre **401** ;
- l'app complète doit passer (§7) ;
- `/ready` ou le healthcheck Coolify de `studiio-postgrest` doit rester vert. `GET /` répond 200
  avec un OpenAPI vide : un healthcheck sur `/` ne casse pas.

Rollback : remettre `PGRST_DB_ANON_ROLE=studiio`, puis redémarrer.

### Étape 4 — Nouvelle clé serveur (`role=service_role`)

Il faut générer la clé **sur le serveur**. Le secret n'est jamais affiché : il passe par un tube
jusqu'au `node` du conteneur app, et le jeton est écrit dans un fichier en mode 600.

```bash
umask 077
B64=$(docker inspect "$PG" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^PGRST_JWT_SECRET_IS_BASE64=//p')
docker inspect "$PG" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^PGRST_JWT_SECRET=//p' \
| docker exec -i -e B64="$B64" "$APP" node -e '
  const c = require("crypto");
  let s = require("fs").readFileSync(0, "utf8").replace(/\n$/, "");
  const key = process.env.B64 === "true" ? Buffer.from(s, "base64") : s;
  const old = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").split(".")[1];
  const prev = old ? JSON.parse(Buffer.from(old, "base64url")) : {};
  const claims = { ...prev, role: "service_role", iat: Math.floor(Date.now() / 1000) };
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" }), p = b(claims);
  process.stdout.write(h + "." + p + "." + c.createHmac("sha256", key).update(h + "." + p).digest("base64url"));
' > /root/studiio-service-role.jwt
test -s /root/studiio-service-role.jwt && echo "jeton ecrit ($(wc -c < /root/studiio-service-role.jwt) octets)"
```

Si `PGRST_JWT_SECRET` n'est pas une chaîne HS256 (JWK/JSON) : **STOP**, le script ne s'applique pas.

**Tester la clé avant de la poser.** Le jeton passe par stdin et n'est pas affiché. On attend
`200` puis `200`.

```bash
docker exec -i "$APP" node -e '
  const t = require("fs").readFileSync(0, "utf8").trim(), u = process.env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1";
  const H = { Authorization: "Bearer " + t };
  Promise.all([fetch(u + "/users?select=id&limit=0", { headers: { ...H, apikey: t } }), fetch(u + "/subscriptions?select=id&limit=0", { headers: { ...H, apikey: t } })])
    .then(rs => console.log(rs.map(r => r.status).join(" ")));' < /root/studiio-service-role.jwt
```

Coller le contenu du fichier dans `SUPABASE_SERVICE_KEY` (`studiio-app`), ainsi que dans
`SUPABASE_SERVICE_ROLE_KEY` si l'étape 0.c l'a montrée porteuse d'une clé locale. Redéployer, puis
dérouler le **§7 complet**. Supprimer ensuite le fichier : `shred -u /root/studiio-service-role.jwt`.

Rollback : remettre l'ancienne valeur, puis redéployer. PostgREST est encore connecté en
`studiio`, donc l'ancienne clé fonctionne toujours.

### Étape 5 — PostgREST ne se connecte plus en superuser

1. Poser le mot de passe. Il est saisi au clavier et n'apparaît ni dans l'historique ni dans les
   journaux.

   ```bash
   docker exec -it "$DB" psql -U studiio -d studiio -c '\password authenticator'
   docker exec "$DB" psql -U studiio -d studiio -c 'alter role authenticator login'
   ```

2. Dans Coolify (`studiio-postgrest`), `PGRST_DB_URI` garde le même hôte, le même port et la même
   base. Seuls l'utilisateur (`authenticator`) et le mot de passe changent. **Redémarrer** le service.
3. Logs PostgREST : on attend `Schema cache loaded`, et aucun `password authentication failed`.
4. Smoke tests :
   - l'anonyme (0.e) répond **401** ;
   - la clé neuve (test de l'étape 4) répond **200 200** ;
   - l'**ancienne** clé `role=studiio` répond **403** (`permission denied to set role`). Pour le
     vérifier, rejouer le test de l'étape 4 en lui passant l'ancienne valeur tirée du coffre ;
   - le **§7 complet** passe.

Rollback : remettre l'ancien `PGRST_DB_URI`, puis redémarrer. On peut ensuite repasser
`authenticator` en `nologin`.

### Étape 6 — Production

Uniquement après le succès complet des étapes 0 à 5 sur le staging, avec §7 vert sur
https://staging.studiio.pro. On ré-identifie les conteneurs de production (§6, par alias),
puis on reprend les mêmes étapes 0 à 5 dans le même ordre, en dehors du créneau du cron de
publication.

- Surveiller l'historique des Scheduled Tasks Coolify, en particulier `publish-cron` à la minute.
- Surveiller les logs `studiio-app` pendant 30 min après chaque bascule.

### Étape 7 — Après

- Mettre à jour `CLAUDE.md` (§8) et la mémoire `securite-gate-staging`, avec l'utilisateur.
- Garder `verif-avant` et `verif-apres` avec la sauvegarde.

## 7. Smoke tests applicatifs (après chaque bascule)

Sans aucune génération payante :

- **jumeau v3** : Créer → panneau « Mon jumeau » → « Avatar actif · v3 », état prêt (`GET /api/creer/jumeau`, gratuit) ;
- **Autopilote** : la page charge sa configuration, et un réglage s'enregistre ;
- **voix** : « Ma voix » affiche la voix clonée et le dictionnaire de prononciations, et une prononciation s'enregistre. Pas d'écoute (synthèse payante) ;
- **dashboard** : l'accueil affiche ses statistiques et les vidéos récentes ;
- **médias** : la Bibliothèque liste ses fichiers ;
- **social** : la page Réseaux affiche les comptes connectés ;
- **paiements** : la page facturation affiche le plan, et le webhook Stripe de test répond 2xx.

Les points ci-dessous complètent ces vérifications :

À faire après un hard-refresh, avec un compte réel :

- `/auth/login` → connexion Google → `/dashboard` : lecture de `users` ;
- solde de crédits affiché dans la Navbar ;
- `/dashboard/creer` : un rendu **complet** (jobs → upload → confirm). La confirmation
  **débite** via RPC : vérifier que le solde baisse une fois, une seule ;
- `/dashboard/calendar` : les posts s'affichent, et on peut en créer ou en modifier un ;
- `/dashboard/settings` et la page facturation (`subscriptions`) ;
- `/admin` : stats, users et paiements (compte admin) ;
- Coolify → `publish-cron` : la prochaine exécution sort en code 0 ;
- webhook Stripe (si #471 est déployée) : un « Send test event » depuis le dashboard Stripe doit
  répondre 2xx.

## 8. Nouvelle règle proposée pour CLAUDE.md

Elle **remplace** « Donne les droits au role PostgREST : `grant all on table public.ma_table to public;` » :

> **Droits des nouvelles tables — ne JAMAIS écrire `grant ... to public`.**
> Les migrations se jouent en `psql -U studiio`. Les privilèges par défaut de `studiio` (migration
> `2026-09-29-postgrest-moindre-privilege.sql`) ouvrent automatiquement toute nouvelle table,
> séquence ou fonction de `public` au rôle serveur `service_role`, et la ferment à l'anonyme
> (`web_anon`). **Aucun GRANT n'est à écrire.** Seul reste obligatoire
> `docker kill -s SIGUSR1 studiio-postgrest`.
> Si une migration est jouée par un autre rôle que `studiio`, ajouter
> `grant select, insert, update, delete on table public.ma_table to service_role;` et l'EXECUTE
> nommé des fonctions. **Ne jamais rien accorder à `public`, `web_anon`, `anon` ni `authenticated`.**
> Contrôle : `migrations/2026-09-29-postgrest-moindre-privilege.verif.sql`, dont le verdict doit
> être OK partout.

## 9. Risques et points ouverts

| Risque | Parade |
|---|---|
| Un consommateur inconnu de PostgREST sans jeton (script, n8n, relais) | 0.a, 0.d et 0.e. Après l'étape 3, il reçoit 401 : rollback d'une ligne. |
| `SUPABASE_SERVICE_KEY` absente, l'app retombe sur la clé anon (§2) | 0.c, STOP si ABSENTE |
| Proxy qui injecte une clé serveur | 0.d, STOP |
| Table créée par un autre rôle que `studiio` : pas de DML pour `service_role` | verif.sql, section F et verdict Z |
| Mot de passe `authenticator` mal saisi : PostgREST ne démarre plus | Rollback de `PGRST_DB_URI`, une variable |
| Tables historiques avec RLS | `service_role` BYPASSRLS : comportement actuel conservé (section H) |
| `revoke usage on schema public from public` affecte un autre rôle LOGIN | 0.a : aucun attendu, sinon `grant usage` nommé |
| Rotation de `PGRST_JWT_SECRET` | Hors périmètre, chantier séparé |
| Confusion staging / production | Conteneurs identifiés par alias réseau, jamais par nom ; STOP si la base staging résout vers `studiio-db` (§6) |

## 10. Rollback complet

Dans l'ordre inverse, chaque étape étant indépendante :

1. `PGRST_DB_URI` → ancienne valeur, puis redémarrer `studiio-postgrest`.
2. `SUPABASE_SERVICE_KEY` (et `SUPABASE_SERVICE_ROLE_KEY`) → ancienne valeur, puis redéployer `studiio-app`.
3. `PGRST_DB_ANON_ROLE=studiio`, puis redémarrer.
4. Seulement si l'on renonce au chantier : `migrations/2026-09-29-postgrest-moindre-privilege.rollback.sql`
   en `psql -U studiio`, puis SIGUSR1. Ce script ne restaure pas les `grant ... to public`
   historiques. C'est voulu (voir son en-tête).
