# Pre-PR Checklist — Anti-régression Studiio

_À relire AVANT chaque merge. Écrit après les régressions de fin avril / début mai 2026._

---

## Le minimum (obligatoire à chaque PR)

### Avant de coder
- [ ] **Grep avant modif** : `grep -n "<state-clé>"` sur le fichier ciblé. Si > 1 occurrence, lister TOUTES les places à toucher dans le PR description.
- [ ] **Lire `tasks/lessons.md`** — cherche-y le pattern du bug que tu vas fixer (peut-être déjà documenté).

### Pendant le code
- [ ] **Flag default=false / champ optional** pour TOUT changement. Garantit comportement identique aux configs existantes.
- [ ] **try/finally** autour des state mutations temporaires (snapshot, capture, sequence override) — restore dans finally même si throw.
- [ ] **Logger les itérations critiques** (batch loops, async pipelines) avec un identifiant (`[Batch X/N] step=...`) — sans logs, les bugs silencieux sont indétectables.

### Avant de merger
- [ ] **Push branche → attendre Vercel preview deployment** (~45-60s). Aller sur l'URL de preview, **PAS le local**.
- [ ] **Hard-refresh** (Cmd+Shift+R) sur la preview pour éviter le cache du bundle précédent.
- [ ] **Tester le user-flow EXACT du fix** : si tu fixes batch x3, lance batch x3 sur la preview.
- [ ] **Smoke test** : 1 flux non lié à ta PR. Suggéré : batch x3 calendrier avec rush vidéo + 3 photos pickées manuellement.
- [ ] **Console F12** : pas de nouvelles erreurs ou warnings rouges introduits par ta PR.

---

## Les 7 flux critiques (smoke tests à connaître par cœur)

Quand tu doutes, tester ces flux. Si tous passent, ta PR n'a pas cassé l'app.

1. **Login + landing dashboard** — page charge sans erreur console
2. **/creer charge avec un thème par défaut** — preview affichée, cartes générées
3. **Batch x3 calendrier** — 3 posts visibles dans le mois courant avec photos différentes
4. **Batch x3 bureau** — 3 MP4 téléchargés (suffixe `-1`, `-2`, `-3`)
5. **Persistance** — modifier titre → cliquer "Calendrier" sidebar → revenir → modif intacte
6. **Mix audio preview** — bouton "Écouter le mixage" joue music + voix off + son rush
7. **Export sans chrome** — vidéo finale sans rings roses, sans bordures de hover, sans tooltips

Aucun outil automatisé pour le moment ; tout est manuel sur preview Vercel.
Ce sera automatisé en étape 3 (Playwright E2E sur preview Vercel + GitHub Action).

---

## Anti-patterns interdits

À NE JAMAIS faire dans une PR (même "petite") :

❌ **Modifier 1 endroit sans grep les autres** — le bug ré-émerge en 30 min sur un autre flux.

❌ **Refactor + fix dans la même PR** — séparer en 2 PRs, fix d'abord, refactor après.

❌ **`while I'm here` cleanup** — toute amélioration non liée au fix → PR séparée.

❌ **Suppression silencieuse de fallback** sans throw/log explicite — `catch {}` produit un bug invisible.

❌ **Ajouter un nouveau service externe gratuit** (TTS gratuit, scrape API, CDN public) sans fallback payant prévu — observé 2x avec msedge-tts qui plante random.

❌ **Modifier le composer (video-composer.ts) pour une feature non-vidéo** — extension du pipeline canvas = refactor dangereux. Préférer un nouveau path indépendant (DOM screenshot, JSZip, etc.).

❌ **Pousser sans hard-refresh sur preview** — bundle cache → tu testes l'ancien code → tu déclares OK → la régression est en prod.

---

## Règles méta — comment réagir aux retours utilisateur

Quand l'utilisateur rapporte un bug :

1. **Reproduire d'abord** — ne pas commencer à coder avant d'avoir vu le bug. Si pas reproductible → demander logs console + URL preview.

2. **Vérifier la visibilité avant le code** — si "1 post au lieu de N", est-ce que les N-1 sont juste hors-vue (mois suivant, filtre, page) ?

3. **Lire les logs avec un peigne fin** — un `[Composer] proxy failed` enseveli sous 1000 `Drawing cards from SNAPSHOT` peut être LE root cause.

4. **Diff la PR contre la PR précédente** — si une feature marchait avant et plus maintenant, comparer le diff entre les 2 PRs concernées avant de fixer ailleurs.

5. **Toujours vérifier qu'on est sur la bonne deployment** — `dpl_XXX` dans le footer console des logs = identifiant Vercel. Si le user teste un dpl ancien, le fix qu'on vient de pusher n'est pas encore là.

---

## Quand ce checklist devient obsolète

Étape 3 (Playwright E2E) fera la majorité de ces tests automatiquement. À ce moment-là :

- Ce fichier passe de "obligatoire" à "guide manuel pour les flux non-couverts"
- Les 7 flux critiques deviennent des tests `e2e/critical-flows.spec.ts`
- La CI bloque les PR qui font régresser ces flux

Tant que l'étape 3 n'est pas en place : **suivre cette checklist à la lettre**.
