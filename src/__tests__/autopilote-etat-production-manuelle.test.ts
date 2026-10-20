/**
 * « Produire un brouillon maintenant » : bouton et messages dérivés de l'état
 * RÉEL. « Opération annulée » seulement quand l'utilisateur refuse le coût.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { MESSAGE_ANNULE } from '@/lib/fournisseurs/confirmation-client';
import {
  boutonProduireVisible, libelleBoutonProduire, suiteEnvoi, messageErreurTechnique,
  lireProgressionServeur, repriseAuRetour, type EtatProduction,
} from '@/lib/autopilot/etat-production-manuelle';

describe('suiteEnvoi', () => {
  it('refus du coût par l’utilisateur → annule (seul cas de MESSAGE_ANNULE)', () => {
    expect(suiteEnvoi({ annule: true, choix: 'annuler' })).toEqual({ suite: 'etat', etat: { etat: 'annule', message: MESSAGE_ANNULE } });
    expect(suiteEnvoi({ annule: true, choix: 'existant' }).suite).toBe('etat');
  });
  it('verrou client déjà pris → on SUIT la production, aucun message d’annulation', () => {
    expect(suiteEnvoi({ annule: true, choix: 'deja_en_cours' })).toEqual({ suite: 'suivre' });
  });
  it('202 et 409 « en-cours » → suivre', () => {
    expect(suiteEnvoi({ annule: false, status: 202, json: { success: true, enCours: true } })).toEqual({ suite: 'suivre' });
    expect(suiteEnvoi({ annule: false, status: 409, json: { success: false, code: 'en-cours' } })).toEqual({ suite: 'suivre' });
  });
  it('refus serveur → la raison réelle, avec son code', () => {
    const s = suiteEnvoi({ annule: false, status: 402, json: { success: false, error: 'Crédits insuffisants : 10 requis.', code: 'credits' } });
    expect(s).toEqual({ suite: 'etat', etat: { etat: 'erreur', message: 'Crédits insuffisants : 10 requis.', code: 'credits' } });
    const d = suiteEnvoi({ annule: false, status: 409, json: { success: false, error: 'Un brouillon vient déjà d’être produit pour ce créneau.', code: 'deja-produit' } });
    expect(d.suite === 'etat' && d.etat.etat === 'erreur' && d.etat.code).toBe('deja-produit');
  });
  it('erreur sans corps lisible → message explicite, jamais « annulée »', () => {
    const s = suiteEnvoi({ annule: false, status: 500, json: {} });
    expect(s.suite === 'etat' && s.etat.etat === 'erreur' && s.etat.message).toMatch(/erreur 500/);
    const a = suiteEnvoi({ annule: false, status: 401, json: {} });
    expect(a.suite === 'etat' && a.etat.etat === 'erreur' && a.etat.message).toMatch(/session/);
  });
  it('succès complet → résultat', () => {
    expect(suiteEnvoi({ annule: false, status: 200, json: { success: true, jumeau: 'en_preparation' } }).suite).toBe('resultat');
  });
});

describe('bouton', () => {
  const e = (x: EtatProduction) => boutonProduireVisible(x);
  it('visible au repos, après résultat, erreur ou annulation ; caché pendant confirmation / rendu / jumeau', () => {
    expect(e({ etat: 'repos' })).toBe(true);
    expect(e({ etat: 'annule', message: MESSAGE_ANNULE })).toBe(true);
    expect(e({ etat: 'erreur', message: 'x' })).toBe(true);
    expect(e({ etat: 'fait', postId: 'p', date: '', time: '', timezone: '', calendrierUrl: '' })).toBe(true);
    expect(e({ etat: 'confirmation' })).toBe(false);
    expect(e({ etat: 'en-cours' })).toBe(false);
    expect(e({ etat: 'jumeau' })).toBe(false);
  });
  it('après un échec technique, le bouton dit « Réessayer »', () => {
    expect(libelleBoutonProduire({ etat: 'erreur', message: 'x' })).toBe('Réessayer la production');
    expect(libelleBoutonProduire({ etat: 'annule', message: 'x' })).toBe('Produire un brouillon maintenant');
  });
});

describe('progression serveur et retour sur la page', () => {
  it('classe chaque lecture', () => {
    expect(lireProgressionServeur({ progression: { pourcent: 10 } }).cas).toBe('progression');
    expect(lireProgressionServeur({ resultat: { success: true } }).cas).toBe('resultat');
    expect(lireProgressionServeur({ jumeau: { etat: 'en_preparation' } }).cas).toBe('jumeau');
    expect(lireProgressionServeur({ jumeau: { etat: 'echec', message: 'HeyGen indisponible' } })).toEqual({ cas: 'echec', message: 'HeyGen indisponible' });
    expect(lireProgressionServeur({ jumeau: { etat: 'depose', post: { postId: 'p', scheduledDate: 'd', scheduledTime: 't' } } }).cas).toBe('jumeau-depose');
    expect(lireProgressionServeur({ success: true, progression: null, resultat: null, jumeau: null }).cas).toBe('rien');
    expect(lireProgressionServeur(null).cas).toBe('rien');
  });
  it('retour : reprend le rendu en cours / la file jumeau / le résultat récent — jamais un nouveau POST', () => {
    expect(repriseAuRetour({ cas: 'progression' })).toBe('en-cours');
    expect(repriseAuRetour({ cas: 'jumeau' })).toBe('jumeau');
    expect(repriseAuRetour({ cas: 'resultat', resultat: { success: true } })).toBe('resultat');
    expect(repriseAuRetour({ cas: 'rien' })).toBeNull();
    expect(repriseAuRetour({ cas: 'jumeau-depose', resultat: {} })).toBeNull();
  });
  it('réseau coupé : la raison réelle', () => {
    expect(messageErreurTechnique(new TypeError('Failed to fetch'))).toMatch(/connexion/);
    expect(messageErreurTechnique(new Error('boom'))).toBe('boom');
  });
});

describe('Câblage AutopilotPanel', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/components/creer/AutopilotPanel.tsx'), 'utf-8');
  it('MESSAGE_ANNULE n’est plus posé directement par le panneau', () => {
    expect(src).not.toContain('MESSAGE_ANNULE');
    expect(src).toContain('const suite = suiteEnvoi(issue);');
    expect(src).toContain('{boutonProduireVisible(produire) ? (');
  });
  it('une production introuvable côté serveur rend la main au lieu de bloquer l’écran', () => {
    expect(src).toContain('if (vides >= LECTURES_VIDES_MAX) setProduire({ etat: \'erreur\', message: MESSAGE_PRODUCTION_PERDUE');
  });
});
