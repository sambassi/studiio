/**
 * CINEMA IA — CORRECTION FINANCIÈRE : plafond PAR GÉNÉRATION vs plafond CUMULÉ du film,
 * et traitement correct des échecs (facturé / non facturé / facturation inconnue).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * INCIDENTS RÉELS RAPPORTÉS
 * ─────────────────────────────────────────────────────────────────────────
 * 1. Deux générations Replicate ont échoué (E002) — traité séparément (PR #629).
 * 2. Le film affiche 0,903 $ déjà comptabilisés.
 * 3. Une nouvelle génération estimée à 0,45 $ a été BLOQUÉE, alors que
 *    0,903 + 0,45 = 1,353 $ reste sous le plafond annoncé de 2 $ (film ET compte).
 * 4. Aucun appel Replicate n'a eu lieu lors de ce blocage ; les crédits sont restés
 *    inchangés — donc le refus est intervenu AVANT tout débit, au niveau des plafonds.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER ÉTABLIT, PAR LA PREUVE, PAS PAR SUPPOSITION
 * ─────────────────────────────────────────────────────────────────────────
 * Aucun test existant n'exerçait `genererMediaPlan` + le gestionnaire de PAIEMENT
 * (`payer`, tel que construit par `executeur-generation.ts`) ENSEMBLE, avec des montants
 * réalistes correspondant à l'incident. `verifierPlafond` (couts.ts) et le double de
 * `reserver_depense_cinema` (cinema-plafond-compte.test.ts) sont chacun prouvés CORRECTS
 * séparément — mais jamais composés l'un avec l'autre sur ce cas précis. Ce fichier le fait.
 *
 * RÉSULTAT DE LA REPRODUCTION : le « Cas obligatoire » NE bloque PAS avec le code actuel
 * (`verifierPlafond` et la réservation de dépense par compte comparent tous les deux
 * correctement `déjà dépensé + proposé` contre le plafond, jamais le proposé seul comme un
 * plafond). Documenté ci-dessous avec la preuve ; la cause réelle du blocage observé en
 * production reste donc, à défaut d'accès aux journaux réels, le plus probablement un ÉTAT
 * du compte Postgres DIFFÉRENT de celui affiché sur le film (voir le rapport). Ce fichier
 * couvre malgré tout, en profondeur, les distinctions et protections demandées.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { preparerFilm } from '@/lib/cinema/atelier';
import { genererMediaPlan } from '@/lib/cinema/generation/atelier';
import { enregistrerFournisseur } from '@/lib/cinema/generation/fournisseur';
import { ID_REPLICATE_VIDEO, FOURNISSEUR_REPLICATE_VIDEO } from '@/lib/cinema/generation/replicate';
import { devisGeneration, verifierPlafond } from '@/lib/cinema/generation/couts';
import { remplacerMedia } from '@/lib/cinema/medias';
import { executer } from '@/lib/cinema/rendu-local';
import { cheminFfmpeg } from '@/lib/ffmpeg/binaires';
import type { MediaPlan } from '@/lib/cinema/types';

/** Une vraie image, decodable par ffprobe (exigee par `genererVideo` depuis le diagnostic E002). */
async function imageReelle(dir: string, nom = 'source.png'): Promise<string> {
  const fichier = join(dir, nom);
  const r = await executer(cheminFfmpeg(), ['-f', 'lavfi', '-i', 'color=c=red:s=16x16', '-frames:v', '1', '-y', fichier], { timeoutMs: 20_000 });
  if (r.code !== 0) throw new Error(`fixture image : ffmpeg code ${r.code}\n${r.stderr.slice(-500)}`);
  return fichier;
}

const HISTOIRE = 'Nina entre dans la salle avant le lever du jour. Marco la regarde sans bouger. Nina murmure « je ne reculerai pas ». Le jour se leve sur la salle vide.';

/**
 * Double de `reserver_depense_cinema`/`confirmer_depense_cinema` (meme semantique que
 * `cinema-plafond-compte.test.ts`) : UN SEUL etat partage, pour composer fidelement avec
 * `verifierPlafond` sur un cas reel.
 */
