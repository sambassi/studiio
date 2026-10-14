/**
 * ANTI-RÉGRESSION — bugs signalés DEUX fois (Mon avatar › Voix & Prononciation) :
 *
 *   A. « Audio complet » n'affiche plus le lecteur blanc natif (`<audio controls>`) ;
 *   B. pré-écoute et Audio complet utilisent LE MÊME composant (`LecteurVoixCompact`) ;
 *   C. un audio déjà généré est relu tel quel : 0 nouvel appel fournisseur ;
 *   D. « lien en bio » et «  lien en bio  » (casse, espaces, Unicode) sont identiques ;
 *   E. une suggestion identique est rejetée — le champ n'est pas touché ;
 *   F. une suggestion différente est acceptée.
 * Plus : les entrées identiques déjà enregistrées sont signalées, jamais
 * appliquées, jamais supprimées sans geste ; les corrections utiles restent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import MaVoixPanel from '@/components/voice/MaVoixPanel';
import {
  cleAffiche, prononciationIdentique, prononciationValide, lirePrononciations, lirePrononciationsIdentiques, scriptParle,
} from '@/lib/voice/prononciations';
import { suggestionUtile, MESSAGE_AUCUNE_SUGGESTION } from '@/lib/voice/suggestion-prononciation';

const V1 = '44444444-4444-4444-8444-000000000001';
const URL_AUDIO = 'https://studiio.pro/storage/v1/object/public/audio/u/voice/audio-complet-existant.mp3';
const UTILES = [
  { affiche: 'Afroboost', prononce: 'Afro-Boust' },
  { affiche: '-33%', prononce: 'moins 33 pourcent' },
  { affiche: '3-en-1 OS RENFORCÉS', prononce: 'trois en un os renforcés' },
];
const appels: Array<{ url: string; methode: string; body?: unknown }> = [];
let identiques: Array<{ affiche: string; prononce: string }> = [];
let suggestionServeur: unknown = { suggestion: null, source: 'aucune', message: MESSAGE_AUCUNE_SUGGESTION };

function stub() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    appels.push({ url: u, methode: init?.method ?? 'GET', body });
    const json = (status: number, b: unknown) => ({ ok: status < 400, status, json: async () => b, headers: new Headers() } as unknown as Response);
    if (u === '/api/voice/profil') {
      return json(200, { success: true, data: {
        voix: [{ id: V1, nom: 'Bassi', fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-08-01', utilisable: true }],
        choix: null, voixResolue: { id: V1, nom: 'Bassi', fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-08-01', utilisable: true },
        motifVoix: null, messageVoix: null, ecouteDisponible: true, prononciations: UTILES, prononciationsIdentiques: identiques,
      } });
    }
    if (u === '/api/voice/profil/prononciations') {
      const retirer: string[] = body?.retirerIdentiques ?? [];
      return json(200, { success: true, data: { prononciations: body.prononciations, prononciationsIdentiques: identiques.filter((p) => !retirer.includes(p.affiche)) } });
    }
    if (u === '/api/voice/prononciations/suggestion') return json(200, { success: true, data: suggestionServeur });
    if (u === '/api/credits/balance') return json(200, { ok: true, politique: 'credits', balance: 42 });
    if (u === '/api/voice/audio-complet') {
      return json(200, { success: true, url: URL_AUDIO, creditsDebites: 0, cout: 1, caracteres: 20, dejaGenere: true });
    }
    if (u === '/api/voice/ecoute') return { ok: true, status: 200, blob: async () => new Blob(['AUDIO']), headers: new Headers() } as unknown as Response;
    return json(404, {});
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  appels.length = 0; identiques = [];
  suggestionServeur = { suggestion: null, source: 'aucune', message: MESSAGE_AUCUNE_SUGGESTION };
  (globalThis as unknown as { URL: typeof URL }).URL.createObjectURL = () => 'blob:preecoute';
  (globalThis as unknown as { URL: typeof URL }).URL.revokeObjectURL = () => {};
  stub();
});
afterEach(() => { cleanup(); });

const q = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T;
const champAffiche = () => q<HTMLInputElement>('[data-prononciation-affiche]');
const champPrononce = () => q<HTMLInputElement>('[data-prononciation-prononce]');

describe('A/B/C — un seul lecteur Studiio, jamais le lecteur blanc', () => {
  it('A+C. Audio complet : lecteur Studiio, même URL, aucun `controls`, aucun appel de plus', async () => {
    render(<MaVoixPanel />);
    await waitFor(() => expect(q('[data-audio-complet-texte]')).not.toBeNull());
    fireEvent.change(q('[data-audio-complet-texte]'), { target: { value: 'Texte déjà généré auparavant' } });
    fireEvent.click(q('[data-audio-complet-generer]'));
    await waitFor(() => expect(q('[data-audio-complet-resultat]')).not.toBeNull());
    const avant = appels.length;
    const zone = q('[data-audio-complet-lecteur]');
    expect(zone.querySelector('[data-lecteur-voix]')).not.toBeNull();
    expect(zone.querySelector('audio')!.getAttribute('src')).toBe(URL_AUDIO);
    expect(document.querySelectorAll('audio[controls]').length).toBe(0);
    expect(q('[data-audio-complet-telecharger]').getAttribute('href')).toBe(URL_AUDIO);
    // Lire / mettre en pause : aucun appel réseau (ni synthèse, ni débit).
    fireEvent.click(zone.querySelector('[data-lecteur-voix-bouton]')!);
    await new Promise((r) => setTimeout(r, 20));
    expect(appels.length).toBe(avant);
    expect(appels.filter((a) => a.url === '/api/voice/audio-complet')).toHaveLength(1);
    expect(q('[data-audio-complet-resultat]').textContent).toContain('Déjà généré : aucun crédit débité.');
  });

  it('B. pré-écoute et Audio complet importent LE MÊME composant ; aucun `<audio controls>` dans les composants voix', () => {
    const dossier = join(process.cwd(), 'src/components/voice');
    const lire = (f: string) => readFileSync(join(dossier, f), 'utf8');
    const importLecteur = "import LecteurVoixCompact from '@/components/voice/LecteurVoixCompact';";
    expect(lire('MaVoixPanel.tsx')).toContain(importLecteur);
    expect(lire('AudioCompletSection.tsx')).toContain(importLecteur);
    expect(lire('AudioCompletSection.tsx')).toContain('<LecteurVoixCompact src={audioComplet.url} />');
    // Le CODE seulement (les commentaires peuvent citer ce qu'on a remplacé).
    const code = (f: string) => lire(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const f of ['MaVoixPanel.tsx', 'AudioCompletSection.tsx', 'LecteurVoixCompact.tsx']) {
      expect(code(f), f).not.toMatch(/<audio[^>]*\scontrols\b/);
    }
  });
});

describe('D/E/F — jamais une prononciation identique', () => {
  it('D. normalisation : casse, espaces, insécables, invisibles, Unicode composé', () => {
    expect(prononciationIdentique('lien en bio', ' lien en bio ')).toBe(true);
    expect(prononciationIdentique('lien en bio', 'Lien  En  BIO')).toBe(true);
    expect(prononciationIdentique('lien en bio', 'lien en​bio'.replace('​', ' '))).toBe(true);
    expect(prononciationIdentique('Neuchâtel', 'Neuchâtel')).toBe(true);
    expect(cleAffiche(' lien en bio ')).toBe(cleAffiche('lien en bio'));
    expect(prononciationIdentique('lien en bio', 'lien en bioo')).toBe(false);
    for (const [a, p] of [['lien en bio', 'lien en bio'], ['Afroboost', 'Afroboost'], ['Neuchâtel', 'Neuchâtel']]) {
      expect(prononciationValide({ affiche: a, prononce: p })).toEqual({ ok: false, motif: 'identique' });
    }
  });

  it('E. suggestion identique rejetée ; F. suggestion différente acceptée', () => {
    expect(suggestionUtile('lien en bio', 'lien en bio')).toBeNull();
    expect(suggestionUtile('lien en bio', '  LIEN EN BIO ')).toBeNull();
    expect(suggestionUtile('Afroboost', '')).toBeNull();
    expect(suggestionUtile('Afroboost', 'Afro-Boust')).toBe('Afro-Boust');
    expect(suggestionUtile('ADN', 'A D N')).toBe('A D N');
  });

  it('E (écran). « Suggérer » sur « lien en bio » : champ NON modifié, message clair, Enregistrer impossible', async () => {
    render(<MaVoixPanel />);
    await waitFor(() => expect(q('[data-prononciation-ajouter]')).not.toBeNull());
    fireEvent.click(q('[data-prononciation-ajouter]'));
    fireEvent.change(champAffiche(), { target: { value: 'lien en bio' } });
    fireEvent.click(q('[data-prononciation-suggerer]'));
    await waitFor(() => expect(q('[data-prononciation-note]')?.textContent).toBe(MESSAGE_AUCUNE_SUGGESTION));
    expect(champPrononce().value).toBe('');
    // Saisie manuelle identique : signalée, et « Enregistrer » refuse.
    fireEvent.change(champPrononce(), { target: { value: ' Lien en bio ' } });
    expect(q('[data-prononciation-brouillon-identique]')).not.toBeNull();
    expect(q<HTMLButtonElement>('[data-prononciation-valider]').disabled).toBe(true);
    expect(appels.some((a) => a.url === '/api/voice/profil/prononciations')).toBe(false);
  });

  it('F (écran). le serveur propose une forme DIFFÉRENTE → elle remplit le champ', async () => {
    suggestionServeur = { suggestion: 'lien enne bio', source: 'ia' };
    render(<MaVoixPanel />);
    await waitFor(() => expect(q('[data-prononciation-ajouter]')).not.toBeNull());
    fireEvent.click(q('[data-prononciation-ajouter]'));
    fireEvent.change(champAffiche(), { target: { value: 'lien en bio' } });
    fireEvent.click(q('[data-prononciation-suggerer]'));
    await waitFor(() => expect(champPrononce().value).toBe('lien enne bio'));
  });

  it('F (écran). même si le serveur renvoyait le même texte, il n’est jamais posé', async () => {
    suggestionServeur = { suggestion: 'lien en bio', source: 'ia' };
    render(<MaVoixPanel />);
    await waitFor(() => expect(q('[data-prononciation-ajouter]')).not.toBeNull());
    fireEvent.click(q('[data-prononciation-ajouter]'));
    fireEvent.change(champAffiche(), { target: { value: 'lien en bio' } });
    fireEvent.click(q('[data-prononciation-suggerer]'));
    await waitFor(() => expect(q('[data-prononciation-note]')?.textContent).toBe(MESSAGE_AUCUNE_SUGGESTION));
    expect(champPrononce().value).toBe('');
  });
});

describe('Entrées identiques déjà enregistrées : signalées, pas appliquées, jamais supprimées en silence', () => {
  const stockees = [...UTILES, { affiche: 'lien en bio', prononce: 'lien en bio' }];

  it('relues à part, jamais appliquées ; les corrections utiles fonctionnent toujours', () => {
    expect(lirePrononciations(stockees)).toEqual(UTILES);
    expect(lirePrononciationsIdentiques(stockees)).toEqual([{ affiche: 'lien en bio', prononce: 'lien en bio' }]);
    const dit = scriptParle('Afroboost : -33% sur le 3-en-1 OS RENFORCÉS, lien en bio', lirePrononciations(stockees));
    expect(dit).toBe('Afro-Boust : moins 33 pourcent sur le trois en un os renforcés, lien en bio');
  });

  it('l’écran les signale avec Modifier / Supprimer ; Supprimer retire SEULEMENT celle-là', async () => {
    identiques = [{ affiche: 'lien en bio', prononce: 'lien en bio' }];
    render(<MaVoixPanel />);
    await waitFor(() => expect(q('[data-prononciation-identique="lien en bio"]')).not.toBeNull());
    expect(q('[data-prononciation-identique="lien en bio"]').textContent).toContain('identique au texte original');
    expect(q('[data-prononciation-identique-modifier="lien en bio"]')).not.toBeNull();
    fireEvent.click(q('[data-prononciation-identique-supprimer="lien en bio"]'));
    await waitFor(() => expect(q('[data-prononciation-identique="lien en bio"]')).toBeNull());
    const put = appels.find((a) => a.url === '/api/voice/profil/prononciations')!;
    expect(put.body).toEqual({ prononciations: UTILES, retirerIdentiques: ['lien en bio'] });
    expect(document.querySelectorAll('[data-prononciation]').length).toBe(3);
  });
});
