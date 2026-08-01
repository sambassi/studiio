# Infrastructure — ce qui tourne réellement

> Ce document existe parce que `vercel.json` a fait diagnostiquer à tort une
> publication automatique cassée : le fichier déclarait des crons Vercel, alors
> que l'hébergement est passé sur Coolify depuis. Les déclencheurs sont ici.

## Hébergement

| Quoi | Où |
|---|---|
| Application | Hetzner + **Coolify v4**, service `studiio-app` (image Next.js du `Dockerfile`) |
| Base | Postgres 16 auto-hébergé + PostgREST (`studiio-db`, `studiio-postgrest`) |
| Stockage | MinIO auto-hébergé (`studiio-minio`, `STORAGE_PROVIDER=s3`) |
| Domaine | studiio.pro |

**Vercel n'héberge plus rien.** Aucune fonction, aucun cron, aucun déploiement.

## Tâches planifiées — Coolify Scheduled Tasks

Les tâches périodiques sont des **Scheduled Tasks Coolify** attachées au service
`studiio-app`. Elles appellent les routes `/api/cron/*` en HTTP, avec le jeton
`CRON_SECRET` en en-tête `Authorization: Bearer`.

| Tâche Coolify | Fréquence | Route appelée | Rôle |
|---|---|---|---|
| `publish-cron` | chaque minute | `/api/cron/publish` | publie les `scheduled_posts` dont l'heure est passée (fuseau Europe/Paris) |
| `cleanup-media` | toutes les 3 h | `/api/cron/cleanup-media` | purge les médias orphelins du stockage |

`/api/cron/cleanup-db` existe côté code mais **n'a pas de tâche planifiée** à ce
jour : la route est appelable manuellement avec le même jeton.

### Vérifier qu'une tâche tourne

Dans Coolify : service `studiio-app` → **Scheduled Tasks** → l'historique
d'exécution de la tâche donne le code de sortie et la dernière exécution.

Signe d'un planificateur arrêté, côté données : des posts en statut `scheduled`
dont l'horaire est dépassé s'accumulent.

```sql
select count(*) from scheduled_posts
where status = 'scheduled'
  and (scheduled_date || ' ' || scheduled_time)::timestamp < now();
```

### Déclenchement manuel

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  https://studiio.pro/api/cron/publish
```

⚠️ `?force=true` publie **immédiatement** le premier post en attente, sans
vérifier l'heure. À n'utiliser que sciemment.


## Voir les pages authentifiées en local (agents, débogage visuel)

`/dashboard/*` est derrière l'authentification : un agent ne peut pas ouvrir
`/dashboard/creer-simple` pour vérifier un rendu, ce qui a déjà laissé passer
des défauts visuels (mixer annoncé « unifié » alors qu'un second jeu de niveaux
restait à l'écran).

En **développement local uniquement**, deux variables ouvrent la porte :

```bash
# .env.local — NE JAMAIS mettre dans les variables Coolify
DEV_AUTH_BYPASS=1
```

`npm run dev` suffit (`NODE_ENV=development`). Les pages protégées s'affichent
alors avec une session factice :

| Champ | Valeur |
|---|---|
| id | `00000000-0000-4000-8000-000000000000` |
| email | `dev@localhost` |
| plan | `pro` (pour voir les fonctionnalités payantes) |

Aucun compte réel n'est nécessaire, et rien n'est écrit en base par le
contournement lui-même.

### Pourquoi c'est sans risque en production

Deux verrous, **tous deux côté serveur**, tous deux obligatoires
(`isDevAuthBypassEnabled`, `src/lib/auth/config.ts`) :

1. `NODE_ENV !== 'production'` — l'image de production est bâtie avec
   `NODE_ENV=production`, le contournement y est mort quelle que soit la suite ;
2. `DEV_AUTH_BYPASS === '1'` — opt-in explicite, absent de `.env.example` et
   des variables Coolify.

La décision ne lit **ni cookie, ni en-tête, ni paramètre d'URL** : aucune requête
ne peut l'activer. Elle est figée au chargement du module, pas recalculée par
requête. `src/__tests__/dev-auth-bypass.test.ts` le vérifie, y compris
`NODE_ENV=production` + `DEV_AUTH_BYPASS=1` → **inactif**.

Au démarrage, un serveur où le contournement est actif l'annonce dans les logs.

## Et `vercel.json` ?

Son bloc `crons` a été **retiré** : il décrivait des déclencheurs qui ne
s'exécutaient plus, et c'est précisément ce qui a induit un mauvais diagnostic.

Il ne reste que `functions.maxDuration` pour `/api/agent/montage`, **inerte**
sur Coolify (le serveur Node n'applique pas cette limite). Le fichier peut
disparaître entièrement le jour où l'on confirme qu'aucun outil ne le lit.

## Migration Hetzner — reste à finir

`NEXT_PUBLIC_SUPABASE_URL`, la variable lue **côté navigateur**, pointe encore
vers le projet Supabase cloud historique, en dépassement de quota. S'il est
coupé, tout ce qui passe encore par le client casse — sans déploiement de notre
côté, donc sans signal préalable. À faire pointer vers le PostgREST
auto-hébergé, ou à supprimer.

## Sauvegardes

- Base : `studiio-db` sauvegardé **quotidiennement à 03h00** (cron Coolify `0 3 * * *`), en local sur le serveur.
- Code : point de restauration = tag `v2-baseline-2026-07-28` (commit `814d609`).
- Rollback : redéployer un commit antérieur depuis Coolify.
