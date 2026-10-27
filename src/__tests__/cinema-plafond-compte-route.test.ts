/**
 * CÂBLAGE DU PLAFOND DE DÉPENSE PAR COMPTE DANS LA ROUTE DE GÉNÉRATION.
 *
 * `cinema-plafond-compte.test.ts` prouve le module lui-même (mocké) ;
 * `tests-pg/cinema-plafond-compte.pg.test.ts` prouve l'atomicité réelle.
 * Ce fichier prouve que la ROUTE l'utilise dans le BON ORDRE et pour le
 * BON MOTIF — par lecture du source, comme le reste de `cinema-credits-
 * generation.test.ts` pour le câblage des crédits.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const r = readFileSync('src/app/api/cinema/films/[id]/generation/route.ts', 'utf8');
const atelier = readFileSync('src/lib/cinema/generation/atelier.ts', 'utf8');
const fournisseur = readFileSync('src/lib/cinema/generation/fournisseur.ts', 'utf8');

describe('la route réserve la dépense AVANT les crédits, et la libère si les crédits refusent', () => {
  it('importe les deux fonctions du plafond de compte', () => {
    expect(r).toContain("import { reserverDepenseReplicate, confirmerDepenseReplicate, type StatutDepense } from '@/lib/cinema/generation/plafond-compte';");
  });

  it('le devis USD de la tentative est calculé AVANT tout débit, avec la même fonction que l’atelier', () => {
    expect(r).toContain("import { devisGeneration } from '@/lib/cinema/generation/couts';");
    const iDevis = r.indexOf('devisGeneration(fournisseurId');
    const iReserverCredits = r.indexOf('await reserverCredits(');
    expect(iDevis).toBeGreaterThan(0);
    expect(iDevis).toBeLessThan(iReserverCredits);
  });

  it('la dépense est réservée AVANT les crédits — rien n’est débité si le plafond refuse', () => {
    const iReserverDepense = r.indexOf('await reserverDepenseReplicate(');
    const iReserverCredits = r.indexOf('await reserverCredits(');
    expect(iReserverDepense).toBeGreaterThan(0);
    expect(iReserverDepense).toBeLessThan(iReserverCredits);
  });

  it('un refus du plafond de dépense retourne AVANT d’appeler les crédits', () => {
    const bloc = r.slice(r.indexOf('await reserverDepenseReplicate('), r.indexOf('await reserverCredits('));
    expect(bloc).toMatch(/if \(!depense\.ok\) return \{ ok: false as const, motif: depense\.motif, message: depense\.message \};/);
  });

  it('si les crédits refusent APRÈS la réservation de dépense, elle est LIBÉRÉE avant de répondre', () => {
    const iPrise = r.indexOf('const prise = await reserverCredits(');
    const bloc = r.slice(iPrise, iPrise + 700);
    expect(bloc).toMatch(/if \(!prise\.ok\)/);
    expect(bloc).toContain("confirmerDepenseReplicate(s.userId, depenseReservee.reference, 'liberee')");
  });
});

describe('après l’appel, la dépense est finalisée avec l’issue RÉELLE — jamais devinée', () => {
  it('échec : `jamaisEnvoye` → liberee, `incertain` → incertaine, sinon confirmee', () => {
    expect(r).toContain(
      "const statutDepense: StatutDepense = resultat.jamaisEnvoye ? 'liberee' : resultat.incertain ? 'incertaine' : 'confirmee';",
    );
  });

  it('la finalisation de la dépense se fait côté échec AVANT le remboursement des crédits — deux systèmes indépendants, mais dans un ordre lisible', () => {
    const iDepense = r.indexOf("confirmerDepenseReplicate(s.userId, (depenseReservee as DepenseReservee).reference, statutDepense)");
    const iCredits = r.indexOf('const issue = await rembourserCredits(');
    expect(iDepense).toBeGreaterThan(0);
    expect(iDepense).toBeLessThan(iCredits);
  });

  it('succès : la dépense est confirmée — reste comptée même si le film est ensuite modifié ou supprimé', () => {
    const iSucces = r.indexOf('// La depense et la trace de reference');
    const bloc = r.slice(r.lastIndexOf('if (depenseReservee) {', iSucces), iSucces);
    expect(bloc).toContain("confirmerDepenseReplicate(s.userId, (depenseReservee as DepenseReservee).reference, 'confirmee')");
  });

  it('la confirmation ne lève jamais : elle ne doit pas empêcher la route de répondre', () => {
    const lignesConfirmation = r.split('\n').filter((l) => l.includes('confirmerDepenseReplicate('));
    expect(lignesConfirmation.length).toBeGreaterThanOrEqual(3); // liberee (payer), et le statut final (échec + succès)
    for (const ligne of lignesConfirmation) expect(ligne).toContain('.catch(() => null)');
  });
});

describe('le devis est calculé une seule fois côté route, et réutilisé — jamais deux prix différents pour la même tentative', () => {
  it('la route n’appelle `devisGeneration` qu’UNE fois (dans `payer`) — l’atelier calcule le SIEN séparément, par construction', () => {
    expect((r.match(/devisGeneration\(/g) ?? []).length).toBe(1);
  });

  it('le devis utilisé pour le plafond et celui utilisé pour les crédits ne sont PAS la même grille tarifaire', () => {
    // Le plafond de compte protège une dépense FOURNISSEUR (USD, `generation/couts.ts`) ;
    // les crédits paient l'UTILISATEUR (grille `lib/tarifs/*`, via `generation/credits.ts`).
    // Mélanger les deux ferait, par exemple, comparer des crédits à un plafond en dollars.
    expect(r).toContain("devisTentative.totalUsd");
    expect(r).toContain("reserverCredits(s.userId, operation as 'image' | 'video')");
  });
});

describe('les drapeaux jamaisEnvoye / incertain traversent tout le chemin, du fournisseur à la route', () => {
  it('`fournisseur.ts` les déclare sur la variante d’échec', () => {
    expect(fournisseur).toContain('jamaisEnvoye?: boolean;');
    expect(fournisseur).toContain('incertain?: boolean;');
  });

  it('`atelier.ts` les propage sur les DEUX branches d’appel (image et vidéo), jamais sur les échecs après coup', () => {
    expect((atelier.match(/jamaisEnvoye: resultat\.jamaisEnvoye, incertain: resultat\.incertain/g) ?? []).length).toBe(2);
    // Les échecs de lecture du fichier ou d'import (après un appel RÉUSSI) ne portent pas ces
    // drapeaux : l'appel a eu lieu, c'est toujours une dépense réelle.
    const apresAppel = atelier.slice(atelier.indexOf('// ── 5. Le resultat passe par le MEME controle'));
    expect(apresAppel).not.toMatch(/jamaisEnvoye|incertain/);
  });

  it('le type `ResultatGenerationPlan` les documente', () => {
    expect(atelier).toContain('jamaisEnvoye?: boolean;');
    expect(atelier).toContain('incertain?: boolean;');
  });
});
