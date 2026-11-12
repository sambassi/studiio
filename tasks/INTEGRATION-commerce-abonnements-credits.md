# Intégration — `feat/commerce-abonnements-credits`

> **Rien n'est fusionné, poussé ni déployé.** Ce dossier prépare l'intégration
> et s'arrête là. Chaque action qui touche `main`, la base de production, le
> compte Stripe ou un compte marchand demande une autorisation explicite.

État au 2026-11-12, après vérification : **l'intégration est prête, sans
conflit bloquant.**

---

## 1. Position de la branche

| | |
|---|---|
| Branche | `feat/commerce-abonnements-credits` |
| Part de | `origin/main` **8c9854b** |
| `origin/main` aujourd'hui | **8c9854b** — inchangé depuis le départ |
| Avance | **12 commits**, aucun commit de `main` manquant |
| Surface | 130 fichiers, l'essentiel en modules neufs |

**Aucun rebase n'est nécessaire, et aucun rebase ne doit être fait.** La
branche est un *fast-forward* direct sur `main` : l'historique des 12 commits
part tel quel, sans réécriture et sans squash.

> Le rapport précédent annonçait 11 commits. Un douzième a été ajouté depuis :
> un dernier appel à la banque d'images avait échappé à la première passe (son
> `fetch(` et son URL sont sur deux lignes). Il a été repéré par l'E2E, pas par
> une relecture — et `/dashboard/creer` est désormais couvert.

---

## 2. Conflits réels avec les autres chantiers

Mesurés par simulation de fusion (`git merge-tree`, aucune écriture), puis
**isolés** : pour chaque branche, les conflits qu'elle a *déjà* avec `main`
seule sont retranchés. Ce qui reste est imputable à ce lot, et rien d'autre.

| Chantier | Branche | Conflits avec `main` seule | **Imputables à ce lot** |
|---|---|---|---|
| Créer / LUT | `feat/lut-etalonnage-rush` | **32 fichiers** | **aucun** |
| Cinéma IA | `feat/cinema-wizard` | 15 fichiers | **aucun** |
| Cinéma IA | `feat/cinema-higgsfield-references` | 0 | `tasks/lessons.md` |
| Cinéma IA | `feat/cinema-scenes-guide` | 0 | `tasks/lessons.md` |
| Créer | `feat/creer-guide-20261104` | 0 | **aucun** |

**Le seul conflit que ce lot introduit, où que ce soit, est
`tasks/lessons.md`** — un fichier que tous les chantiers complètent par la
fin. Résolution : **garder les deux blocs**, dans l'ordre chronologique.
Aucune décision à prendre.

### Ce qui n'est PAS de notre fait

`feat/lut-etalonnage-rush` est **490 commits en retard** sur `main` : ses 32
conflits existent déjà aujourd'hui, sans nous, sur `next.config.js`,
`video-composer.ts`, `creer-simple/page.tsx`, les LUTs, etc. Fusionner ce lot
ne les aggrave pas et n'en ajoute pas un seul. Même constat pour
`feat/cinema-wizard`.

### Travail non commité du worktree principal

103 fichiers y sont modifiés et non commités. **Deux** touchent aussi ce lot :

- `src/app/dashboard/creer/AssistantWizard.tsx` — ce lot y change **2 lignes**
  (chemins de recherche de photos) ; le travail en cours y ajoute 4 lignes
  **ailleurs dans le fichier**. Aucun recouvrement de lignes.
- `tasks/lessons.md` — ajout en fin de fichier, des deux côtés.

Rien n'a été modifié dans ce worktree, ni dans aucun autre.

---

## 3. Tests vérifiés pour l'intégration

| | |
|---|---|
| Suite complète | **16 067 tests passent**, 743 fichiers |
| E2E Playwright | **26 tests**, ordinateur et mobile, compte **non administrateur** |
| Paiements réels | **aucun** — un garde *aborte* toute requête d'encaissement |
| Appels IA payants | **aucun** |

Trois échecs intermittents ont été observés sous charge parallèle au cours du
chantier, tous verts isolément et tous sans rapport avec ce lot : un test de
montage de 265 s dont le hook dépasse 180 s, une assertion de performance
(55 ms mesurés pour < 50 ms attendus), et une minuterie de la page
infographie qui se déclenche après le démontage de jsdom.

---

## 4. Ordre exact : migration de remboursement puis bascule des appelants

La procédure complète — préconditions, droits, contrôles, retour arrière — est
dans **`migrations/2026-10-30-remboursement-credits-operation.procedure.md`**.
Résumé de l'ordre, qui ne souffre aucune inversion :

### Étape 0 — Sauvegarde vérifiée (avant toute chose)

```bash
docker exec studiio-db pg_dump -U studiio -d studiio -Fc \
  -f /tmp/avant-remboursement-$(date +%F).dump
docker cp studiio-db:/tmp/avant-remboursement-$(date +%F).dump ./
# VÉRIFIER la sauvegarde, ne pas se contenter de la produire :
pg_restore --list avant-remboursement-$(date +%F).dump | head
#   → doit lister les objets ; une archive tronquée échoue ici, pas le jour
#     où on en a besoin.
ls -lh avant-remboursement-$(date +%F).dump   # taille non nulle, cohérente
```

La base est par ailleurs sauvegardée quotidiennement à 03h00 par Coolify.

### Étape 1 — Fusionner la branche

Rien dans ce lot n'appelle la fonction de remboursement : la fusion est
indépendante de la migration et peut la précéder sans risque.

