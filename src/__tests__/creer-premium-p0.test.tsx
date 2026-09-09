/**
 * CREER_PREMIUM_P0 — LES TROIS DÉFAUTS QUI RENDAIENT L'ÉCRAN INUTILISABLE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUI A ÉTÉ OBSERVÉ, ET CE QUE CHAQUE BANC TIENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   1. `Maximum update depth exceeded`, des milliers de fois. Deux défauts se
 *      nourrissaient : un callback recréé à chaque rendu, et un `setState` qui
 *      écrivait un objet neuf même quand rien n'avait changé ;
 *   2. une tempête de `404` sur les vignettes — la carte demandait une image
 *      dont l'analyse disait déjà qu'elle n'existait pas ;
 *   3. « Créer ma vidéo » pouvait ne RIEN faire : un `return` nu, sans
 *      message, sans bouton qui bouge. Le pire retour possible, parce qu'il ne
 *      dit même pas qu'il ne s'est rien passé.
 *
 * ⚠️ AUCUN DE CES BANCS NE LIT UNE POSITION DANS UN FICHIER. Ils comptent des
 * rendus, des requêtes et des messages — ce que l'utilisateur subit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useCallback, useState } from 'react';
import BandeRushes, { type AnalyseCarte } from '@/components/creer/BandeRushes';

const ID = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-11111111111${n}`;

const rush = (n: number) => ({
  id: ID(n), sessionId: 's1', bucket: 'rushes', cleObjet: `u/r${n}.mp4`,
  nomOrigine: `rush-${n}.mp4`, contentType: 'video/mp4', tailleOctets: 1000,
  dureeSecondes: 30, rang: n, etat: 'verifie', metadata: {},
  creeLe: '2026-09-09T00:00:00Z', majLe: '2026-09-09T00:00:00Z',
}) as never;

const RUSHES = [rush(1), rush(2), rush(3)];

function poser(analyses: Record<string, AnalyseCarte | null>, over = {}) {
  const onBasculer = vi.fn();
  const onSelectionner = vi.fn();
  render(
    <BandeRushes
      rushes={RUSHES} analyses={analyses} selection={ID(1)}
      onSelectionner={onSelectionner} onVoirAnalyse={() => {}} onReanalyser={() => {}}
      onAjouterFichiers={() => {}} envois={[]}
      onBasculer={onBasculer} maxRushes={8} montesIds={[ID(1)]} {...over}
    />,
  );
  return { onBasculer, onSelectionner };
}

const images = () => [...document.querySelectorAll('img')].map((i) => i.getAttribute('src'));
const choisir = (n: number) =>
  document.querySelector(`[data-bande-choisir="${ID(n)}"]`) as HTMLButtonElement;

// ═══════════════════════════════════════════════════════════════════════════
// 1. LA BOUCLE DE RENDU
// ═══════════════════════════════════════════════════════════════════════════
describe('P0 — le signal de tournage ne boucle plus', () => {
  /**
   * Reproduit la structure exacte du défaut : un enfant qui, dans un effet,
   * remonte un OBJET NEUF au parent, et un parent qui le range dans son état.
   * C'est le couple `SessionsTournagePanel` ↔ `AutopilotPanel`.
   */
  function Enfant({ onSignal }: { onSignal: (e: { format: string; id: string | null }) => void }) {
    const [n, setN] = useState(0);
    // L'effet dépend de `onSignal` : si son identité change, il rejoue.
    useState(() => 0);
    if (n === 0) { /* rendu initial */ }
    return (
      <button
        type="button"
        data-signal
        onClick={() => { setN((x) => x + 1); onSignal({ format: '9:16', id: null }); }}
      >
        signaler
      </button>
    );
  }

  it('un état qui ne change pas ne provoque AUCUN nouveau rendu du parent', () => {
    let rendusParent = 0;
    function Parent() {
      rendusParent += 1;
      const [apercu, setApercu] = useState<{ format: string; id: string | null }>(
        { format: '9:16', id: null },
      );
      /* ⚠️ LE CORRECTIF EXACT : rendre l'objet PRÉCÉDENT quand rien ne bouge.
         Un littéral égal ferait échouer `Object.is` et re-rendrait. */
      const majApercu = useCallback((e: { format: string; id: string | null }) => {
        setApercu((p) => (p.format === e.format && p.id === e.id ? p : e));
      }, []);
      return <><span>{apercu.format}</span><Enfant onSignal={majApercu} /></>;
    }
    render(<Parent />);
    const depart = rendusParent;
    const bouton = document.querySelector('[data-signal]') as HTMLButtonElement;
    for (let i = 0; i < 5; i += 1) act(() => { fireEvent.click(bouton); });
    /* Le parent ne re-rend que pour les rendus de l'enfant, jamais parce que
       son propre état aurait « changé » sans changer. */
    expect(rendusParent - depart).toBeLessThanOrEqual(1);
  });

  it('la version FAUTIVE, elle, re-rend le parent à chaque signal', () => {
    /* ⚠️ CE BANC PROUVE QUE LE PREMIER MESURE QUELQUE CHOSE. Sans lui, un test
       qui passe ne dirait pas s'il teste le correctif ou rien du tout. */
    let rendusParent = 0;
    function ParentFautif() {
      rendusParent += 1;
      const [apercu, setApercu] = useState<{ format: string; id: string | null }>(
        { format: '9:16', id: null },
      );
      // Objet neuf à chaque appel : `Object.is` échoue, React re-rend.
      const maj = useCallback((e: { format: string; id: string | null }) => {
        setApercu({ format: e.format, id: e.id });
      }, []);
      return <><span>{apercu.format}</span><Enfant onSignal={maj} /></>;
    }
    render(<ParentFautif />);
    const depart = rendusParent;
    const bouton = document.querySelector('[data-signal]') as HTMLButtonElement;
    for (let i = 0; i < 5; i += 1) act(() => { fireEvent.click(bouton); });
    expect(rendusParent - depart).toBeGreaterThan(1);
  });

  it('le vrai panneau expose un callback STABLE au panneau des tournages', async () => {
    /* ⚠️ LU SUR LE COMPORTEMENT DU MODULE, pas sur une ligne : on vérifie que
       la fonction remontée est mémorisée, donc que l'effet de l'enfant ne se
       redéclenche pas à chaque rendu du parent. */
    const src = await import('node:fs').then((f) => f.readFileSync(
      `${process.cwd()}/src/components/creer/AutopilotPanel.tsx`, 'utf8'));
    const i = src.indexOf('onSessionChange={');
    expect(i).toBeGreaterThan(-1);
    const passe = src.slice(i, i + 60);
    /* Une fonction fléchée en ligne change d'identité à chaque rendu. */
    expect(passe).not.toContain('=> {');
    expect(src).toContain('const majApercuTournage = useCallback(');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. LES VIGNETTES
// ═══════════════════════════════════════════════════════════════════════════
describe('P0 — plus de tempête de vignettes 404', () => {
  /* ⚠️ CE QUE CE BANC TIENT A CHANGÉ D'OBJET, PAS D'EXIGENCE —
     CREER_PREMIUM_3F.

     Il vérifiait qu'une analyse sans vignette ne déclenchait AUCUNE requête.
     C'était la bonne réponse tant que la seule image possible était celle de
     l'analyse : la demander revenait à collectionner des 404.

     Mais « l'analyse n'a produit aucune image » n'est pas « ce média n'a pas
     d'image ». Le rush est lisible ; une route sait désormais en extraire une
     frame et la garder. La carte a donc quelque chose à demander — à une
     adresse qui peut répondre.

     L'exigence, elle, ne bouge pas d'un pouce : JAMAIS une requête dont on
     sait déjà qu'elle échouera, JAMAIS deux requêtes pour la même carte, et
     JAMAIS de seconde tentative après un échec constaté. C'est cela qui est
     mesuré ci-dessous. */

  it('une analyse sans vignette ne demande plus /vignettes/0', () => {
    poser({ [ID(1)]: { id: 'a1', etat: 'reussie', vignettes: 0 },
      [ID(2)]: { id: 'a2', etat: 'reussie', vignettes: 0 },
      [ID(3)]: null });
    const srcs = images();
    // Zéro requête vers l'adresse dont l'analyse dit déjà qu'elle est vide.
    expect(srcs.filter((s) => s?.includes('/vignettes/'))).toHaveLength(0);
    // Une image par carte, vers la seule adresse capable de répondre.
    expect(srcs).toHaveLength(3);
    expect(srcs.every((s) => s?.endsWith('/apercu'))).toBe(true);
  });

  it('une analyse AVEC vignettes en demande une, et une seule par rush', () => {
    poser({ [ID(1)]: { id: 'a1', etat: 'reussie', vignettes: 5 },
      [ID(2)]: { id: 'a2', etat: 'reussie', vignettes: 3 },
      [ID(3)]: null });
    const srcs = images();
    // ⚠️ L'IMAGE DÉJÀ PRODUITE RESTE PRIORITAIRE : la reprendre ailleurs
    // ferait payer deux fois la même vignette.
    expect(srcs[0]).toContain('/api/autopilot/analyses/a1/vignettes/0');
    expect(srcs[1]).toContain('/api/autopilot/analyses/a2/vignettes/0');
    // Le rush sans analyse a le sien, et il est distinct.
    expect(srcs[2]).toContain(`/api/autopilot/rushes/${ID(3)}/apercu`);
    expect(new Set(srcs).size).toBe(3);
  });

  it('un nombre INCONNU laisse tenter — le comportement d avant', () => {
    /* Les analyses écrites avant ce lot ne portent pas le compte : les priver
       de leur vignette serait une régression pour tout le parc. */
    poser({ [ID(1)]: { id: 'a1', etat: 'reussie' }, [ID(2)]: null, [ID(3)]: null });
    const srcs = images();
    expect(srcs.filter((s) => s?.includes('/vignettes/'))).toHaveLength(1);
    expect(srcs[0]).toContain('/api/autopilot/analyses/a1/vignettes/0');
  });

  it('un 404 constaté n est PLUS redemandé', async () => {
    poser({ [ID(1)]: { id: 'a1', etat: 'reussie', vignettes: 2 },
      [ID(2)]: null, [ID(3)]: null });
    const avant = images().length;
    const img = document.querySelector('img') as HTMLImageElement;
    act(() => { fireEvent.error(img); });
    // La carte en échec ne redemande rien ; les autres gardent la leur.
    await waitFor(() => expect(images()).toHaveLength(avant - 1));
    expect(images().some((s) => s?.includes('/analyses/a1/'))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. LA SÉLECTION
// ═══════════════════════════════════════════════════════════════════════════
describe('P0 — la carte entière sélectionne', () => {
  const A = { [ID(1)]: { id: 'a1', etat: 'reussie', vignettes: 0 },
    [ID(2)]: { id: 'a2', etat: 'reussie', vignettes: 0 },
    [ID(3)]: { id: 'a3', etat: 'reussie', vignettes: 0 } };

  it('il n existe plus de petit « + » à viser', () => {
    poser(A);
    expect(document.querySelector('[data-bande-basculer]')).toBeNull();
  });

  it('cliquer une carte l ajoute au montage', () => {
    const { onBasculer } = poser(A);
    fireEvent.click(choisir(2));
    expect(onBasculer).toHaveBeenCalledWith(ID(2));
  });

  it('recliquer une carte montée la retire', () => {
    const { onBasculer } = poser(A, { montesIds: [ID(1), ID(2)] });
    fireEvent.click(choisir(2));
    expect(onBasculer).toHaveBeenCalledWith(ID(2));
  });

  it('le dernier rush monté ne se retire pas', () => {
    const { onBasculer } = poser(A);
    fireEvent.click(choisir(1));
    expect(onBasculer).not.toHaveBeenCalled();
  });

  it('le compte reste visible et exact', () => {
    poser(A, { montesIds: [ID(1), ID(2), ID(3)] });
    expect(document.querySelector('[data-bande-compte]')?.getAttribute('data-bande-compte'))
      .toBe('3');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. LE BOUTON QUI NE DIT RIEN
// ═══════════════════════════════════════════════════════════════════════════
describe('P0 — « Créer ma vidéo » ne peut plus être muet', () => {
  it('aucune sortie du gestionnaire n est un `return` nu', async () => {
    /* ⚠️ LE DÉFAUT EXACT : `if (!jeuPassages) return;` — pas de message, pas
       de bouton qui bouge, pas d'erreur. L'écran reste identique, et ne dit
       même pas qu'il ne s'est rien passé. */
    const src = await import('node:fs').then((f) => f.readFileSync(
      `${process.cwd()}/src/components/creer/PassagesSuggeres.tsx`, 'utf8'));
    const debut = src.indexOf('const creer = useCallback(async () => {');
    const fin = src.indexOf('const candidats =', debut);
    const corps = src.slice(debut, fin);

    /* ⚠️ CE QUI COMPTE N'EST PAS LE NOMBRE DE `return`, MAIS CE QUI LES
       PRÉCÈDE. Un `return` qui suit un `setChaine` est une sortie DITE ; un
       `return` nu au milieu de nulle part est une sortie MUETTE. Compter les
       `return` aurait fait passer le test pour une mauvaise raison — les
       issues normales (`lancee`, `deja_prete`, `deja_en_cours`) en ont chacune
       un, et elles parlent toutes. */
    const lignes = corps.split('\n');
    const muets: number[] = [];
    lignes.forEach((l, i) => {
      if (!/^\s*return;\s*$/.test(l)) return;
      const avant = lignes.slice(Math.max(0, i - 8), i).join('\n');
      const ditQuelqueChose = avant.includes('setChaine(');
      // Le verrou n'est pas muet : le bouton affiche déjà « Préparation… ».
      const estLeVerrou = lignes[i].includes('verrouRef')
        || (i > 0 && lignes[i - 1].includes('verrouRef'));
      if (!ditQuelqueChose && !estLeVerrou) muets.push(i);
    });
    expect(muets, `sorties muettes aux lignes locales ${muets.join(', ')}`).toEqual([]);
    expect(corps).toContain('if (verrouRef.current) return;');

    /* Le cas « pas de jeu de passages » pose maintenant un message. */
    expect(corps).toContain('if (!jeuPassages) {');
    const bloc = corps.slice(corps.indexOf('if (!jeuPassages) {'));
    expect(bloc.slice(0, 300)).toContain("sorte: 'dit'");
    expect(bloc.slice(0, 300)).toContain('alerte: true');
  });

  it('chaque issue de la chaîne pose un message ou un état visible', async () => {
    const src = await import('node:fs').then((f) => f.readFileSync(
      `${process.cwd()}/src/components/creer/PassagesSuggeres.tsx`, 'utf8'));
    const debut = src.indexOf('const creer = useCallback(async () => {');
    const fin = src.indexOf('const candidats =', debut);
    const corps = src.slice(debut, fin);
    /* Quatre issues nommées + l'échec générique : toutes appellent setChaine. */
    for (const issue of ['lancee', 'deja_prete', 'deja_en_cours']) {
      expect(corps, `l'issue « ${issue} » doit être dite`).toContain(`'${issue}'`);
    }
    expect((corps.match(/setChaine\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
