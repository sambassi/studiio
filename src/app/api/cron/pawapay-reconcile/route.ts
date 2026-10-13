/**
 * GET /api/cron/pawapay-reconcile — rattrapage des dépôts PawaPay en attente.
 *
 * Filet de sécurité du chemin par interrogation : un client qui ferme son
 * navigateur avant le retour ne doit pas perdre ses crédits. Le cron relit
 * chez PawaPay des dépôts `en_attente` et appelle `confirmerDepot` — le même
 * code que la route de statut.
 *
 * DEUX LOTS, pour qu'aucun dépôt abandonné ne bloque un vrai paiement :
 * - lot normal (défaut) : dépôts créés il y a plus de `minutes` (10) et moins
 *   de `SEUIL_ANCIEN_HEURES` (24 h), au plus `limite` (20) ;
 * - lot « anciens » (`?lot=anciens`) : dépôts de plus de 24 h, au plus
 *   `limite` (5 par défaut), à planifier à faible fréquence.
 * Dans chaque lot, le store sert d'abord les dépôts JAMAIS vérifiés, puis les
 * moins récemment vérifiés (`verifieLe`) : des dépôts qui restent NOT_FOUND
 * passent en fin de file au lieu d'occuper chaque passage.
 *
 * Un dépôt ancien toujours non final (ou introuvable) est journalisé et
 * LAISSÉ en attente : jamais crédité, jamais marqué en échec sans preuve.
 *
 * Autorisation : `Authorization: Bearer <CRON_SECRET>`, même mécanisme que
 * les autres crons (`isCronAuthorized`). `PAWAPAY_ENABLED` ≠ "true" ou store
 * absent → 200 « désactivé », rien fait.
 *
 * Planification (non branchée dans cette PR) : Coolify Scheduled Tasks,
 *   toutes les 5 min : curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
 *     https://studiio.pro/api/cron/pawapay-reconcile
 *   toutes les heures : … /api/cron/pawapay-reconcile?lot=anciens
 */
import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron/auth';
import { lireDepot } from '@/lib/payment/pawapay/client';
import { confirmerDepot } from '@/lib/payment/pawapay/confirmation';
import { obtenirDependances, pawapayActif } from '@/lib/payment/pawapay/store';
import type { IssueConfirmation } from '@/lib/payment/pawapay/types';

export const dynamic = 'force-dynamic';

const MINUTES_DEFAUT = 10;
const LIMITE_DEFAUT = 20;
const LIMITE_ANCIENS_DEFAUT = 5;
const LIMITE_MAX = 100;
const SEUIL_ANCIEN_HEURES = 24;
/**
 * Budget de temps d'un passage. Chaque appel PawaPay est déjà borné
 * (`DELAI_APPEL_PAWAPAY_MS`) ; ce budget borne le passage entier, pour que
 * deux passages planifiés ne se chevauchent pas. Une fois dépassé, aucun
 * nouveau dépôt n'est entamé : les restants seront servis au passage suivant
 * (ils n'ont pas été vérifiés, ils restent donc en tête de file).
 */
const BUDGET_PASSAGE_MS = 60_000;

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

  if (!pawapayActif()) return NextResponse.json({ status: 'desactive' }, { status: 200 });
  const deps = obtenirDependances();
  if (!deps) return NextResponse.json({ status: 'desactive' }, { status: 200 });

  const params = req.nextUrl.searchParams;
  const anciens = params.get('lot') === 'anciens';
  const maintenant = Date.now();
  const seuilAncien = new Date(maintenant - SEUIL_ANCIEN_HEURES * 3_600_000).toISOString();
  const limite = entierBorne(
    params.get('limite'), anciens ? LIMITE_ANCIENS_DEFAUT : LIMITE_DEFAUT, 1, LIMITE_MAX,
  );
  const fenetre = anciens
    ? { creeAvant: seuilAncien, limite }
    : {
      creeAvant: new Date(
        maintenant - entierBorne(params.get('minutes'), MINUTES_DEFAUT, 1, SEUIL_ANCIEN_HEURES * 60) * 60_000,
      ).toISOString(),
      creeApres: seuilAncien,
      limite,
    };

  let enAttente;
  try {
    enAttente = await deps.store.listerEnAttente(fenetre);
  } catch (e) {
    console.error('[PAWAPAY_RATTRAPAGE] Lecture des dépôts impossible :', (e as Error)?.message);
    return NextResponse.json({ error: 'Lecture des dépôts impossible' }, { status: 500 });
  }

  const bilan: Partial<Record<IssueConfirmation | 'erreur', number>> = {};
  const bloques: string[] = [];

  // Séquentiel : un passage ne martèle pas l'API PawaPay.
  let traites = 0;
  let interrompu = false;
  for (const depot of enAttente) {
    if (Date.now() - maintenant >= BUDGET_PASSAGE_MS) {
      interrompu = true;
      console.warn(
        `[PAWAPAY_RATTRAPAGE] Budget de ${BUDGET_PASSAGE_MS / 1000} s atteint : `
        + `${enAttente.length - traites} dépôt(s) reporté(s) au passage suivant`,
      );
      break;
    }
    traites++;
    try {
      const { issue } = await confirmerDepot(depot.depositId, {
        store: deps.store,
        lireDepotDistant: lireDepot,
      });
      bilan[issue] = (bilan[issue] ?? 0) + 1;
      const ageHeures = (maintenant - Date.parse(depot.creeLe)) / 3_600_000;
      if ((issue === 'en_attente' || issue === 'introuvable') && ageHeures > SEUIL_ANCIEN_HEURES) {
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

  const corps = {
    status: 'ok',
    lot: anciens ? 'anciens' : 'normal',
    examines: traites,
    reportes: enAttente.length - traites,
    interrompu,
    bilan,
    bloques,
  };
  // Une erreur n'est jamais avalée : le passage suivant réessaiera, mais la
  // supervision voit un 500.
  return NextResponse.json(corps, { status: bilan.erreur ? 500 : 200 });
}
