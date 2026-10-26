/**
 * CINEMA IA — le port des TRAVAUX, et ses deux implementations.
 *
 * Les garanties sont ecrites DEUX fois a dessein : en SQL pour la production
 * (index unique partiel, bail, jeton de prise — voir la migration), et ici en
 * memoire pour que les tests de l'executeur puissent les exercer sans base.
 * Le test PostgreSQL reel (`tests-pg/cinema-ia.pg.test.ts`) prouve la version
 * SQL ; les tests unitaires prouvent que l'executeur s'y conforme.
 *
 * Le JETON DE PRISE est `tentatives` : chaque prise l'incremente. Toute
 * ecriture d'un executeur le porte ; si le bail a ete repris entre-temps, le
 * jeton ne correspond plus et l'ecriture est REFUSEE (`false`) — l'executeur
 * perime s'arrete au lieu d'ecraser l'executeur courant.
 */
import { randomUUID } from 'crypto';
import type { ClientBase } from '@/lib/cinema/stockage/depot-films';
import { messageBase } from '@/lib/cinema/stockage/depot-films';
import {
  TENTATIVES_MAX, estActif, progressionInitiale,
  type ProgressionTravail, type ResultatTravail, type Travail,
} from '@/lib/cinema/travaux/types';
import type { Film } from '@/lib/cinema/types';

export interface DemandeCreation {
  film: Pick<Film, 'id' | 'scenes'>;
  proprietaire: string;
  cle: string;
  scenesDemandees: string[];
  maxActifs: number;
}

export type ResultatCreation =
  | { cree: boolean; motif: null; travail: Travail }
  | { cree: false; motif: 'film_absent' | 'trop_de_travaux'; travail: null };

export interface DepotTravaux {
  /** Un seul travail actif par film : un second appel RETROUVE le premier (`cree: false`). */
  creerOuRetrouver(d: DemandeCreation): Promise<ResultatCreation>;
  lire(id: string, proprietaire: string): Promise<Travail | null>;
  /** Le travail actif du film, sinon le plus recent. */
  dernierDuFilm(filmId: string, proprietaire: string): Promise<Travail | null>;
  /** Prend un travail `en_attente` ou dont le bail a expire. `null` si quelqu'un d'autre l'a pris. */
  reclamer(id: string, bailS: number, maintenant?: Date): Promise<Travail | null>;
  /**
   * Note la progression ET renouvelle le bail. Rend `perdu: true` si le jeton
   * ne correspond plus (bail repris, travail termine) : l'appelant s'arrete.
   */
  noter(id: string, jeton: number, progression: ProgressionTravail, bailS: number): Promise<{ perdu: boolean; annulation: boolean }>;
  terminer(id: string, jeton: number, resultat: ResultatTravail, progression: ProgressionTravail): Promise<boolean>;
  echouer(id: string, jeton: number, erreur: string, reference: string | null): Promise<boolean>;
  annuler(id: string, jeton: number): Promise<boolean>;
  demanderAnnulation(id: string, proprietaire: string): Promise<Travail | null>;
  /** Les travaux a (re)prendre : en attente, ou en cours au bail expire. */
  aReprendre(maintenant?: Date, limite?: number): Promise<Array<{ id: string; proprietaire: string }>>;
}

// ─────────────────────────────────────────────────────────────────────────
// Memoire
// ─────────────────────────────────────────────────────────────────────────