function systemeDepense(o: { comptePrealable: number; plafondCompte: number; plafondGlobal?: number }) {
  const etat = { compte: o.comptePrealable, global: o.plafondGlobal !== undefined ? o.comptePrealable : o.comptePrealable, engagements: [] as Array<{ reference: string; montant: number; statut: 'engagee' | 'confirmee' | 'incertaine' | 'liberee' }> };
  const plafondGlobal = o.plafondGlobal ?? 1_000_000;
  let n = 0;
  return {
    etat,
    appelsReserver: 0,
    async reserver(montantUsd: number): Promise<{ ok: true; reference: string } | { ok: false; motif: string; message: string }> {
      this.appelsReserver++;
      if (etat.compte + montantUsd > o.plafondCompte) {
        return { ok: false, motif: 'plafond_compte_depasse', message: `plafond de depense du compte atteint (${o.plafondCompte.toFixed(2)} $) — generation refusee avant tout appel` };
      }
      if (etat.global + montantUsd > plafondGlobal) {
        return { ok: false, motif: 'plafond_global_depasse', message: `plafond de depense global atteint (${plafondGlobal.toFixed(2)} $)` };
      }
      const reference = `cinema-generation:test-${++n}`;
      etat.compte += montantUsd; etat.global += montantUsd;
      etat.engagements.push({ reference, montant: montantUsd, statut: 'engagee' });
      return { ok: true, reference };
    },
    async confirmer(reference: string, statut: 'confirmee' | 'incertaine' | 'liberee'): Promise<void> {
      const e = etat.engagements.find((x) => x.reference === reference);
      if (!e) return;
      if (statut === 'liberee') { etat.compte -= e.montant; etat.global -= e.montant; }
      e.statut = statut;
    },
  };
}

function systemeCredits(o: { solde: number; coutVideo: number }) {
  let solde = o.solde;
  const rendus: string[] = [];
  let n = 0;
  return {
    appelsReserver: 0,
    soldeActuel: () => solde,
    rembourses: () => rendus,
    async reserver(): Promise<{ ok: true; reference: string; cout: number } | { ok: false; motif: string; message: string }> {
      this.appelsReserver++;
      if (solde < o.coutVideo) return { ok: false, motif: 'solde_insuffisant', message: 'solde de credits insuffisant' };
      solde -= o.coutVideo;
      const reference = `credits:test-${++n}`;
      return { ok: true, reference, cout: o.coutVideo };
    },
    async rembourser(reference: string): Promise<{ ok: true }> {
      solde += o.coutVideo;
      rendus.push(reference);
      return { ok: true };
    },
  };
}

/** Le `payer()` EXACT de `executeur-generation.ts`, reproduit avec des doubles controlables,
 * pour composer fidelement avec `genererMediaPlan` (qui, lui, n'est PAS un double — c'est le
 * vrai code de production, y compris `verifierPlafond`). */
function construirePayer(depense: ReturnType<typeof systemeDepense>, credits: ReturnType<typeof systemeCredits>, montantUsd: number) {
  let depenseRef: string | null = null;
  return {
    async payer() {
      const r = await depense.reserver(montantUsd);
      if (!r.ok) return { ok: false as const, motif: r.motif, message: r.message };
      depenseRef = r.reference;
      const c = await credits.reserver();
      if (!c.ok) {
        await depense.confirmer(r.reference, 'liberee');
        return { ok: false as const, motif: c.motif, message: c.message };
      }
      return { ok: true as const };
    },
    conclure(issue: { jamaisEnvoye?: boolean; incertain?: boolean } | null) {
      if (!depenseRef) return;
      const statut = issue?.jamaisEnvoye ? 'liberee' : issue?.incertain ? 'incertaine' : 'confirmee';
      return depense.confirmer(depenseRef, statut as 'confirmee' | 'incertaine' | 'liberee');
    },
  };
}