### Étape 2 — Appliquer la migration

```bash
docker exec -i studiio-db psql -U studiio -d studiio -v ON_ERROR_STOP=1 \
  < migrations/2026-10-30-remboursement-credits-operation.sql
docker kill -s SIGUSR1 studiio-postgrest
```

> ⚠️ **Avec le rôle des migrations (`studiio`), pas en superutilisateur.** Les
> privilèges par défaut posés le 29/09 n'ouvrent la fonction à `service_role`
> que si elle est créée par ce rôle. Jouée autrement, elle produirait un
> remboursement qui échoue sans erreur visible à l'application.

### Étape 3 — Contrôles (lecture seule, dans l'ordre)

Les quatre requêtes sont dans la procédure. La décisive est la troisième :

```sql
select has_function_privilege(
  'service_role',
  'public.rembourser_credits_operation(uuid,integer,text,text)', 'EXECUTE');
-- attendu : true
```

### Étape 4 — **Seulement ensuite**, basculer les quatre appelants

`src/app/api/avatar/generate/route.ts`, `src/lib/avatar/moteur-jumeau.ts`
(deux endroits), `src/lib/avatar/statut.ts` et
`src/app/api/admin/users/[id]/credits/route.ts` passent encore par
`addCredits` — atomique sur le solde, mais **ni idempotent ni protégé contre
deux remboursements concurrents**.

**Les basculer avant l'étape 2 ferait échouer tout remboursement en
production** : la fonction n'existerait pas. Ce lot ne les touche donc pas.
C'est un chantier séparé, à ouvrir après les contrôles de l'étape 3.

### Retour arrière

```bash
docker exec -i studiio-db psql -U studiio -d studiio -v ON_ERROR_STOP=1 \
  < migrations/rollback/2026-10-30-remboursement-credits-operation.rollback.sql
docker kill -s SIGUSR1 studiio-postgrest
```

Il supprime **la fonction et rien d'autre**. Aucun solde repris, aucune ligne
effacée : les remboursements déjà écrits sont des lignes `credit_transactions`
de type `refund`, un type accepté bien avant cette migration.

---

## 5. Les trois tarifs d'avatar déficitaires — **non activés**

Au taux de référence BCE du 11/11/2026 (1 USD = 0,82987 CHF) et à l'échelle
conservée (0,0817 CHF le crédit, tarif Pro), pour une génération au plafond de
script (1 200 caractères ≈ 86 s), moteur et type d'avatar au pire cas :

| Tarif | Prix actuel | Coût fournisseur | Encaissé | **Marge** | Plancher | **Conseillé** |
|---|---|---|---|---|---|---|
| Qualité | 40 crédits | 6,92 USD | 3,27 CHF | **−2,48 CHF** | 71 | **99** |
| Premium | 40 crédits | 10,32 USD | 3,27 CHF | **−5,30 CHF** | 105 | **147** |
| Jumeau numérique | 40 crédits | 6,92 USD | 3,27 CHF | **−2,48 CHF** | 71 | **99** |

Pour mémoire, le quatrième est sain : **Standard**, 40 crédits pour 1,42 USD
de coût, **+2,09 CHF** de marge.

- **Plancher** = seuil d'équilibre, arrondi au crédit supérieur.
- **Conseillé** = plancher + la marge visée (40 %, réglable).
- Ordre de grandeur : cent générations Premium par mois coûtent **530 CHF** de
  plus qu'elles ne rapportent.

**Aucun de ces prix n'est appliqué.** Ils s'affichent dans `/admin/tarifs` à
côté du prix en vigueur, avec le bouton « Appliquer les prix conseillés » qui
**remplit les champs sans enregistrer** — la confirmation habituelle liste
ensuite chaque changement, un par un.

Les trois formules proposées (12,90 / 34,90 / 69,90 CHF pour 200 / 550 / 1 100
crédits) **supposent ces prix corrigés**. Tant qu'un avatar se vend 40 crédits,
il devient la pire façon de dépenser son quota et 12,90 CHF n'achètent plus
que 60 crédits.

---

## 6. Ce qui demande une autorisation

1. **Créer la Pull Request et pousser la branche** — rien n'est poussé.
2. **Fusionner dans `main`.**
3. **Appliquer la migration de remboursement** (base de production).
4. **Basculer les quatre appelants** — après la migration, lot séparé.
5. **Enregistrer la valeur du crédit et le taux** dans `/admin/tarifs`, sans
   quoi les verdicts de rentabilité restent « inconnus ».
6. **Appliquer les trois prix d'avatar.**
7. **Activer TWINT / PayPal** dans le Dashboard Stripe — le code ne les bride
   plus, mais aucun réglage Stripe n'a été touché.
8. **Ouvrir le Mobile Money** — bloqué par l'absence d'un compte marchand
   indépendant. Le module reste fermé ; afroboost n'a pas été touché.

---

## 7. Commande de création de la PR (à exécuter sur autorisation)

```bash
cd /Users/afroboost/studiio-commerce
git push -u origin feat/commerce-abonnements-credits
gh pr create --draft \
  --base main --head feat/commerce-abonnements-credits \
  --title "Commerce : abonnements, crédits, rentabilité et confidentialité des fournisseurs" \
  --body-file tasks/PR-commerce-abonnements-credits.md
```

Fusion en **merge commit**, pas en squash : les 12 commits racontent chacun
une décision et doivent rester lisibles séparément.
