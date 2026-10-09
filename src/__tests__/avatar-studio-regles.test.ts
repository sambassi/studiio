import { describe, it, expect } from 'vitest';
import {
  besoinPostTraitement, choisirFormatEnregistrement, etatCout, formaterDuree, lireGenerationMemorisee, messageErreurCamera,
  motSelectionne, nomFichierAvatar, optionsPostTraitement, verifierPriseSource, recadrageNeutre, typeEtExtension, vitessePrompteur, DIMENSIONS_STUDIO,
} from '@/lib/avatar/studio';
import { scriptParle } from '@/lib/voice/prononciations';

/** Mini-studio avatar — les règles pures (coût, post-traitement, enregistrement, prompteur). */

describe('coût et solde — affichés AVANT la génération', () => {
  it('solde suffisant + texte → génération possible', () => {
    expect(etatCout({ cout: 40, solde: 100, texte: 'Bonjour', enCours: false })).toEqual({ insuffisant: false, peutGenerer: true, libelleCout: '40 crédits', libelleSolde: '100 crédits' });
  });
  it('⚠️ crédits insuffisants → bouton désactivé', () => {
    const e = etatCout({ cout: 40, solde: 39, texte: 'Bonjour', enCours: false });
    expect(e.insuffisant).toBe(true);
    expect(e.peutGenerer).toBe(false);
  });
  it('⚠️ génération en cours → impossible de relancer (double clic)', () => {
    expect(etatCout({ cout: 40, solde: 100, texte: 'Bonjour', enCours: true }).peutGenerer).toBe(false);
  });
  it('texte vide → impossible', () => {
    expect(etatCout({ cout: 40, solde: 100, texte: '   ', enCours: false }).peutGenerer).toBe(false);
  });
  it('solde inconnu : jamais inventé, jamais bloquant (le serveur refuse lui-même, 402)', () => {
    const e = etatCout({ cout: 40, solde: null, texte: 'x', enCours: false });
    expect(e.libelleSolde).toBe('indisponible');
    expect(e.peutGenerer).toBe(true);
  });
});

describe('post-traitement — recadrage + LUT, sinon le fichier d’origine', () => {
  it('sans recadrage ni LUT : aucun post-traitement (le MP4 d’origine est le fichier final)', () => {
    expect(besoinPostTraitement({ recadrage: { scale: 1, offsetX: 0, offsetY: 0 }, lutChoisie: false })).toBe(false);
    expect(recadrageNeutre(null)).toBe(true);
  });
  it('recadrage OU LUT → post-traitement', () => {
    expect(besoinPostTraitement({ recadrage: { scale: 1.4, offsetX: 0, offsetY: 0 }, lutChoisie: false })).toBe(true);
    expect(besoinPostTraitement({ recadrage: null, lutChoisie: true })).toBe(true);
  });
  it.each([['9:16', 1080, 1920], ['16:9', 1920, 1080], ['1:1', 1080, 1080]] as const)('⚠️ %s : une seule séquence vidéo, au bon format, son exigé, recadrage et LUT transmis au moteur', (f, w, h) => {
    const lut = { lut: { kind: '3d' }, intensity: 1 };
    const o = optionsPostTraitement({ videoUrl: '/v.mp4', format: f, dureeSecondes: 12.4, recadrage: { scale: 1.5, offsetX: 0.1, offsetY: -0.2 }, lut });
    expect([o.width, o.height]).toEqual([w, h]);
    expect(DIMENSIONS_STUDIO[f]).toEqual({ width: w, height: h });
    expect([o.introDuration, o.cardsDuration, o.ctaDuration]).toEqual([0, 0, 0]);
    expect(o.cards).toEqual([]);
    expect(o.videoDuration).toBe(13);
    expect(o.rushTransform).toEqual({ scale: 1.5, offsetX: 0.1, offsetY: -0.2 });
    expect(o.rushLut).toBe(lut);
    expect(o.rushAudioRequis).toBe(true);
    expect(o.watermark).toBe(false);
    // Aucun texte incrusté (le compositeur ajoute « Afroboost.com » par défaut).
    expect(o.siteText).toEqual({ text: '', enabled: false });
  });
  it('recadrage neutre : aucun rushTransform envoyé', () => {
    expect(optionsPostTraitement({ videoUrl: '/v.mp4', format: '9:16', dureeSecondes: 5, recadrage: { scale: 1, offsetX: 0, offsetY: 0 }, lut: null }).rushTransform).toBeUndefined();
  });
  it('nom du fichier : .mp4 daté', () => {
    expect(nomFichierAvatar(new Date(2026, 9, 9, 8, 5))).toBe('mon-avatar-20261009-0805.mp4');
  });
});

describe('reprise après rafraîchissement — jamais une seconde génération', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  it('relit une génération mémorisée récente', () => {
    expect(lireGenerationMemorisee(JSON.stringify({ generationId: id, format: '1:1', lanceeLe: 1000 }), 2000)).toEqual({ generationId: id, format: '1:1', lanceeLe: 1000 });
  });
  it('ignore une entrée périmée, malformée ou absente', () => {
    expect(lireGenerationMemorisee(JSON.stringify({ generationId: id, format: '9:16', lanceeLe: 0 }), 41 * 60 * 1000)).toBeNull();
    expect(lireGenerationMemorisee('{oops', 0)).toBeNull();
    expect(lireGenerationMemorisee(JSON.stringify({ generationId: 'x', format: '9:16', lanceeLe: 0 }), 0)).toBeNull();
    expect(lireGenerationMemorisee(null)).toBeNull();
  });
});

