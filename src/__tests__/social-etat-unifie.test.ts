import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  deriverEtatReseau,
  deriverTousLesReseaux,
  reseauDepuisLibelle,
  RESEAUX,
  type EntreeZernio,
} from '../lib/social/etatReseaux';

/**
 * UX Réseaux sociaux — un seul état par réseau, dérivé des deux sources.
 *
 * Avant : l'écran rendait la liste Zernio PUIS la liste OAuth directe —
 * Instagram deux fois, deux états, deux boutons. Ici : la règle pure, la
 * matrice états × actions, et la preuve que l'écran ne rend chaque réseau
 * qu'une fois.
 */

const root = resolve(__dirname, '..', '..');
const page = readFileSync(resolve(root, 'src/app/dashboard/social/page.tsx'), 'utf-8');
const calendrier = readFileSync(resolve(root, 'src/app/dashboard/calendar/page.tsx'), 'utf-8');
const routeZ = readFileSync(resolve(root, 'src/app/api/social/zernio/accounts/route.ts'), 'utf-8');

const zVide: EntreeZernio = { autorise: true, comptes: [] };
const zNonAutorise: EntreeZernio = { autorise: false, raison: 'option-absente', comptes: [] };
const zConnecte = (platform: string, status = 'connected'): EntreeZernio => ({
  autorise: true,
  comptes: [{ accountId: 'acc_1', platform, username: 'afroboosteur', status }],
});

describe('Matrice états × actions (règle pure)', () => {
  it('compte Zernio connecté → connecté via Zernio, seule action = déconnecter', () => {
    const e = deriverEtatReseau('instagram', { connected: false, oauthAvailable: true }, zConnecte('instagram'));
    expect(e.etat).toBe('connecte');
    expect(e.voie).toBe('zernio');
    expect(e.username).toBe('afroboosteur');
    expect(e.actions).toEqual({ connecter: null, reconnecter: null, deconnecter: 'zernio' });
    expect(e.autoPublication).toBe(true);
  });

  it('le compte Zernio de l utilisateur l emporte sur un compte direct', () => {
    const e = deriverEtatReseau('instagram', { connected: true, username: 'spordateur', oauthAvailable: true }, zConnecte('instagram'));
    expect(e.voie).toBe('zernio');
    expect(e.username).toBe('afroboosteur');
  });

  it('compte direct connecté → reconnecter + déconnecter (direct)', () => {
    const e = deriverEtatReseau('facebook', { connected: true, username: 'Afroboost', oauthAvailable: true }, zVide);
    expect(e.etat).toBe('connecte');
    expect(e.voie).toBe('direct');
    expect(e.actions).toEqual({ connecter: null, reconnecter: 'direct', deconnecter: 'direct' });
    expect(e.autoPublication).toBe(true);
  });

  it('TikTok direct connecté : auto-publication NON opérationnelle (brouillon privé), dit tel quel', () => {
    const e = deriverEtatReseau('tiktok', { connected: true, oauthAvailable: true }, zVide);
    expect(e.etat).toBe('connecte');
    expect(e.autoPublication).toBe(false);
    expect(e.motifAuto).toBe('tiktok-prive');
  });

  it('compte Zernio expiré → « reconnexion nécessaire », action = reconnecter (Zernio)', () => {
    const e = deriverEtatReseau('youtube', { connected: false, oauthAvailable: false, available: false }, zConnecte('youtube', 'disconnected'));
    expect(e.etat).toBe('reconnexion');
    expect(e.actions).toEqual({ connecter: null, reconnecter: 'zernio', deconnecter: null });
    expect(e.autoPublication).toBe(false);
  });

  it('rien de connecté, Zernio autorisé → connecter via Zernio, même si la voie directe est en attente', () => {
    const e = deriverEtatReseau('youtube', { connected: false, available: false, oauthAvailable: true }, zVide);
    expect(e.etat).toBe('non_connecte');
    expect(e.actions.connecter).toBe('zernio');
  });

  it('rien de connecté, Zernio non autorisé, plateforme en attente → bientôt disponible, AUCUNE action', () => {
    const e = deriverEtatReseau('youtube', { connected: false, available: false, oauthAvailable: true }, zNonAutorise);
    expect(e.etat).toBe('bientot');
    expect(e.actions).toEqual({ connecter: null, reconnecter: null, deconnecter: null });
  });

  it('rien de connecté, Zernio non autorisé, OAuth direct configuré → connecter (direct)', () => {
    const e = deriverEtatReseau('instagram', { connected: false, available: true, oauthAvailable: true }, zNonAutorise);
    expect(e.etat).toBe('non_connecte');
    expect(e.actions.connecter).toBe('direct');
  });

  it('aucun chemin → non configuré, aucun faux bouton', () => {
    const e = deriverEtatReseau('facebook', { connected: false, available: true, oauthAvailable: false }, zNonAutorise);
    expect(e.etat).toBe('non_configure');
    expect(e.actions.connecter).toBeNull();
  });

  it('sans information du serveur, la plateforme reste connectable (jamais masquée par accident)', () => {
    const e = deriverEtatReseau('instagram', undefined, zVide);
    expect(e.etat).toBe('non_connecte');
    expect(e.actions.connecter).toBe('zernio');
  });

  it('les quatre réseaux sont dérivés, et seulement eux', () => {
    const tous = deriverTousLesReseaux({}, zVide);
    expect(Object.keys(tous).sort()).toEqual([...RESEAUX].sort());
  });

  it('le Calendrier retrouve le réseau depuis son libellé, et ignore les autres canaux', () => {
    expect(reseauDepuisLibelle('Instagram')).toBe('instagram');
    expect(reseauDepuisLibelle('YouTube Shorts')).toBe('youtube');
    expect(reseauDepuisLibelle('Email')).toBeNull();
    expect(reseauDepuisLibelle('WhatsApp')).toBeNull();
  });
});

