/**
 * CINEMA IA — REGLER LES MINUTES SUR LE FILM REELLEMENT PRODUIT.
 *
 * Les generations reservent des minutes PREVUES. Le rendu final (gratuit, local) les
 * regle sur la duree REELLE : il reserve l'ajustement AVANT de rendre (refus si les
 * minutes manquent), le finalise sur la duree mesuree, et le libere si le rendu
 * n'aboutit pas. Hors regime `abonnement`, rien n'est fait : le rendu reste libre.
 */
import { regimeCinema, MESSAGE_PERIODE } from '@/lib/cinema/abonnement/regime';
import { reserverProduction, finaliserProduction, confirmerQuota } from '@/lib/cinema/abonnement/depot';
import { messageRefus } from '@/lib/cinema/abonnement/quotas';

export interface QuotaProduction {
  /** `reserve: false` : film non concerne (aucune generation dans la periode, ou hors abonnement). */
  reserver(userId: string, filmId: string, dureeS: number, reference: string): Promise<{ ok: true; reserve: boolean } | { ok: false; message: string }>;
  finaliser(userId: string, reference: string, dureeReelleS: number): Promise<void>;
  liberer(userId: string, reference: string): Promise<void>;
}

export const QUOTA_PRODUCTION_BASE: QuotaProduction = {
  async reserver(userId, filmId, dureeS, reference) {
    const regime = await regimeCinema(userId);
    if (regime.type === 'credits' || regime.type === 'cout_reel') return { ok: true, reserve: false };
    if (regime.type === 'refus') return { ok: false, message: regime.message };
    if (!regime.periode) return { ok: false, message: MESSAGE_PERIODE };
    const r = await reserverProduction({
      userId, periodeDebut: regime.periode.debut, reference, filmId,
      dureeS: Math.max(0, Math.ceil(dureeS)), maxSecondes: regime.formule.secondesParMois,
    });
    return r.ok ? { ok: true, reserve: r.concerne } : { ok: false, message: messageRefus(r.motif) };
  },
  // Un echec d'ecriture laisse la reservation a la duree PREVUE : comptee, jamais sous-comptee.
  async finaliser(userId, reference, dureeReelleS) {
    await finaliserProduction(userId, reference, Math.max(0, Math.ceil(dureeReelleS))).catch(() => false);
  },
  async liberer(userId, reference) {
    await confirmerQuota(userId, reference, 'liberee').catch(() => false);
  },
};

export const referenceProduction = (travailId: string, jeton: number) => `cinema-production:${travailId}:${jeton}`;
