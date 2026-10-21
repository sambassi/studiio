# Règles UX premium — Studiio (permanentes)

> Demandées par l'utilisateur le 2026-10-21. S'appliquent à TOUTE l'interface :
> Tableau de bord, Créer, Autopilote, Mon avatar, Calendrier, Bibliothèque,
> Média, Réseaux sociaux, Réglages, Administration. À relire avant toute
> modification d'interface. Référencées depuis `CLAUDE.md`.

## Principe

Une interface **épurée, classe, premium et discrète**. Aucune page ne doit
afficher trop d'informations ou d'explications à la fois. L'utilisateur
obtient le détail **quand il le demande**, en cliquant sur une icône.

## Règles

1. **Icônes SVG** — petites icônes lucide uniformes (même taille, même trait)
   pour les informations et actions secondaires. Jamais d'emoji (voir
   « Icônes — RÈGLE ABSOLUE » dans `CLAUDE.md`).
2. **Icône plutôt que gros bouton texte** pour une action secondaire ; le
   libellé reste disponible pour l'accessibilité (`aria-label`, infobulle).
3. **Respiration** — espacements généreux, typographie hiérarchisée (un titre,
   une ligne utile ; pas de pavés).
4. **Moins de bruit** — pas de doublons, pas de descriptions interminables,
   pas d'encadrés inutiles, pas de précisions techniques toujours visibles.
5. **Le détail à la demande** — explications, fonctionnement, précisions
   techniques : derrière une icône d'information (`Info`) qui ouvre un
   popover ou un panneau léger.
6. **Panneaux accessibles** — fermables (bouton, `Échap`, clic extérieur),
   utilisables au clavier (focus, `Entrée`/`Espace`), sur mobile (tap, pas
   de survol seul), avec libellés accessibles (`aria-label`,
   `aria-expanded`, `aria-controls`).
7. **Pas d'icône décorative** — toute icône affichée seule déclenche une
   action ou ouvre une information.
8. **Ne jamais masquer pour épurer** : information de sécurité, coût ou
   débit, erreur, progression critique, action principale, consentement.
   Ces éléments restent visibles.
9. **Identité Studiio** — tokens et couleurs existants (voir mémoire
   « Identité visuelle Studiio ») ; pas de nouvelle palette.
10. **Pas de nouvelle dépendance d'interface** si les composants existants
    suffisent (`src/components/ui/*`).
11. **Bandeaux et invitations** (installation de l'app, astuces…) : discrets,
    fermables, et la fermeture est mémorisée.

## Application

- Toute PR qui touche l'interface vérifie ces règles (Playwright ordinateur,
  tablette et téléphone ; aucun débordement ; informations consultables via
  les icônes).
- L'application à l'ensemble des pages se fait **progressivement**, dans des
  PR UX distinctes, après accord de l'utilisateur — pas en bloc dans une PR
  fonctionnelle.