describe('enregistrement caméra', () => {
  it('format : WebM si possible, sinon MP4 ; MP4 exigé → MP4 ou rien', () => {
    expect(choisirFormatEnregistrement((m) => m.startsWith('video/webm'))).toBe('video/webm;codecs=vp9,opus');
    expect(choisirFormatEnregistrement((m) => m === 'video/mp4')).toBe('video/mp4');
    expect(choisirFormatEnregistrement((m) => m.startsWith('video/webm'), true)).toBeNull();
    expect(choisirFormatEnregistrement((m) => m.startsWith('video/mp4'), true)).toBe('video/mp4;codecs=avc1,mp4a');
  });
  it('type et extension acceptés par l’import', () => {
    expect(typeEtExtension('video/webm;codecs=vp9,opus')).toEqual({ type: 'video/webm', extension: 'webm' });
    expect(typeEtExtension('video/mp4;codecs=avc1')).toEqual({ type: 'video/mp4', extension: 'mp4' });
  });
  it('messages clairs : permission refusée, caméra absente, caméra occupée', () => {
    expect(messageErreurCamera('NotAllowedError')).toMatch(/refusé/);
    expect(messageErreurCamera('NotFoundError')).toMatch(/Aucune caméra/);
    expect(messageErreurCamera('NotReadableError')).toMatch(/autre application/);
    expect(messageErreurCamera(undefined)).toMatch(/importer une vidéo/);
  });
  it('⚠️ exigences documentées du fournisseur, vérifiées AVANT envoi : 15–600 s, grand côté ≥ 640 px, 32 Mo', () => {
    const ok = { dureeS: 120, largeur: 1280, hauteur: 720, octets: 20 * 1024 * 1024 };
    expect(verifierPriseSource(ok)).toEqual([]);
    expect(verifierPriseSource({ ...ok, dureeS: 9 })[0]).toMatch(/au moins 15 secondes/);
    expect(verifierPriseSource({ ...ok, dureeS: 700 })[0]).toMatch(/10 minutes maximum/);
    expect(verifierPriseSource({ ...ok, largeur: 480, hauteur: 360 })[0]).toMatch(/résolution/);
    expect(verifierPriseSource({ ...ok, octets: 40 * 1024 * 1024 })[0]).toMatch(/trop lourde/);
    // La source réelle de l'incident (848×478, 122,8 s, 23 Mo) respecte ces règles.
    expect(verifierPriseSource({ dureeS: 122.84, largeur: 848, hauteur: 478, octets: 23.05 * 1024 * 1024 })).toEqual([]);
  });
  it('durée affichée', () => {
    expect(formaterDuree(0)).toBe('0:00');
    expect(formaterDuree(75.9)).toBe('1:15');
  });
});

describe('prompteur et mots difficiles', () => {
  it('vitesse bornée et croissante', () => {
    expect(vitessePrompteur(1)).toBeLessThan(vitessePrompteur(10));
    expect(vitessePrompteur(99)).toBe(vitessePrompteur(10));
  });
  it('mot sélectionné nettoyé de la ponctuation', () => {
    const t = 'Bienvenue au cours Afroboost à Neuchâtel.';
    const d = t.indexOf('Neuchâtel');
    expect(motSelectionne(t, d, t.length)).toBe('Neuchâtel');
    expect(motSelectionne(t, 3, 3)).toBeNull();
  });
  it('⚠️ texte VISIBLE inchangé, texte PARLÉ corrigé par le dictionnaire commun (prioritaire sur la normalisation)', () => {
    const visible = 'Bienvenue au cours Afroboost à Neuchâtel.';
    const parle = scriptParle(visible, [{ affiche: 'Neuchâtel', prononce: 'Neu-cha-tel' }]);
    expect(parle).toContain('Neu-cha-tel');
    expect(visible).toContain('Neuchâtel');
    expect(scriptParle('NEJM', [{ affiche: 'NEJM', prononce: 'Ènne-ji-èm' }])).toBe('Ènne-ji-èm');
  });
});

describe('UN seul dictionnaire de prononciations — Mon avatar, Créer, Autopilote, jumeau', () => {
  const { readFileSync } = require('fs') as typeof import('fs');
  const { resolve } = require('path') as typeof import('path');
  const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
  it('⚠️ le mini-studio écrit par la route EXISTANTE, avec la règle commune', () => {
    const client = lire('lib/voice/profilClient.ts');
    expect(client).toContain("'/api/voice/profil/prononciations'");
    expect(client).toContain('ajouterPrononciation(profil.prononciations, entree)');
  });
  it('⚠️ la génération du jumeau applique ce dictionnaire au texte PARLÉ', () => {
    expect(lire('lib/avatar/moteur-jumeau.ts')).toContain('scriptsDuJumeau([display], jumeau.prive.prononciations)');
  });
  it.each(['app/api/tts/edge/route.ts', 'app/api/tts/elevenlabs/route.ts', 'app/api/tts/heygen/route.ts', 'app/api/tts/openai/route.ts', 'lib/autopilot/voice.ts'])('Créer / Autopilote — %s lit le même dictionnaire', (p) => {
    expect(lire(p)).toMatch(/texteParleDuCompte|prononciationsDuCompte/);
  });
  it('⚠️ la page Mon avatar ne génère plus par la route HeyGen sans voix clonée', () => {
    const page = lire('app/dashboard/avatar/page.tsx');
    expect(page).not.toMatch(/fetch\('\/api\/avatar\/generate',\s*\{\s*method: 'POST',\s*headers[^)]*script:/s);
    expect(lire('components/avatar/studio/MiniStudioAvatar.tsx')).toContain('genererEtAttendreVideoJumeau');
  });
});
