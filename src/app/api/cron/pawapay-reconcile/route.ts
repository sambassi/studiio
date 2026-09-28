/**
 * GET /api/cron/pawapay-reconcile — rattrapage des dépôts PawaPay en attente.
 *
 * Filet de sécurité du chemin par interrogation : un client qui ferme son
 * navigateur avant le retour ne doit pas perdre ses crédits. Le cron relit
 * chez PawaPay chaque dépôt `en_attente` plus vieux que `minutes` (10 par
 * défaut), au plus `limite` par passage (20 par défaut), et appelle
 * `confirmerDepot` — le même code que la route de statut.
 *
 * Un dépôt toujours non final (ou introuvable) après `SEUIL_BLOQUE_HEURES`
 * est journalisé et LAISSÉ en attente : jamais crédité, jamais marqué en
 * échec sans preuve de PawaPay.
 *
 * Autorisation : `Authorization: Bearer <CRON_SECRET>`, même mécanisme que
 * les autres crons (`isCronAuthorized`).
 *
 * Planification (non branchée dans cette PR) : Coolify Scheduled Task, par
 * exemple toutes les 5 minutes, `curl -fsS -H "Authorization: Bearer
 * $CRON_SECRET" https://studiio.pro/api/cron/pawapay-reconcile`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron/auth';
import { lireDepot } from '@/lib/payment/pawapay/client';
import { confirmerDepot } from '@/lib/payment/pawapay/confirmation';
import { obtenirDependances } from '@/lib/payment/pawapay/store';
import type { IssueConfirmation } from '@/lib/payment/pawapay/types';

export const dynamic = 'force-dynamic';

const MINUTES_DEFAUT = 10;
const LIMITE_DEFAUT = 20;
const LIMITE_MAX = 100;
const SEUIL_BLOQUE_HEURES = 24;

// Secret absent ou vide → refus total (voir `isCronAuthorized`).
function verifyCronSecret(req: NextRequest): boolean {
  return isCronAuthorized(req.headers.get('authorization'), process.env.CRON_SECRET);
}

function entierBorne(brut: string | null, defaut: number, min: number, max: number): number {
  if (brut === null) return defaut;
  const n = Number.parseInt(brut, 10);
  if (!Number.isFinite(n)) return defaut;
  return Math.min(max, Math.max(min, n));
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const deps = obtenirDependances();
  if (!deps) return NextResponse.json({ status: 'desactive' }, { status: 200 });

  const params = req.nextUrl.searchParams;
  const minutes = entierBorne(params.get('minutes'), MINUTES_DEFAUT, 1, 7 * 24 * 60);
  const limite = entierBorne(params.get('limite'), LIMITE_DEFAUT, 1, LIMITE_MAX);
  const maintenant = Date.now();
  const avant = new Date(maintenant - minutes * 60_000).toISOString();

  let enAttente;
  try {
    enAttente = await deps.store.listerEnAttente({ avant, limite });
  } catch (e) {
    console.error('[PAWAPAY_RATTRAPAGE] Lecture des dépôts impossible :', e);
    return NextResponse.json({ error: 'Lecture des dépôts impossible' }, { status: 500 });
  }

  const bilan: Partial<Record<IssueConfirmation | 'erreur', number>> = {};
  const bloques: string[] = [];

  // Séquentiel : un passage ne martèle pas l'API PawaPay.
  for (const depot of enAttente) {
    try {
      const { issue } = await confirmerDepot(depot.depositId, {
        store: deps.store,
        crediter: deps.crediter,
        lireDepotDistant: lireDepot,
      });
      bilan[issue] = (bilan[issue] ?? 0) + 1;
      const ageHeures = (maintenant - Date.parse(depot.creeLe)) / 3_600_000;
      if ((issue === 'en_attente' || issue === 'introuvable') && ageHeures > SEUIL_BLOQUE_HEURES) {
        bloques.push(depot.depositId);
        console.warn(
          `[PAWAPAY_RATTRAPAGE] Dépôt ${depot.depositId} non final après ${Math.floor(ageHeures)} h `
          + `(${issue}) — laissé en attente, examen manuel`,
        );
      }
      if (issue === 'montant_invalide' || issue === 'devise_invalide') {
        console.error(`[PAWAPAY_RATTRAPAGE] ${issue} pour ${depot.depositId} — aucun crédit, examen manuel`);
      }
    } catch (e) {
      bilan.erreur = (bilan.erreur ?? 0) + 1;
      console.error(`[PAWAPAY_RATTRAPAGE] Échec pour ${depot.depositId} :`, (e as Error)?.message);
    }
  }

  const corps = { status: 'ok', examines: enAttente.length, bilan, bloques };
  // Une erreur n'est jamais avalée : le passage suivant réessaiera, mais la
  // supervision voit un 500.
  return NextResponse.json(corps, { status: bilan.erreur ? 500 : 200 });
}
