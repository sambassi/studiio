/** Lecture et sélection des scénarios du banc. Pur (le test d'existence des fichiers est injecté). */
export interface ScenarioBanc {
  id: string; titre: string; theme: string; objectif: string; cibleSecondes: number; rushs: string[]; demande: string;
}

export function scenariosPrets(
  scenarios: ReadonlyArray<ScenarioBanc>, existe: (fichier: string) => boolean,
): { prets: ScenarioBanc[]; ignores: Array<{ id: string; manquants: string[] }> } {
  const prets: ScenarioBanc[] = [];
  const ignores: Array<{ id: string; manquants: string[] }> = [];
  for (const s of scenarios) {
    const manquants = s.rushs.filter((r) => !existe(r));
    if (manquants.length) ignores.push({ id: s.id, manquants }); else prets.push(s);
  }
  return { prets, ignores };
}

/** Codes d'étiquettes aveugles, mélangés de façon REPRODUCTIBLE (même scénario ⇒ même ordre). */
export function codesAveugles(graine: string, n: number): string[] {
  let h = 2166136261;
  for (const c of graine) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
  const lettres = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('');
  for (let i = lettres.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [lettres[i], lettres[j]] = [lettres[j], lettres[i]]; }
  return lettres.slice(0, n);
}
