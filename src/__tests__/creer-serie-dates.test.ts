import { describe, it, expect } from 'vitest';
import { batchDates, MAX_BATCH } from '@/lib/creer/batch';

/**
 * Série — dates du lot.
 *
 * Un lot de N vidéos occupe N jours CONSÉCUTIFS à partir de la date choisie,
 * en franchissant la fin du mois, de février et de l'année. L'ancienne règle
 * repartait en arrière dès qu'une date sortait du mois de départ : un lot de
 * 10 lancé le 25 d'un mois de 30 jours donnait 25..30 puis 19, 18, 17, 16 —
 * non consécutif, potentiellement dans le passé.
 */

const JOUR_MS = 24 * 60 * 60 * 1000;

/** Relecture telle que l'appelant la fait : midi local, à l'abri des bascules DST. */
const relire = (d: string) => new Date(`${d}T12:00:00`);

/** Différence en jours civils entre deux dates relues à midi local. */
const ecartJours = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / JOUR_MS);

describe('batchDates — progression calendaire, un jour après l autre', () => {
  it('le 25 d un mois de 30 jours, N=10 : 25..30 puis 1..4 du mois suivant', () => {
    expect(batchDates(new Date(2026, 8, 25, 12), 10)).toEqual([
      '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ]);
  });

  it('le 31 décembre passe au 1er janvier de l année suivante', () => {
    expect(batchDates(new Date(2026, 11, 31, 12), 3)).toEqual([
      '2026-12-31', '2027-01-01', '2027-01-02',
    ]);
  });

  it('février non bissextile (2027) : 28 puis 1er mars', () => {
    expect(batchDates(new Date(2027, 1, 26, 12), 5)).toEqual([
      '2027-02-26', '2027-02-27', '2027-02-28', '2027-03-01', '2027-03-02',
    ]);
  });

  it('février bissextile (2028) : 28, 29 puis 1er mars', () => {
    expect(batchDates(new Date(2028, 1, 27, 12), 5)).toEqual([
      '2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01', '2028-03-02',
    ]);
  });

  it('N=1 garde la date seule', () => {
    expect(batchDates(new Date(2026, 8, 25, 12), 1)).toEqual(['2026-09-25']);
  });

  it('N=10 : dix dates distinctes, strictement croissantes, jamais avant la base', () => {
    const base = new Date(2026, 8, 25, 12);
    const d = batchDates(base, 10);
    expect(d).toHaveLength(10);
    expect(new Set(d).size).toBe(10);
    for (let i = 1; i < d.length; i += 1) {
      expect(relire(d[i]).getTime()).toBeGreaterThan(relire(d[i - 1]).getTime());
    }
    for (const jour of d) {
      expect(relire(jour).getTime()).toBeGreaterThanOrEqual(relire(d[0]).getTime());
    }
  });

  it('chaque date relue à midi local vaut base + i jours', () => {
    // Deux bases : une qui franchit le mois, une qui franchit l'année.
    for (const base of [new Date(2026, 8, 25, 12), new Date(2026, 11, 28, 12)]) {
      const d = batchDates(base, 10);
      const origine = relire(d[0]);
      expect(ecartJours(base, origine)).toBe(0);
      d.forEach((jour, i) => {
        expect(ecartJours(origine, relire(jour))).toBe(i);
      });
    }
  });

  it('N au-dela de MAX_BATCH est plafonne, N invalide vaut 1', () => {
    expect(batchDates(new Date(2026, 8, 25, 12), 25)).toHaveLength(MAX_BATCH);
    expect(batchDates(new Date(2026, 8, 25, 12), 0)).toHaveLength(1);
    expect(batchDates(new Date(2026, 8, 25, 12), Number.NaN)).toHaveLength(1);
  });

  it("l'heure de la base n'influe pas : 00:00, 00:30, 12:00 et 23:30 donnent le meme lot", () => {
    const ref = batchDates(new Date(2026, 8, 25, 12), 10);
    for (const [h, m] of [[0, 0], [0, 30], [23, 30], [23, 59]] as const) {
      expect(batchDates(new Date(2026, 8, 25, h, m), 10)).toEqual(ref);
    }
  });

  describe('bases voisines d un changement d heure (Europe/Paris : 29 mars et 25 oct. 2026)', () => {
    // Le TZ du runner n'est pas forcement Paris : on ne fige donc aucune
    // valeur absolue liee a l'offset, on verifie que chaque date relue a midi
    // local vaut exactement base + i jours civils, et que le premier jour est
    // celui de la base. Si le runner EST en Europe/Paris, ces bases traversent
    // reellement la bascule ; sinon le test reste vrai et documente l'intention.
    const bases = [
      new Date(2026, 9, 24, 0, 30),   // veille du retour a l'heure d'hiver, juste apres minuit
      new Date(2026, 9, 24, 23, 30),  // veille, juste avant minuit
      new Date(2026, 9, 25, 0, 30),   // jour meme du retour a l'heure d'hiver
      new Date(2026, 2, 28, 0, 30),   // veille du passage a l'heure d'ete
      new Date(2026, 2, 28, 23, 30),
      new Date(2026, 2, 29, 0, 30),   // jour meme du passage a l'heure d'ete
      new Date(2026, 2, 29, 2, 30),   // heure locale inexistante a Paris ce jour-la
    ];

    for (const base of bases) {
      it(`base ${base.getFullYear()}-${base.getMonth() + 1}-${base.getDate()} ${base.getHours()}:${String(base.getMinutes()).padStart(2, '0')} : jours consecutifs`, () => {
        const d = batchDates(base, 10);
        expect(d).toHaveLength(10);
        // Le premier jour est le jour civil de la base, tel que le runner le voit.
        const attendu0 = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
        expect(d[0]).toBe(attendu0);
        // Chaque date suivante relue a midi local est exactement un jour civil plus loin.
        for (let i = 1; i < d.length; i += 1) {
          const prev = relire(d[i - 1]);
          const cur = relire(d[i]);
          expect(cur.getTime()).toBeGreaterThan(prev.getTime());
          // A midi local, deux jours consecutifs sont a 23, 24 ou 25 h d'ecart
          // selon la bascule ; arrondi, l'ecart est toujours 1 jour.
          expect(ecartJours(prev, cur)).toBe(1);
          // Le jour civil relu est bien celui ecrit (pas de glissement de minuit).
          expect(cur.getDate()).toBe(Number(d[i].slice(8, 10)));
        }
      });
    }
  });

  it('le format reste YYYY-MM-DD, en heure locale', () => {
    for (const jour of batchDates(new Date(2026, 8, 25, 12), 10)) {
      expect(jour).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Relire la chaîne en local redonne exactement le jour formaté.
      const r = relire(jour);
      const attendu = `${r.getFullYear()}-${String(r.getMonth() + 1).padStart(2, '0')}-${String(r.getDate()).padStart(2, '0')}`;
      expect(attendu).toBe(jour);
    }
  });
});
