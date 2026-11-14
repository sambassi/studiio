// CSV des traductions : lecture tolérante (; ou , ; guillemets doublés ; BOM) et écriture.
// Colonnes reconnues (en-tête, insensible à la casse/accents) : cle|key, francais|fr, traduction|translation.
export function lireCsv(texte: string): string[][] {
  const t = texte.replace(/^﻿/, '');
  const premiere = t.split(/\r?\n/, 1)[0] || '';
  const sep = (premiere.match(/;/g) || []).length >= (premiere.match(/,/g) || []).length ? ';' : ',';
  const lignes: string[][] = [];
  let l: string[] = []; let c = ''; let q = false;
  for (let i = 0; i < t.length; i += 1) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { c += '"'; i += 1; } else if (ch === '"') q = false; else c += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { l.push(c); c = ''; }
    else if (ch === '\n') { l.push(c); lignes.push(l); l = []; c = ''; }
    else if (ch !== '\r') c += ch;
  }
  if (c || l.length) { l.push(c); lignes.push(l); }
  return lignes.filter((r) => r.some((x) => x.trim() !== ''));
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Index des colonnes utiles, ou null si l'en-tête ne contient pas clé + traduction. */
export function colonnes(entete: string[]): { cle: number; traduction: number } | null {
  const n = entete.map(norm);
  const cle = n.findIndex((x) => x === 'cle' || x === 'key');
  const traduction = n.findIndex((x) => x === 'traduction' || x === 'translation');
  return cle >= 0 && traduction >= 0 ? { cle, traduction } : null;
}

const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
export function ecrireCsv(entete: string[], lignes: string[][]): string {
  return [entete, ...lignes].map((r) => r.map(esc).join(';')).join('\n') + '\n';
}