describe('L écran ne rend chaque réseau qu une fois', () => {
  it('la section « Mes réseaux » séparée n est plus rendue par la page', () => {
    expect(page).not.toContain('<MesReseaux');
    expect(page).not.toMatch(/import MesReseaux/);
  });

  it('une seule grille, une carte par réseau, état lu de la règle unique', () => {
    expect(page.split('data-testid="grille-reseaux"').length - 1).toBe(1);
    expect(page).toContain('data-testid={`reseau-${platform.id}`}');
    expect(page).toContain('useEtatReseaux()');
    expect(page).toContain("unifie.reseaux![platform.id as Reseau]");
  });

  it('les actions sont dérivées de l état — jamais un bouton qui n aboutit pas', () => {
    expect(page).toContain('e.actions.connecter ? (');
    expect(page).toContain('e.actions.reconnecter ? (');
    expect(page).toContain('data-action="deconnecter"');
  });

  it('la déconnexion passe TOUJOURS par une confirmation', () => {
    expect(page).toContain('data-testid="confirmation-deconnexion"');
    const bloc = page.slice(page.indexOf('data-action="deconnecter"'), page.indexOf('data-action="deconnecter"') + 400);
    expect(bloc).toContain('setConfirmation(');
    expect(bloc).not.toContain('handleDisconnect(');
  });

  it('le repli « publier vous-même » est ouvert seulement quand l auto-publication n est pas opérationnelle', () => {
    expect(page).toContain('open={!e.autoPublication}');
    expect(page).toContain("data-self-publish={e.autoPublication ? 'option' : 'fallback'}");
  });

  it('icônes lucide, aucun emoji dans la page', () => {
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(page)).toBe(false);
  });
});

describe('Déconnexion Zernio : retirer sans supprimer', () => {
  it('la route DELETE passe le compte en « disconnected » et ne supprime aucune ligne', () => {
    const bloc = routeZ.slice(routeZ.indexOf('export async function DELETE'));
    expect(bloc).toContain(".update({ status: 'disconnected'");
    expect(bloc).not.toContain('.delete(');
  });
});

describe('Le Calendrier suit la même règle', () => {
  it('lit l état des réseaux par le hook partagé, sans second fetch de statut', () => {
    expect(calendrier).toContain('useEtatReseaux()');
    expect(calendrier.split("fetch('/api/social/status')").length - 1).toBe(0);
  });

  it('un réseau non connecté est grisé, reste sélectionnable, et mène à l écran Réseaux', () => {
    expect(calendrier).toContain("const nonConnecte = !!etat && etat.etat !== 'connecte';");
    expect(calendrier).toContain('href="/dashboard/social"');
    expect(calendrier).toContain("t('editModal.connectNetwork')");
    // le clic n'est bloqué QUE par « bientôt » (canal non configuré), jamais par « non connecté »
    expect(calendrier).toContain('if (soon) return;');
    expect(calendrier).not.toContain('if (nonConnecte) return;');
  });
});

describe('Traductions', () => {
  it('les nouvelles clés existent dans les trois langues', () => {
    for (const loc of ['fr', 'en', 'de']) {
      const m = JSON.parse(readFileSync(resolve(root, `messages/${loc}.json`), 'utf-8'));
      expect(m.social.status.notConnected).toBeTruthy();
      expect(m.social.status.reconnect).toBeTruthy();
      expect(m.social.confirmDisconnect.title).toContain('{platform}');
      expect(m.social.selfPublish.introOption).toContain('{platform}');
      expect(m.social.zernio.optionAbsente).toBeTruthy();
      expect(m.calendar.editModal.connectNetwork).toBeTruthy();
      expect(m.calendar.editModal.networkNotConnected).toBeTruthy();
    }
  });
});
