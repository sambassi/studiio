/**
 * Devis PawaPay — calcul PARTAGÉ par `/api/pawapay/quote` et
 * `/api/pawapay/deposit`, pour que le prix affiché et le prix encaissé
 * sortent du même code.
 *
 * SERVEUR UNIQUEMENT. Tout est décidé ici : crédits et prix CHF viennent du
 * pack (`PACKS_PAWAPAY`), la devise du pays réellement ouvert sur le compte
 * (`/v2/active-conf`), le montant local de `prixLocal` avec les taux de
 * `obtenirTauxChf` (`PAWAPAY_RATES`). Le client ne fournit que le pack, le
 * pays et, si le pays en a plusieurs, le choix de la devise.
 */
import { paysActifs } from './client';
import { obtenirTauxChf } from './store';
import { DeviseSansTauxErreur, PACKS_PAWAPAY, estPackId, prixLocal, type PackId } from './tarifs';

const PAYS_RX = /^[A-Z]{3}$/;

export interface Devis {
  pack: PackId;
  credits: number;
  /** Prix de référence en CHF, chaîne à 2 décimales (ex. « 59.00 »). */
  prixChf: string;
  /** Montant local, chaîne d'entier, calculé par `prixLocal`. */
  montant: string;
  devise: string;
  pays: string;
}

export type ResultatDevis =
  | { ok: true; devis: Devis }
  | { ok: false; status: 400 | 502 | 503; erreur: string; devises?: string[] };

function formaterChf(centimes: number): string {
  return `${Math.floor(centimes / 100)}.${String(centimes % 100).padStart(2, '0')}`;
}

/**
 * Base de l'URL de retour, CONFIGURÉE côté serveur uniquement. Jamais
 * l'en-tête Host de la requête : il est contrôlé par le client. `null` si ni
 * `NEXTAUTH_URL` ni `NEXT_PUBLIC_APP_URL` n'est une URL http(s) valide.
 */
export function urlDeBaseConfiguree(): string | null {
  for (const brut of [process.env.NEXTAUTH_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    if (!brut) continue;
    try {
      const u = new URL(brut);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin;
    } catch { /* suivante */ }
  }
  return null;
}

/** Calcule le devis, ou dit pourquoi c'est impossible (code HTTP inclus). */
export async function calculerDevis(entree: {
  pack: unknown;
  pays: unknown;
  devise?: unknown;
}): Promise<ResultatDevis> {
  const { pack, pays, devise: deviseDemandee } = entree;
  if (!estPackId(pack)) return { ok: false, status: 400, erreur: 'Pack invalide' };
  if (typeof pays !== 'string' || !PAYS_RX.test(pays)) {
    return { ok: false, status: 400, erreur: 'Pays invalide' };
  }

  const taux = await obtenirTauxChf();
  if (!taux) return { ok: false, status: 503, erreur: 'Taux de change indisponibles' };

  try {
    const actif = (await paysActifs()).find((p) => p.pays === pays);
    if (!actif) return { ok: false, status: 400, erreur: 'Pays non disponible' };
    let devise: string;
    if (typeof deviseDemandee === 'string' && deviseDemandee) {
      if (!actif.devises.includes(deviseDemandee)) {
        return { ok: false, status: 400, erreur: 'Devise non disponible pour ce pays' };
      }
      devise = deviseDemandee;
    } else if (actif.devises.length === 1) {
      devise = actif.devises[0];
    } else {
      return { ok: false, status: 400, erreur: 'Devise à préciser', devises: actif.devises };
    }
    const { credits, prixCentimesChf } = PACKS_PAWAPAY[pack];
    return {
      ok: true,
      devis: {
        pack,
        credits,
        prixChf: formaterChf(prixCentimesChf),
        montant: prixLocal(pack, devise, taux),
        devise,
        pays,
      },
    };
  } catch (e) {
    if (e instanceof DeviseSansTauxErreur) {
      return { ok: false, status: 400, erreur: 'Devise non disponible' };
    }
    console.error('[PAWAPAY_DEVIS] Configuration du compte illisible :', (e as Error)?.message);
    return { ok: false, status: 502, erreur: 'Service Mobile Money injoignable' };
  }
}