export function depotTravauxMemoire(horloge: () => Date = () => new Date()): DepotTravaux & { tous(): Travail[] } {
  const lignes = new Map<string, Travail>();
  const iso = (d: Date) => d.toISOString();
  const cloner = (t: Travail): Travail => structuredClone(t);
  const expire = (t: Travail, maintenant: Date) => t.bailJusqua !== null && new Date(t.bailJusqua).getTime() < maintenant.getTime();

  return {
    tous: () => [...lignes.values()].map(cloner),

    async creerOuRetrouver(d) {
      // Un film inconnu du proprietaire n'existe pas pour lui : le depot de
      // films est la source de verite, l'appelant l'a deja verifie. Ici on
      // ne garde que les regles propres aux travaux.
      const actif = [...lignes.values()].find((t) => t.filmId === d.film.id && t.proprietaire === d.proprietaire && estActif(t.statut));
      if (actif) return { cree: false, motif: null, travail: cloner(actif) };
      const nbActifs = [...lignes.values()].filter((t) => t.proprietaire === d.proprietaire && estActif(t.statut)).length;
      if (nbActifs >= d.maxActifs) return { cree: false, motif: 'trop_de_travaux', travail: null };
      const maintenant = iso(horloge());
      const t: Travail = {
        id: randomUUID(), filmId: d.film.id, proprietaire: d.proprietaire, statut: 'en_attente', cle: d.cle,
        scenesDemandees: d.scenesDemandees, progression: progressionInitiale(d.film), resultat: null, erreur: null,
        reference: null, tentatives: 0, annulationDemandee: false, bailJusqua: null, creeLe: maintenant, majLe: maintenant, termineLe: null,
      };
      lignes.set(t.id, t);
      return { cree: true, motif: null, travail: cloner(t) };
    },

    async lire(id, proprietaire) {
      const t = lignes.get(id);
      return t && t.proprietaire === proprietaire ? cloner(t) : null;
    },

    async dernierDuFilm(filmId, proprietaire) {
      const mes = [...lignes.values()].filter((t) => t.filmId === filmId && t.proprietaire === proprietaire);
      if (!mes.length) return null;
      const actif = mes.find((t) => estActif(t.statut));
      if (actif) return cloner(actif);
      return cloner(mes.sort((a, b) => b.creeLe.localeCompare(a.creeLe))[0]);
    },

    async reclamer(id, bailS, maintenant = horloge()) {
      const t = lignes.get(id);
      if (!t) return null;
      if (t.statut === 'en_cours' && expire(t, maintenant) && t.tentatives >= TENTATIVES_MAX) {
        t.statut = 'echec'; t.erreur = 'trop de tentatives sans aboutir'; t.termineLe = iso(maintenant); t.majLe = iso(maintenant);
        return null;
      }
      const prenable = t.tentatives < TENTATIVES_MAX && (t.statut === 'en_attente' || (t.statut === 'en_cours' && expire(t, maintenant)));
      if (!prenable) return null;
      t.statut = 'en_cours';
      t.tentatives += 1;
      t.bailJusqua = iso(new Date(maintenant.getTime() + bailS * 1000));
      t.majLe = iso(maintenant);
      return cloner(t);
    },

    async noter(id, jeton, progression, bailS) {
      const t = lignes.get(id);
      if (!t || t.statut !== 'en_cours' || t.tentatives !== jeton) return { perdu: true, annulation: false };
      const maintenant = horloge();
      t.progression = progression;
      t.bailJusqua = iso(new Date(maintenant.getTime() + bailS * 1000));
      t.majLe = iso(maintenant);
      return { perdu: false, annulation: t.annulationDemandee };
    },

    async terminer(id, jeton, resultat, progression) {
      const t = lignes.get(id);
      if (!t || t.statut !== 'en_cours' || t.tentatives !== jeton) return false;
      t.statut = 'termine'; t.resultat = resultat; t.progression = progression; t.bailJusqua = null;
      t.termineLe = t.majLe = iso(horloge());
      return true;
    },

    async echouer(id, jeton, erreur, reference) {
      const t = lignes.get(id);
      if (!t || t.statut !== 'en_cours' || t.tentatives !== jeton) return false;
      t.statut = 'echec'; t.erreur = erreur.slice(0, 500); t.reference = reference; t.bailJusqua = null;
      t.termineLe = t.majLe = iso(horloge());
      return true;
    },

    async annuler(id, jeton) {
      const t = lignes.get(id);
      if (!t || t.statut !== 'en_cours' || t.tentatives !== jeton) return false;
      t.statut = 'annule'; t.bailJusqua = null; t.termineLe = t.majLe = iso(horloge());
      return true;
    },

    async demanderAnnulation(id, proprietaire) {
      const t = lignes.get(id);
      if (!t || t.proprietaire !== proprietaire) return null;
      if (t.statut === 'en_attente') {
        // Rien n'a commence : on annule tout de suite.
        t.statut = 'annule'; t.annulationDemandee = true; t.termineLe = t.majLe = iso(horloge());
      } else if (t.statut === 'en_cours') {
        t.annulationDemandee = true; t.majLe = iso(horloge());
      }
      return cloner(t);
    },

    async aReprendre(maintenant = horloge(), limite = 10) {
      return [...lignes.values()]
        .filter((t) => t.tentatives < TENTATIVES_MAX && (t.statut === 'en_attente' || (t.statut === 'en_cours' && expire(t, maintenant))))
        .slice(0, limite).map((t) => ({ id: t.id, proprietaire: t.proprietaire }));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// PostgreSQL via PostgREST
// ─────────────────────────────────────────────────────────────────────────

interface LigneTravail {
  id: string; film_id: string; proprietaire: string; statut: Travail['statut']; cle: string;
  scenes_demandees: string[]; progression: ProgressionTravail; resultat: ResultatTravail | null;
  erreur: string | null; reference: string | null; tentatives: number; annulation_demandee: boolean;
  bail_jusqua: string | null; cree_le: string; maj_le: string; termine_le: string | null;
}

export function travailDepuisLigne(l: LigneTravail): Travail {
  return {
    id: l.id, filmId: l.film_id, proprietaire: l.proprietaire, statut: l.statut, cle: l.cle,
    scenesDemandees: l.scenes_demandees ?? [], progression: l.progression, resultat: l.resultat,
    erreur: l.erreur, reference: l.reference, tentatives: l.tentatives, annulationDemandee: l.annulation_demandee,
    bailJusqua: l.bail_jusqua, creeLe: l.cree_le, majLe: l.maj_le, termineLe: l.termine_le,
  };
}

export function depotTravauxPostgres(base: () => ClientBase): DepotTravaux {
  const T = 'cinema_travaux';
  const maintenant = () => new Date().toISOString();

  return {
    async creerOuRetrouver(d) {
      const { data, error } = await base().rpc('cinema_travail_creer', {
        p_film_id: d.film.id, p_proprietaire: d.proprietaire, p_cle: d.cle,
        p_scenes: d.scenesDemandees, p_progression: progressionInitiale(d.film), p_max_actifs: d.maxActifs,
      });
      if (error) throw new Error(messageBase(error));
      const r = data as { cree: boolean; motif: string | null; travail: LigneTravail | null };
      if (r.motif === 'film_absent' || r.motif === 'trop_de_travaux') return { cree: false, motif: r.motif, travail: null };
      if (!r.travail) throw new Error('reponse de cinema_travail_creer incomplete');
      const t = travailDepuisLigne(r.travail);
      return { cree: r.cree, motif: null, travail: t };
    },

    async lire(id, proprietaire) {
      const { data, error } = await base().from(T).select('*').eq('id', id).eq('proprietaire', proprietaire).maybeSingle();
      if (error) throw new Error(messageBase(error));
      return data ? travailDepuisLigne(data as LigneTravail) : null;
    },

    async dernierDuFilm(filmId, proprietaire) {
      const { data, error } = await base().from(T).select('*').eq('film_id', filmId).eq('proprietaire', proprietaire)
        .order('cree_le', { ascending: false }).limit(5);
      if (error) throw new Error(messageBase(error));
      const lignes = (data ?? []) as LigneTravail[];
      const choisi = lignes.find((l) => l.statut === 'en_attente' || l.statut === 'en_cours') ?? lignes[0];
      return choisi ? travailDepuisLigne(choisi) : null;
    },

    async reclamer(id, bailS) {
      const { data, error } = await base().rpc('cinema_travail_reclamer', { p_id: id, p_bail_s: bailS });
      if (error) throw new Error(messageBase(error));
      return data ? travailDepuisLigne(data as LigneTravail) : null;
    },

    async noter(id, jeton, progression, bailS) {
      const bail = new Date(Date.now() + bailS * 1000).toISOString();
      const { data, error } = await base().from(T)
        .update({ progression, bail_jusqua: bail, maj_le: maintenant() })
        .eq('id', id).eq('statut', 'en_cours').eq('tentatives', jeton)
        .select('annulation_demandee');
      if (error) throw new Error(messageBase(error));
      if (!Array.isArray(data) || data.length !== 1) return { perdu: true, annulation: false };
      return { perdu: false, annulation: data[0].annulation_demandee === true };
    },

    async terminer(id, jeton, resultat, progression) {
      const { data, error } = await base().from(T)
        .update({ statut: 'termine', resultat, progression, bail_jusqua: null, termine_le: maintenant(), maj_le: maintenant() })
        .eq('id', id).eq('statut', 'en_cours').eq('tentatives', jeton).select('id');
      if (error) throw new Error(messageBase(error));
      return Array.isArray(data) && data.length === 1;
    },

    async echouer(id, jeton, erreur, reference) {
      const { data, error } = await base().from(T)
        .update({ statut: 'echec', erreur: erreur.slice(0, 500), reference, bail_jusqua: null, termine_le: maintenant(), maj_le: maintenant() })
        .eq('id', id).eq('statut', 'en_cours').eq('tentatives', jeton).select('id');
      if (error) throw new Error(messageBase(error));
      return Array.isArray(data) && data.length === 1;
    },

    async annuler(id, jeton) {
      const { data, error } = await base().from(T)
        .update({ statut: 'annule', bail_jusqua: null, termine_le: maintenant(), maj_le: maintenant() })
        .eq('id', id).eq('statut', 'en_cours').eq('tentatives', jeton).select('id');
      if (error) throw new Error(messageBase(error));
      return Array.isArray(data) && data.length === 1;
    },

    async demanderAnnulation(id, proprietaire) {
      // En attente : annulation immediate. En cours : un drapeau que
      // l'executeur lit a chaque note.
      const direct = await base().from(T)
        .update({ statut: 'annule', annulation_demandee: true, termine_le: maintenant(), maj_le: maintenant() })
        .eq('id', id).eq('proprietaire', proprietaire).eq('statut', 'en_attente').select('*');
      if (direct.error) throw new Error(messageBase(direct.error));
      if (Array.isArray(direct.data) && direct.data.length === 1) return travailDepuisLigne(direct.data[0] as LigneTravail);
      const drapeau = await base().from(T)
        .update({ annulation_demandee: true, maj_le: maintenant() })
        .eq('id', id).eq('proprietaire', proprietaire).eq('statut', 'en_cours').select('*');
      if (drapeau.error) throw new Error(messageBase(drapeau.error));
      if (Array.isArray(drapeau.data) && drapeau.data.length === 1) return travailDepuisLigne(drapeau.data[0] as LigneTravail);
      return this.lire(id, proprietaire);
    },

    async aReprendre(instant = new Date(), limite = 10) {
      const { data, error } = await base().from(T).select('id, proprietaire')
        .or(`statut.eq.en_attente,and(statut.eq.en_cours,bail_jusqua.lt.${instant.toISOString()})`)
        .lt('tentatives', TENTATIVES_MAX).limit(limite);
      if (error) throw new Error(messageBase(error));
      return (data ?? []) as Array<{ id: string; proprietaire: string }>;
    },
  };
}
