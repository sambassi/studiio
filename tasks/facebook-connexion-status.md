# Connexion Facebook/Instagram — état au 2026-07-29 (mis de côté)

## Où on en est : 95% fait, diagnostic complet

La connexion Facebook est à **une seule chose près** de marcher. Tout le reste
est vérifié et correct.

### Ce qui est ACQUIS
- La bonne app Meta est identifiée : **« Studiio » `1318593163521022`** (type
  Entreprise, mode Développement, admin = Bassi). Elle a déjà Facebook Login for
  Business + Instagram configurés.
- Sa config OAuth existe : **« Studiio OAuth » → `META_CONFIG_ID = 1477522770514809`**.
- Les URI de redirection sont déjà autorisées côté Meta :
  `https://studiio.pro/api/social/callback?platform=facebook` et `...=instagram`.
- **Preuve que le site tourne sur Coolify (pas Vercel)** : modifier la variable
  dans Coolify a changé l'app en ligne de `1492…` à `1318…`. Le compte Vercel a
  **0 projet** — le mot « Vercel » dans les messages d'erreur est du vieux texte
  à nettoyer (voir fix de code plus bas).
- L'app fantôme `1492267728017820` (ancien `FACEBOOK_CLIENT_ID`) n'existe PAS
  dans le compte Meta — c'était la cause initiale.

### CE QU'IL RESTE À FAIRE (dans Coolify, service `studiio-app`, bloc **Production**)
Avoir **exactement ces 5 variables, une seule copie de chaque**, dans le bloc
**Production Environment Variables** (le site ne lit QUE Production, pas Preview) :

```
FACEBOOK_CLIENT_ID=1318593163521022
META_INSTAGRAM_APP_ID=1318593163521022
META_CONFIG_ID=1477522770514809
FACEBOOK_CLIENT_SECRET=<clé secrète de l'app 1318593163521022>
META_INSTAGRAM_APP_SECRET=<même clé secrète>
```

La clé secrète se récupère sur Meta : developers.facebook.com → app
`1318593163521022` → Paramètres de l'app → Général → Clé secrète → « Afficher »
→ copier. C'est un secret : il va directement dans Coolify, jamais dans le chat.

Puis **Save** + **Redeploy**.

### Piège identifié (cause des régressions en boucle)
Les valeurs revenaient « vides » (« OAuth non configuré ») probablement parce
qu'elles étaient dans le mauvais bloc (**Preview** au lieu de **Production**),
ou perdues lors d'un nettoyage de doublons. → Vérifier qu'elles sont bien dans
**Production** et qu'il n'y a **pas de doublon**.

### Vérification objective (Claude Cowork la fait)
Tester `POST /api/social/connect` (platform=facebook) sur la page en ligne :
- attendu : `client_id=1318593163521022`, `config_id=1477522770514809`
- puis la fenêtre Facebook doit afficher « Réassocier … à Studiio » sans erreur.

## Fixes de code à préparer (session Claude Code) — pour éviter que ça recommence
1. **Incohérence connect/callback** : la connexion lit `META_INSTAGRAM_APP_ID`
   pour l'appId Facebook, mais le callback lit `FACEBOOK_CLIENT_ID`. → Unifier
   sur une seule variable d'app Facebook (sinon il faut garder 2 variables
   synchronisées, source du bug « Error validating client secret »).
2. **Texte « Vercel » trompeur** : les messages d'erreur disent « variables
   d'environnement Vercel » alors que c'est Coolify. → Remplacer par un libellé
   neutre (« variables d'environnement »).
