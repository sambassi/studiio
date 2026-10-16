# Dette RGPD — purge du stockage à la suppression d'un compte

> Constat vérifié le 2026-10-16 dans le code (lot M2-a). **Aucun code de purge dans ce lot** :
> ce document décrit la dette ; la purge relève d'un lot séparé.

## État réel

| Point | Où | Constat |
|-------|----|---------|
| Callback Meta « Data Deletion » | `src/app/api/data-deletion/route.ts` | **Stub**. Le POST journalise la demande (« In production, you would delete user data here ») et renvoie un code de confirmation ; le GET répond `status: 'completed'` / « Your data has been deleted » **sans rien avoir supprimé**. |
| Suppression d'un compte (admin) | `src/app/api/admin/users/[id]/route.ts` (~139) | **Soft delete** : `users.deleted_at = now()`. Aucune ligne liée ni aucun objet de stockage n'est supprimé. |
| Suppression par l'utilisateur lui-même | — | Aucune route trouvée. |
| Médias du compte | MinIO `media/<uid>/…`, `audio/<uid>/…`, `videos/<uid>/…` | **Aucune purge** liée au compte. Seule la rétention temporaire (`/api/cron/cleanup-media`) retire des fichiers selon l'âge et les références, jamais selon la suppression du compte. |
| Attributions stock | `media/stock-attributions/<uid>/…json` | **Durables** (`estFichierDurable`) : jamais purgées. |
| Fiches de contenu (M2-a) | `media/fiches-contenu/<uid>/analyse/<sha1>.<taille>.v1.json` | **Durables** (`estFichierDurable`) : jamais purgées, ni à la suppression du compte ni quand le rush disparaît. |
| Fiches orphelines | idem | Le rush peut expirer par la rétention (vidéo : 24 h hors références) alors que sa fiche reste. Contenu : identifiants de catégories fermées, confiance, sources — aucune URL, aucun texte fournisseur, aucun visage. Quelques centaines d'octets par rush. |
| Audio complet payé | `audio/audio-complet/<uid>/…mp3` | Durable, non purgé. |

## Risques

- Le callback Meta **affirme** une suppression qui n'a pas eu lieu.
- Un compte supprimé garde ses médias, attributions, fiches et audios payés indéfiniment.
- Les fiches orphelines s'accumulent (faible volume, mais sans limite).

## TODO — lot de purge séparé (pas dans M2-a)

1. Définir la politique : suppression réelle ou anonymisation, délai de grâce, ce qui doit être gardé pour la comptabilité (paiements, crédits).
2. Purge MinIO par compte : `media/<uid>/`, `audio/<uid>/`, `videos/<uid>/`, `media/stock-attributions/<uid>/`, `media/fiches-contenu/<uid>/`, `audio/audio-complet/<uid>/`. Liste puis suppression bornée, avec journal, sans joker côté shell.
3. Brancher la purge sur la suppression de compte (admin et, à créer, en libre-service), puis sur `/api/data-deletion` (rapprochement de l'identifiant Meta avec le compte Studiio) ; le GET ne doit rendre `completed` qu'après une purge effective.
4. Fiches orphelines : les retirer quand le rush source n'existe plus (passage du cron de rétention, ou fiche expirée N jours après la disparition du rush).
5. Tests : purge d'un compte A sans toucher B ; idempotence ; reprise après panne.
