/**
 * CINEMA IA — ce que le NAVIGATEUR voit d'un montage.
 *
 * Un segment porte un chemin LOGIQUE de media (`cinema/<film>/medias/<nom>`) :
 * c'est ce que le rendu serveur comprend. Le navigateur, lui, ne lit rien
 * directement dans le stockage : il passe par les routes authentifiees
 * `…/medias/<plan>` et `…/voix/<plan>`, qui relisent la cle en base. On
 * reecrit donc les URL ici, une fois, pour TOUTES les reponses.
 */
import type { MontageFilm } from '@/lib/cinema/montage';
import { hash } from '@/lib/cinema/empreinte';

export function urlMediaPlan(filmId: string, planId: string, urlLogique: string): string {
  return `/api/cinema/films/${filmId}/medias/${planId}?v=${hash(urlLogique)}`;
}

export function urlVoixPlan(filmId: string, planId: string, empreinteVoix: string): string {
  return `/api/cinema/films/${filmId}/voix/${planId}?v=${empreinteVoix}`;
}

export function presenterMontage(montage: MontageFilm, filmId: string, voixPrisesEnCharge: ReadonlyMap<string, string> = new Map()): MontageFilm {
  return {
    ...montage,
    segments: montage.segments.map((s) => ({
      ...s,
      media: s.media ? { ...s.media, url: urlMediaPlan(filmId, s.planId, s.media.url) } : null,
      voixUrl: s.voixUrl && voixPrisesEnCharge.has(s.planId) ? urlVoixPlan(filmId, s.planId, voixPrisesEnCharge.get(s.planId)!) : null,
    })),
  };
}
