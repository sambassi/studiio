// Corrections de traductions — cœur pur : validation, statuts, application, CSV.
import { describe, it, expect } from 'vitest';
import { validerTexte, appliquerCorrections, statutDe, construireLignes, compter, namespaceDe, variables, textesDesCorrections, LIMITE_TEXTE } from '@/lib/i18n/traductions';
import { lireCsv, ecrireCsv, colonnes } from '@/lib/i18n/csv';
import { fusionner } from '@/i18n/messages';

describe('validerTexte', () => {
  it('accepte un texte qui garde exactement les variables', () => {
    expect(validerTexte('Bonjour {nom}, il reste {n}', 'Mbote {nom}, {n} etikali')).toBeNull();
  });
  it('refuse une variable perdue, ajoutée ou renommée', () => {
    expect(validerTexte('Il reste {n}', 'Etikali')).toMatch(/Variables à conserver/);
    expect(validerTexte('Il reste {n}', 'Etikali {n} {x}')).toMatch(/Variables/);
    expect(validerTexte('Il reste {n}', 'Etikali {m}')).toMatch(/Variables/);
    expect(validerTexte('Aucune variable', 'Nouveau {x}')).toMatch(/aucune variable/);
  });
  it('refuse les balises HTML, sauf si le français en contient déjà', () => {
    expect(validerTexte('Texte', '<b>gras</b>')).toMatch(/Balises/);
    expect(validerTexte('A < B', 'A < B')).toBeNull();
  });
  it('refuse les caractères de contrôle et les textes démesurés', () => {
    expect(validerTexte('x', 'a\u0000b')).toMatch(/contrôle/);
    expect(validerTexte('x', 'a'.repeat(LIMITE_TEXTE + 1))).toMatch(/trop long/);
  });
  it('un texte vide n\'est pas jugé (c\'est un retrait)', () => {
    expect(validerTexte('Bonjour {n}', '   ')).toBeNull();
  });
  it('variables() est indépendant de l\'ordre', () => {
    expect(variables('{b} et {a}')).toBe(variables('{a} puis {b}'));
  });
});

describe('appliquerCorrections', () => {
  const surcouche = { common: { close: 'Kokanga', save: 'Kobómbisa' }, ui: { x: { a: 'A' } } };
  it('remplace, ajoute, et retire (texte vide → le français s\'affichera)', () => {
    const r = appliquerCorrections(surcouche, { 'common.close': 'Kokanga 2', 'common.new': 'Neuf', 'common.save': '' });
    expect(r).toEqual({ common: { close: 'Kokanga 2', new: 'Neuf' }, ui: { x: { a: 'A' } } });
  });
  it('ne mute jamais la surcouche d\'origine', () => {
    const copie = JSON.parse(JSON.stringify(surcouche));
    appliquerCorrections(surcouche, { 'common.close': 'Z', 'common.save': '' });
    expect(surcouche).toEqual(copie);
  });
  it('retirer une clé absente ou profonde inexistante ne plante pas', () => {
    expect(() => appliquerCorrections(surcouche, { 'zzz.y.w': '', 'common.nope': '' })).not.toThrow();
  });
  it('après fusion, une traduction retirée retombe en FRANÇAIS, jamais en clé brute', () => {
    const fr = { common: { close: 'Fermer', save: 'Enregistrer' } };
    const m = fusionner(fr, appliquerCorrections(surcouche, { 'common.save': '' }));
    expect(m).toEqual({ common: { close: 'Kokanga', save: 'Enregistrer' } });
  });
  it('textesDesCorrections ne transmet ni auteur ni statut de validation', () => {
    expect(textesDesCorrections({ a: { t: 'T', v: true, par: 'x@y', le: 'now' } })).toEqual({ a: 'T' });
  });
});

describe('statuts et compteurs', () => {
  it('manquante / validée / attestée / à vérifier / non validée', () => {
    expect(statutDe('', undefined, undefined).statut).toBe('manquante');
    expect(statutDe('T', { t: 'T', v: true }, undefined).statut).toBe('validee');
    expect(statutDe('T', { t: 'T', v: false }, undefined).statut).toBe('non_validee');
    expect(statutDe('T', undefined, { c: 'h', s: 'corpus' }).statut).toBe('non_validee_attestee');
    expect(statutDe('T', undefined, { c: 'm', s: '' }).statut).toBe('non_validee_a_verifier');
    expect(statutDe('T', undefined, undefined).statut).toBe('non_validee');
  });
  it('une correction retirée (texte vide) est « manquante » même si elle était validée', () => {
    expect(statutDe('', { t: '', v: true }, { c: 'h', s: '' }).statut).toBe('manquante');
  });
  const fr = { 'a.x': 'X', 'a.y': 'Y', 'b.z': 'Z', 'ui.fichier.k': 'K' };
  it('construireLignes + compter : une correction PRIME sur le catalogue', () => {
    const lignes = construireLignes({ fr, statique: { 'a.x': 'x1', 'a.y': 'y1' }, meta: { 'a.x': { c: 'h', s: 's' } }, corrections: { 'a.y': { t: 'y2', v: true }, 'b.z': { t: 'z2', v: false } } });
    const par = Object.fromEntries(lignes.map((l) => [l.cle, l]));
    expect(par['a.x'].statut).toBe('non_validee_attestee');
    expect(par['a.y']).toMatchObject({ texte: 'y2', statut: 'validee' });
    expect(par['b.z']).toMatchObject({ texte: 'z2', statut: 'non_validee', confiance: 'admin' });
    expect(par['ui.fichier.k'].statut).toBe('manquante');
    expect(compter(lignes)).toEqual({ total: 4, traduites: 3, validees: 1, attestees: 1, aVerifier: 0, nonValidees: 2, manquantes: 1, pourcentTraduit: 75 });
  });
  it('namespaceDe regroupe ui.<fichier>', () => {
    expect(namespaceDe('ui.appDashboardCinema.titre')).toBe('ui.appDashboardCinema');
    expect(namespaceDe('common.close')).toBe('common');
    expect(namespaceDe('ui.libelles')).toBe('ui');
  });
});

describe('CSV', () => {
  it('aller-retour avec guillemets, point-virgule et retours à la ligne', () => {
    const csv = ecrireCsv(['cle', 'francais', 'traduction'], [['a.b', 'Dis "oui" ; ou non', 'Ligne 1\nLigne 2'], ['c.d', 'x', '']]);
    const lu = lireCsv(csv);
    expect(lu[0]).toEqual(['cle', 'francais', 'traduction']);
    expect(lu[1]).toEqual(['a.b', 'Dis "oui" ; ou non', 'Ligne 1\nLigne 2']);
    expect(lu[2]).toEqual(['c.d', 'x', '']);
  });
  it('détecte la virgule, ignore le BOM et les lignes vides, accepte CRLF', () => {
    const lu = lireCsv('﻿key,translation\r\n\r\na.b,"Kokanga, ok"\r\n');
    expect(lu).toEqual([['key', 'translation'], ['a.b', 'Kokanga, ok']]);
  });
  it('colonnes : en-tête français ou anglais, insensible à la casse et aux accents', () => {
    expect(colonnes(['Clé', 'Français', 'Traduction'])).toEqual({ cle: 0, traduction: 2 });
    expect(colonnes(['KEY', 'x', 'Translation'])).toEqual({ cle: 0, traduction: 2 });
    expect(colonnes(['a', 'b'])).toBeNull();
  });
});