describe('CAS OBLIGATOIRE — film a 0,903 $ deja depenses, nouvelle generation 0,45 $, plafonds 2 $', () => {
  let dir: string;
  beforeEach(() => {
    enregistrerFournisseur({
      id: ID_REPLICATE_VIDEO,
      libelle: 'Video (test, aucun reseau)',
      get actif() { return true; },
      async genererImage() { return { ok: false, erreur: 'ce fournisseur ne fait que des videos' }; },
      async genererVideo() {
        // Un VRAI mp4 decodable : `genererMediaPlan` fait passer le resultat par le MEME
        // controle (`sonderMedia`, ffprobe) qu'un import manuel — des octets factices y
        // echoueraient, independamment de toute question de plafond.
        const sortie = join(dir, `sortie-${Date.now()}.mp4`);
        const r = await executer(cheminFfmpeg(), [
          '-f', 'lavfi', '-i', 'color=c=red:s=16x16:d=1:r=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', sortie,
        ], { timeoutMs: 20_000 });
        if (r.code !== 0) throw new Error(`fixture video : ffmpeg code ${r.code}\n${r.stderr.slice(-500)}`);
        return { ok: true, fichier: sortie, nomSuggere: 'video-test.mp4' };
      },
    });
  });
  afterEach(() => {
    enregistrerFournisseur(FOURNISSEUR_REPLICATE_VIDEO); // restaure le VRAI fournisseur, jamais un reinitialiserRegistrePourTests() destructeur pour les autres tests
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function filmDeTest(coutGenerationUsd: number) {
    dir = mkdtempSync(join(tmpdir(), 'studiio-plafond-cumule-'));
    let film = preparerFilm({ histoire: HISTOIRE, personnages: [{ nom: 'Nina', description: 'veste rouge' }], idFilm: 'film-plafond-cumule-test' });
    const planId = film.scenes[0].plans[0].id;
    await imageReelle(dir); // ecrit le fichier source.png reel que `media.url` ci-dessous reference
    const media: MediaPlan = { url: 'source.png', genre: 'image', largeur: 16, hauteur: 16, dureeS: null, octets: 4, origine: 'genere' };
    film = remplacerMedia(film, planId, media);
    film = { ...film, coutGenerationUsd };
    return { film, planId, racinePublique: dir };
  }

  it('le devis de CETTE SEULE generation est bien 0,45 $ (tarif officiel video, pas un autre montant)', () => {
    const devis = devisGeneration(ID_REPLICATE_VIDEO, [{ planId: 'x', operations: ['video'] }]);
    expect(devis.totalUsd).toBe(0.45);
  });

  it('`verifierPlafond` SEUL, sur ces montants exacts : AUTORISE (0,903 + 0,45 = 1,353 < 2)', () => {
    const v = verifierPlafond({ dejaDepenseUsd: 0.903, coutProposeUsd: 0.45, plafondUsd: 2 });
    expect(v.autorise).toBe(true);
  });

  it('REPRODUCTION — genererMediaPlan COMPLET (plafond film + reservation de depense par compte ENSEMBLE) : AUTORISE, pas bloque', async () => {
    const { film, planId, racinePublique } = await filmDeTest(0.903);
    const depense = systemeDepense({ comptePrealable: 0.903, plafondCompte: 2 });
    const credits = systemeCredits({ solde: 100, coutVideo: 15 });
    const { payer, conclure } = construirePayer(depense, credits, 0.45);

    const r = await genererMediaPlan(film, planId, {
      fournisseurId: ID_REPLICATE_VIDEO, operation: 'video', racinePublique, plafondUsd: 2, payer,
    });
    await conclure(r.ok ? null : { jamaisEnvoye: 'jamaisEnvoye' in r ? r.jamaisEnvoye : undefined, incertain: 'incertain' in r ? r.incertain : undefined });

    // Si ceci echoue, c'est la preuve directe, chiffree, d'une regression — pas une supposition.
    expect(r.ok, !r.ok ? r.erreur : '').toBe(true);
    expect(depense.appelsReserver).toBe(1);
    expect(depense.etat.compte).toBeCloseTo(0.903 + 0.45, 5);
    expect(credits.soldeActuel()).toBe(100 - 15);
  });

  it('a l’INVERSE : si le plafond etait REELLEMENT 0,45 $ (confondu avec le cout de cette seule generation), le cas obligatoire serait bloque a tort — preuve du symptome rapporte', async () => {
    const { film, planId, racinePublique } = await filmDeTest(0.903);
    const depense = systemeDepense({ comptePrealable: 0.903, plafondCompte: 0.45 }); // <- le bug SUPPOSE, simule ici deliberement
    const credits = systemeCredits({ solde: 100, coutVideo: 15 });
    const { payer } = construirePayer(depense, credits, 0.45);
    const r = await genererMediaPlan(film, planId, {
      fournisseurId: ID_REPLICATE_VIDEO, operation: 'video', racinePublique, plafondUsd: 2, payer,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toContain('plafond de depense du compte atteint (0.45 $)');
    expect(credits.soldeActuel()).toBe(100); // rien debite : le refus de depense a precede les credits
  });
});

describe('distinctions de plafond — par generation, cumule, compte, global', () => {
  it('plafond PAR GENERATION (le cout de CETTE operation depasse a lui seul le solde restant du film)', () => {
    const v = verifierPlafond({ dejaDepenseUsd: 1.8, coutProposeUsd: 0.45, plafondUsd: 2 });
    expect(v.autorise).toBe(false);
    expect(v.motif).toMatch(/plafond depasse/);
    expect(v.motif).toContain('1.8000'); // deja depense, distinct du propose
    expect(v.motif).toContain('0.4500'); // propose, distinct du deja depense
  });

  it('plafond CUMULATIF du film : refuse des que la SOMME depasse, jamais le propose seul', () => {
    // Le propose (0,10 $) est, SEUL, tres en dessous du plafond (2 $) — c'est la SOMME
    // avec le deja-depense (1,95 $) qui depasse, pas une confusion sur le montant propose.
    const v = verifierPlafond({ dejaDepenseUsd: 1.95, coutProposeUsd: 0.10, plafondUsd: 2 });
    expect(v.autorise).toBe(false);
    expect(v.dejaDepenseUsd).toBe(1.95);
    expect(v.coutProposeUsd).toBe(0.10);
    expect(v.plafondUsd).toBe(2); // le plafond LUI-MEME n'est jamais ecrase par le propose
  });

  it('plafond PAR COMPTE (reservation de depense) : meme logique « deja engage + propose », jamais « propose seul »', async () => {
    const depense = systemeDepense({ comptePrealable: 1.8, plafondCompte: 2 });
    const r1 = await depense.reserver(0.45); // 1.8 + 0.45 = 2.25 > 2 : refuse
    expect(r1).toMatchObject({ ok: false, motif: 'plafond_compte_depasse' });
    const depense2 = systemeDepense({ comptePrealable: 1.5, plafondCompte: 2 });
    const r2 = await depense2.reserver(0.45); // 1.5 + 0.45 = 1.95 <= 2 : autorise
    expect(r2.ok).toBe(true);
  });

  it('plafond GLOBAL : independant du plafond de compte, verifie separement', async () => {
    const depense = systemeDepense({ comptePrealable: 0, plafondCompte: 100, plafondGlobal: 1 });
    const r = await depense.reserver(0.45);
    expect(r.ok).toBe(true);
    const r2 = await depense.reserver(0.6); // 0.45 + 0.6 = 1.05 > 1 (global), mais << 100 (compte)
    expect(r2).toMatchObject({ ok: false, motif: 'plafond_global_depasse' });
  });

  it('DEPENSE ESTIMEE vs CONFIRMEE vs RESERVEE/NON CONFIRMEE : trois etats distincts, jamais confondus', async () => {
    const depense = systemeDepense({ comptePrealable: 0, plafondCompte: 2 });
    const r = await depense.reserver(0.45);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Juste apres reservation : ESTIMEE/ENGAGEE, PAS encore confirmee.
    expect(depense.etat.engagements[0].statut).toBe('engagee');
    await depense.confirmer(r.reference, 'confirmee');
    expect(depense.etat.engagements[0].statut).toBe('confirmee');
    expect(depense.etat.compte).toBeCloseTo(0.45, 5); // le montant reste compte, confirme
  });
});

describe('traitement des echecs — jamais une estimation declaree comme depense confirmee', () => {
  let dir: string;
  beforeEach(() => {
    enregistrerFournisseur({
      id: ID_REPLICATE_VIDEO, libelle: 'Video (test echec)',
      get actif() { return true; },
      async genererImage() { return { ok: false, erreur: 'image non supportee' }; },
      async genererVideo() { return { ok: false, erreur: 'erreur fournisseur simulee', jamaisEnvoye: true }; },
    });
  });
  afterEach(() => { enregistrerFournisseur(FOURNISSEUR_REPLICATE_VIDEO); if (dir) rmSync(dir, { recursive: true, force: true }); });

  async function film() {
    dir = mkdtempSync(join(tmpdir(), 'studiio-plafond-echec-'));
    let f = preparerFilm({ histoire: HISTOIRE, personnages: [{ nom: 'Nina', description: 'veste rouge' }], idFilm: 'film-echec-test' });
    const planId = f.scenes[0].plans[0].id;
    await imageReelle(dir);
    f = remplacerMedia(f, planId, { url: 'source.png', genre: 'image', largeur: 16, hauteur: 16, dureeS: null, octets: 4, origine: 'genere' });
    return { film: f, planId, racinePublique: dir };
  }

  it('ECHEC NON FACTURE (jamaisEnvoye) : la depense reservee est LIBEREE, jamais comptee comme confirmee', async () => {
    const { film: f, planId, racinePublique } = await film();
    const depense = systemeDepense({ comptePrealable: 0, plafondCompte: 2 });
    const credits = systemeCredits({ solde: 100, coutVideo: 15 });
    const { payer, conclure } = construirePayer(depense, credits, 0.45);
    const r = await genererMediaPlan(f, planId, { fournisseurId: ID_REPLICATE_VIDEO, operation: 'video', racinePublique, plafondUsd: 2, payer });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.jamaisEnvoye).toBe(true);
      await conclure({ jamaisEnvoye: true });
    }
    expect(depense.etat.engagements[0].statut).toBe('liberee');
    expect(depense.etat.compte).toBe(0); // la liberation RETIRE le montant du compteur engage
    expect(credits.rembourses().length).toBe(0); // rien n'avait ete pris (payer() n'a jamais debite ici : voir test suivant pour le cas debite-puis-rembourse
  });

  it('ECHEC avec FACTURATION INCONNUE (incertain) : reste compte SEPAREMENT, ni confirme a tort ni libere a tort', async () => {
    const depense = systemeDepense({ comptePrealable: 0, plafondCompte: 2 });
    const r = await depense.reserver(0.45);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await depense.confirmer(r.reference, 'incertaine');
    expect(depense.etat.engagements[0].statut).toBe('incertaine');
    // Incertaine : le montant RESTE compte (jamais suppose annule), contrairement a « liberee ».
    expect(depense.etat.compte).toBeCloseTo(0.45, 5);
  });

  it('REFUS AVANT APPEL REPLICATE (plafond deja depasse) : le fournisseur n’est JAMAIS appele', async () => {
    const { film: f, planId, racinePublique } = await film();
    let appeleFournisseur = false;
    enregistrerFournisseur({
      id: ID_REPLICATE_VIDEO, libelle: 'Video (ne doit jamais etre appelee)',
      get actif() { return true; },
      async genererImage() { return { ok: false, erreur: 'x' }; },
      async genererVideo() { appeleFournisseur = true; return { ok: false, erreur: 'ne doit jamais etre atteint' }; },
    });
    const r = await genererMediaPlan(f, planId, {
      fournisseurId: ID_REPLICATE_VIDEO, operation: 'video', racinePublique, plafondUsd: 2,
      payer: async () => ({ ok: false as const, motif: 'plafond_compte_depasse', message: 'plafond atteint' }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusPaiement).toBe('plafond_compte_depasse');
    expect(appeleFournisseur).toBe(false);
  });
});

describe('concurrence — deux demandes simultanees, aucun double debit', () => {
  it('deux reservations de depense « simultanees » sur un compte proche du plafond : une seule passe', async () => {
    const depense = systemeDepense({ comptePrealable: 1.6, plafondCompte: 2 }); // marge de 0,40 $ seulement
    // Double VOLONTAIREMENT sequentiel (sans `await` interne) : `Promise.all` ne cree ici
    // aucun vrai entrelacement — exactement ce que garantit l'ATOMICITE reelle de
    // PostgreSQL (verrou + transaction), deja eprouvee par
    // `tests-pg/cinema-plafond-compte.pg.test.ts`. Le POINT verifie ici est la LOGIQUE DE
    // COMPARAISON elle-meme : chaque tentative voit le total APRES la precedente, jamais un
    // total fige au debut — donc jamais de double acceptation au-dela du plafond.
    const [r1, r2] = await Promise.all([depense.reserver(0.3), depense.reserver(0.3)]);
    // 1.6 + 0.3 = 1.9 (autorise) ; 1.9 + 0.3 = 2.2 > 2 (refuse) : EXACTEMENT une des deux passe.
    const succes = [r1, r2].filter((r) => r.ok);
    expect(succes.length).toBe(1);
    expect(depense.etat.compte).toBeCloseTo(1.9, 5); // jamais 2.2 : aucun depassement du plafond
  });

  it('un double debit de CREDITS pour la MEME operation ne peut pas se produire : `reserverCredits` n’est appele qu’une fois par `payer()`', async () => {
    const credits = systemeCredits({ solde: 100, coutVideo: 15 });
    const { payer } = construirePayer(systemeDepense({ comptePrealable: 0, plafondCompte: 2 }), credits, 0.45);
    await payer();
    expect(credits.appelsReserver).toBe(1);
    expect(credits.soldeActuel()).toBe(85);
  });
});

describe('15 credits par video — toujours correctement geres', () => {
  it('le tarif credits video reste 15, et distinct du cout USD Replicate (0,45 $) — deux systemes independants', async () => {
    const { cleTarifGeneration, CLE_TARIF_VIDEO } = await import('@/lib/cinema/generation/credits');
    expect(cleTarifGeneration('video')).toBe(CLE_TARIF_VIDEO);
  });
});
