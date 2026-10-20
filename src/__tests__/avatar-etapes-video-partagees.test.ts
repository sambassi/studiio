import { describe, it, expect } from 'vitest';
import {
  DETAIL_SOUS_ETAT_AVATAR, etapeDepuisStatutAvatar, etapeDepuisStatutJumeauAutopilote, progressionVideoAvatar,
} from '@/lib/avatar/etapes-video-avatar';
import { etapeVideoAvatarDepuisPhaseJumeau } from '@/lib/creer/jumeau';
import { affichageProduction } from '@/lib/autopilot/progression';

/**
 * UN SEUL MODÈLE D'ÉTAPES pour la vidéo avec l'avatar (Mon avatar, Créer,
 * Autopilote) : Vérification → Génération → Récupération → Montage → Prête.
 */

const etats = (p: ReturnType<typeof progressionVideoAvatar>) => p.etapes.map((e) => e.etat);

describe('progressionVideoAvatar', () => {
  it('les cinq étapes, sans jargon (« Traitement », « Stockage »)', () => {
    const p = progressionVideoAvatar({ etape: 'verification' });
    expect(p.etapes.map((e) => e.libelle)).toEqual(['Vérification', 'Génération de l’avatar', 'Récupération de la vidéo', 'Montage', 'Prête']);
    expect(p.etapes.map((e) => e.libelle).join(' ')).not.toMatch(/Traitement|Stockage/);
  });

  it('génération : jamais de pourcentage, même si on en passe un ; sous-état réel', () => {
    const p = progressionVideoAvatar({ etape: 'generation', sousEtat: 'en_file', pourcentMontage: 40 });
    expect(p.pourcentage).toBeUndefined();
    expect(p.detail).toBe(DETAIL_SOUS_ETAT_AVATAR.en_file);
    expect(etats(p)).toEqual(['terminee', 'courante', 'a_venir', 'a_venir', 'a_venir']);
    expect(progressionVideoAvatar({ etape: 'generation', sousEtat: 'en_pause' }).detail).toMatch(/En pause — service indisponible, reprise automatique/);
    expect(progressionVideoAvatar({ etape: 'generation' }).detail).toBe(DETAIL_SOUS_ETAT_AVATAR.en_cours);
  });

  it('montage : pourcentage SEULEMENT s’il est réel', () => {
    expect(progressionVideoAvatar({ etape: 'montage', pourcentMontage: 42.4 }).pourcentage).toBe(42);
    expect(progressionVideoAvatar({ etape: 'montage' }).pourcentage).toBeUndefined();
    expect(progressionVideoAvatar({ etape: 'montage', pourcentMontage: Number.NaN }).pourcentage).toBeUndefined();
  });

  it('Mon avatar : pas d’étape Montage', () => {
    const p = progressionVideoAvatar({ etape: 'recuperation', avecMontage: false });
    expect(p.etapes.map((e) => e.libelle)).toEqual(['Vérification', 'Génération de l’avatar', 'Récupération de la vidéo', 'Prête']);
    expect(etats(p)).toEqual(['terminee', 'terminee', 'courante', 'a_venir']);
  });

  it('prête : tout terminé, statut succès', () => {
    const p = progressionVideoAvatar({ etape: 'prete' });
    expect(p.statut).toBe('succes');
    expect(etats(p).every((e) => e === 'terminee')).toBe(true);
  });

  it('échec : étape fautive, raison du serveur, « Crédits remboursés » si remboursé, une action', () => {
    const p = progressionVideoAvatar({ etape: 'generation', echec: { message: 'La génération a échoué.', rembourse: true } });
    expect(p.statut).toBe('erreur');
    expect(etats(p)[1]).toBe('echouee');
    expect(p.echec).toEqual({ etape: 'Génération de l’avatar', motif: 'La génération a échoué. Crédits remboursés.', action: 'Réessayer' });
    // Déjà dit par le serveur : pas deux fois.
    expect(progressionVideoAvatar({ etape: 'generation', echec: { message: 'Échec. Vos crédits ont été remboursés.', rembourse: true } }).echec!.motif)
      .toBe('Échec. Vos crédits ont été remboursés.');
    expect(progressionVideoAvatar({ etape: 'generation', echec: { message: 'Échec.', rembourse: false } }).echec!.motif).toBe('Échec.');
  });
});

describe('statut serveur → étape', () => {
  it('GET /api/avatar/status : en file / en cours / en pause / récupération ; réponse d’avant = en cours', () => {
    expect(etapeDepuisStatutAvatar({ status: 'processing', etape: 'en_file', etatFournisseur: 'pending' })).toEqual({ etape: 'generation', sousEtat: 'en_file' });
    expect(etapeDepuisStatutAvatar({ status: 'processing', etatFournisseur: 'pending' })).toEqual({ etape: 'generation', sousEtat: 'en_file' });
    expect(etapeDepuisStatutAvatar({ status: 'processing', etape: 'en_cours' })).toEqual({ etape: 'generation', sousEtat: 'en_cours' });
    expect(etapeDepuisStatutAvatar({ status: 'processing', enAttente: 'fournisseur' })).toEqual({ etape: 'generation', sousEtat: 'en_pause' });
    expect(etapeDepuisStatutAvatar({ status: 'processing', etape: 'recuperation' })).toEqual({ etape: 'recuperation', sousEtat: null });
    expect(etapeDepuisStatutAvatar({ status: 'processing' })).toEqual({ etape: 'generation', sousEtat: 'en_cours' });
    expect(etapeDepuisStatutAvatar({ status: 'pending' })).toEqual({ etape: 'generation', sousEtat: 'en_file' });
  });

  it('file du jumeau de l’Autopilote : reserve → en_attente → en_cours → rendu', () => {
    expect(['reserve', 'en_attente', 'en_cours', 'rendu', null].map(etapeDepuisStatutJumeauAutopilote))
      .toEqual(['verification', 'generation', 'montage', 'prete', 'generation']);
  });

  it('phases techniques de Créer → étapes partagées', () => {
    expect((['preparation', 'envoi', 'traitement', 'stockage', 'rendu', 'pret'] as const).map(etapeVideoAvatarDepuisPhaseJumeau))
      .toEqual(['verification', 'verification', 'generation', 'recuperation', 'montage', 'prete']);
  });
});

describe('Autopilote — affichageProduction', () => {
  it('pourcentage UNIQUEMENT pendant la composition (avancement réel)', () => {
    expect(affichageProduction({ etape: 'analyse', avancement: null }).pourcentage).toBeUndefined();
    expect(affichageProduction({ etape: 'envoi', avancement: 0.9 }).pourcentage).toBeUndefined();
    expect(affichageProduction({ etape: 'composition', avancement: 0.5 }).pourcentage).toBe(50);
    expect(affichageProduction({ etape: 'composition', avancement: null }).pourcentage).toBeUndefined();
  });

  it('les étapes du pipeline, dans l’ordre ; rien reçu : démarrage', () => {
    const a = affichageProduction({ etape: 'composition', avancement: 0.2 });
    expect(a.etapes.map((e) => e.etat)).toEqual(['terminee', 'terminee', 'courante', 'a_venir', 'a_venir']);
    expect(affichageProduction(null)).toMatchObject({ message: 'Démarrage…' });
  });
});
