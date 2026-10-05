/**
 * QUALITY GATE UNIQUE AVANT RENDU (#504) — Créer et Autopilote.
 *
 * Les règles sont appliquées EN AMONT par le moteur (verrou du montage,
 * mise en page des surimpressions) ; ce contrôle vérifie, juste avant de
 * composer, que le résultat les respecte vraiment, et le DIT.
 *
 *  - un contrôle BLOQUANT qui échoue arrête le rendu AVANT toute réservation
 *    (rien n'est composé ni débité) : il signale un défaut qui ne peut pas
 *    sortir tel quel (passage répété, CTA de l'utilisateur absent, carte
 *    incomplète) ;
 *  - les autres sont journalisés (et écrits en métadonnées) : ce sont des
 *    mesures de qualité, corrigées automatiquement en amont.
 *
 * Mesures seulement : aucune reconnaissance de visage, de lieu ou de scène.
 */
import type { MesureSegment, RapportPlan } from '@/lib/creer/smart-montage-regles';
import { matchCartesImages, estNoirEtBlanc } from '@/lib/creer/smart-montage-regles';
import type { OverlaysMontage } from '@/lib/creer/overlays';
import { bilanCartesSurimpression } from '@/lib/creer/validation-rendu';
import { CTA_LARGEUR_PART } from '@/lib/creer/surimpressions-mise-en-page';

export type CodeControle =
  | 'UNIQUE_RUSH_RULE' | 'CTA_FULL_TEXT' | 'CTA_SAFE_ZONE' | 'FIRST_BADGE_TIMING' | 'BADGES_COMPLETE'
  | 'BADGE_VISUAL_FIT' | 'COLOR_CONTINUITY' | 'FREEZE_RULE' | 'BEAT_RULE';

export interface Controle { code: CodeControle; ok: boolean; bloquant: boolean; detail: string }

export interface EntreeControle {
  profil: string;
  /** Mesures du plan (`mesuresSegments`), `null` si le montage n'est pas un plan smart montage. */
  mesures: ReadonlyArray<MesureSegment> | null;
  rapport: RapportPlan | null;
  overlays: OverlaysMontage | null;
  cartes: ReadonlyArray<{ title?: string | null; value?: string | null }>;
  /** Textes CTA réellement rendus. */
  cta: { texte: string; sousTexte?: string | null };
  /** CTA saisi par l'utilisateur (brief), s'il existe. */
  ctaUtilisateur?: string | null;
  /** Une voix de titre impose-t-elle une accroche plus longue ? */
  voixTitre?: boolean;
  /** Le rendu passe-t-il par le pilote anti-gels (Créer) ou un moteur image par image (Autopilote) ? */
  antiGels: boolean;
}

const VERROUILLES = new Set(['CARDIO_DANCE']);

export function controleQualite(e: EntreeControle): Controle[] {
  const verrou = VERROUILLES.has(e.profil);
  const out: Controle[] = [];
  const ajouter = (code: CodeControle, ok: boolean, bloquant: boolean, detail: string) => out.push({ code, ok, bloquant, detail });

  // 1. Aucun passage de rush montré deux fois.
  const doublons = e.rapport?.DUPLICATE_SEGMENTS ?? 0;
  ajouter('UNIQUE_RUSH_RULE', !verrou || doublons === 0, verrou, `${doublons} passage(s) répété(s)`);

  // 2. Le CTA de l'utilisateur, tel quel.
  const attendu = (e.ctaUtilisateur ?? '').trim();
  const rendu = [e.cta.texte, e.cta.sousTexte ?? ''].map((t) => t.trim());
  ajouter('CTA_FULL_TEXT', !attendu || rendu.includes(attendu), true,
    attendu ? (rendu.includes(attendu) ? 'CTA utilisateur rendu tel quel' : `CTA utilisateur absent du rendu (« ${attendu} »)`) : 'aucun CTA utilisateur');

  // 3. Zone sûre du CTA : cadre ≤ 80 % de la largeur (marges ≥ 10 %).
  ajouter('CTA_SAFE_ZONE', CTA_LARGEUR_PART <= 0.8, false, `largeur ${Math.round(CTA_LARGEUR_PART * 100)} %`);

  // 4. Premier badge vers 2 s (danse, sans voix de titre).
  const premiere = e.overlays?.cartes[0]?.debut ?? null;
  const timingOk = !verrou || e.voixTitre || premiere === null || (premiere >= 1.8 - 1e-6 && premiere <= 2.5 + 1e-6);
  ajouter('FIRST_BADGE_TIMING', timingOk, false, premiere === null ? 'aucune carte' : `première carte à ${premiere} s`);

  // 5. Cartes complètes (icône facultative ; titre ET valeur obligatoires).
  const bilan = bilanCartesSurimpression(e.cartes, e.overlays?.cartes ?? []);
  ajouter('BADGES_COMPLETE', !e.overlays || bilan.incompletes.length === 0, !!e.overlays,
    `${bilan.valides}/${bilan.attendues} complètes${bilan.sansFenetre.length ? `, sans fenêtre : ${bilan.sansFenetre.join(', ')}` : ''}`);

  // 6. Cartes posées sur des plans lisibles (mesures).
  const accords = e.mesures && e.overlays
    ? matchCartesImages(e.mesures, e.overlays.cartes, e.cartes.map((c) => c.title ?? ''))
    : [];
  const faibles = accords.filter((a) => a.ajustement !== null && a.ajustement < 0.5);
  ajouter('BADGE_VISUAL_FIT', faibles.length === 0, false,
    accords.length ? accords.map((a) => `${a.titre} ${a.ajustement ?? '—'}`).join(' · ') : 'non mesurable');

  // 7. Continuité couleur.
  const sats = (e.mesures ?? []).map((s) => s.saturation);
  const mesurable = sats.length > 0 && sats.every((s) => typeof s === 'number');
  const majoriteCouleur = mesurable && sats.filter((s) => !estNoirEtBlanc(s)).length >= sats.length / 2;
  const nb = (e.mesures ?? []).reduce((t, s) => t + (estNoirEtBlanc(s.saturation) ? s.fin - s.debut : 0), 0);
  const ruptures = e.rapport?.COLOR_STYLE_BREAKS ?? 0;
  ajouter('COLOR_CONTINUITY', !verrou || !majoriteCouleur || (nb === 0 && ruptures === 0), false,
    mesurable ? `noir et blanc ${Math.round(nb * 100) / 100} s, ruptures ${ruptures}` : 'non mesurable');

  // 8. Anti-gels (#498).
  ajouter('FREEZE_RULE', e.antiGels, false, e.antiGels ? 'lecture pilotée (double tampon) ou rendu image par image' : 'non garanti');

  // 9. Coupes sur les percussions (#499).
  const total = e.rapport?.CUTS_TOTAL ?? 0;
  const sur = e.rapport?.CUTS_PERCUSSION_LE_80MS ?? null;
  ajouter('BEAT_RULE', sur === null || total === 0 || sur / total >= 0.6, false,
    sur === null ? 'pas de musique analysée' : `${sur}/${total} coupes à ≤ 80 ms d'une percussion`);

  return out;
}

/** Message d'arrêt (contrôles bloquants en échec), ou `null`. */
export function erreurQualite(controles: ReadonlyArray<Controle>): string | null {
  const ko = controles.filter((c) => c.bloquant && !c.ok);
  if (!ko.length) return null;
  return `Contrôle qualité : ${ko.map((c) => `${c.code} (${c.detail})`).join(' ; ')}. Rien n’a été composé ni débité.`;
}
