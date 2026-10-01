/**
 * COHÉRENCE LIBELLÉ / CHIFFRE d'une carte — partagée (Créer, Autopilote,
 * conseiller, base de contenus). Module PUR.
 *
 * Interdit : « MÉMOIRE BOOSTÉE -76% » — un libellé qui annonce une HAUSSE
 * avec une valeur NÉGATIVE (ou l'inverse). Lexical et prudent : sans mot de
 * sens explicite, la carte est jugée cohérente. N'invente aucun chiffre :
 * la seule réécriture proposée reprend la description (« réduit le risque »).
 */

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const HAUSSE = /\b(boost\w*|augment\w*|hausse\w*|gain\w*|renforc\w*|amelior\w*|accru\w*|maximis\w*|decupl\w*|double\w*)\b/;
const BAISSE = /\b(redui\w*|reduct\w*|baiss\w*|moins|chute\w*|perte\w*|diminu\w*|anti\w*|risque\w*|stop\w*|bas)\b/;

export type SigneValeur = 'negatif' | 'positif' | 'neutre';

export function signeValeur(valeur: string | null | undefined): SigneValeur {
  const v = (valeur ?? '').trim();
  if (/^[-−–]\s*\d/.test(v)) return 'negatif';
  if (/^\+\s*\d/.test(v)) return 'positif';
  return 'neutre';
}

export interface CoherenceCarte {
  ok: boolean;
  probleme: string | null;
  /** Libellé compatible, SEULEMENT si la description le justifie ; sinon null. */
  proposition: string | null;
}

export function coherenceCarte(titre: string | null | undefined, valeur: string | null | undefined, description?: string | null): CoherenceCarte {
  const t = sansAccents(titre ?? '');
  const signe = signeValeur(valeur);
  const hausse = HAUSSE.test(t);
  const baisse = BAISSE.test(t);
  if (signe === 'negatif' && hausse && !baisse) {
    const d = sansAccents(description ?? '');
    return {
      ok: false,
      probleme: `« ${titre} » annonce une hausse, mais la valeur « ${valeur} » est négative.`,
      proposition: /risque/.test(d) && /redui|reduct|baiss|diminu/.test(d) ? 'RISQUE RÉDUIT' : null,
    };
  }
  if (signe === 'positif' && baisse && !hausse) {
    return { ok: false, probleme: `« ${titre} » annonce une baisse, mais la valeur « ${valeur} » est positive.`, proposition: null };
  }
  return { ok: true, probleme: null, proposition: null };
}
