import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, act } from '@testing-library/react';

/**
 * MON AVATAR — PROGRESSION PARTOUT, FORMAT DU LECTEUR, VERSIONS ≠ QUALITÉ,
 * HISTORIQUE DES VERSIONS, EMBELLISSEMENT NON DESTRUCTIF.
 *
 * Réseau simulé ; AUCUN fournisseur, AUCUNE génération réelle.
 */

vi.mock('@/components/voice/VoiceCloneRecorder', () => ({ default: () => null }));
vi.mock('@/components/voice/MaVoixPanel', () => ({ default: () => null }));
vi.mock('@/components/avatar/studio/EnregistreurSource', () => ({ default: () => null }));
vi.mock('@/components/avatar/studio/PreparationSource', () => ({
  default: (p: { onPret: (r: unknown) => void }) => (
    <button data-fausse-preparation onClick={() => p.onPret({
      cleOriginal: 'O', cleTraitee: 'T', infos: { largeurEffective: 1920, hauteurEffective: 1080 },
      parametres: { amelioration: { embellissement: 'doux' } },
    })}>prête</button>
  ),
}));

import ProgressStatus from '../components/ux/ProgressStatus';
import MesAvatars, { type AvatarPublic } from '../components/avatar/MesAvatars';
import FluxSourceAvatar from '../components/avatar/FluxSourceAvatar';
import AvatarPage from '../app/dashboard/avatar/page';
import {
  progressionVersion, etapesGeneration, ETAPES_GENERATION_HEYGEN, ETAPES_GENERATION_JUMEAU, lireGenerationEnCours,
  CLE_GENERATION_EN_COURS, formatSource, etapesParcoursSource,
} from '../lib/avatar/progression';
import {
  CLASSES_LECTEUR_GENERATION, CLASSE_LECTEUR_GENERATION, FORMATS_LECTEUR, hauteurLecteur, ratioCadre, largeurLecteur,
} from '../lib/ui/lecteur-generation';
import { MOTEUR_PAR_QUALITE, LIBELLE_QUALITE, qualiteParDefaut, qualitesDisponibles, qualitesMonAvatar, QUALITE_PAR_DEFAUT_MON_AVATAR, lireMoteursSupportes } from '../lib/avatar/moteurs';
import {
  argumentsFfmpeg, bornerParametres, filtreEmbellissement, NIVEAUX_EMBELLISSEMENT, EMBELLISSEMENT_PAR_DEFAUT, AMELIORATION_NEUTRE,
} from '../lib/avatar/preparation-source-regles';

const ENV = (e: Record<string, string> = {}) => e as unknown as NodeJS.ProcessEnv;

// ─────────────────────────────────────────────────────────────────────────
// 1. La progression d'une nouvelle version, dérivée de l'état serveur
// ─────────────────────────────────────────────────────────────────────────

describe('Progression d’une nouvelle version', () => {
  const etats = (p: ReturnType<typeof progressionVersion>) => p.etapes.map((e) => `${e.libelle}:${e.etat}`);

  it('⚠️ chaque état serveur a sa progression : Source ✓ Consentement ✓ puis l’étape réelle', () => {
    expect(etats(progressionVersion({ version: 4, etat: 'preparation' }))).toEqual(['Source:terminee', 'Consentement:terminee', 'Entraînement:courante', 'Aperçu:a_venir', 'Validation:a_venir']);
    const e = progressionVersion({ version: 4, etat: 'entrainement' });
    expect(e.titre).toBe('Nouvelle version v4');
    expect(e.statut).toBe('en_cours');
    expect(e.message).toBe('Entraînement de votre avatar en cours…');
    expect(etats(progressionVersion({ version: 4, etat: 'prete', apercu: 'en_cours' }))[3]).toBe('Aperçu:courante');
    expect(progressionVersion({ version: 4, etat: 'prete', apercu: 'en_cours' }).statut).toBe('en_cours');
    expect(etats(progressionVersion({ version: 4, etat: 'prete', apercu: 'pret' }))).toEqual(['Source:terminee', 'Consentement:terminee', 'Entraînement:terminee', 'Aperçu:terminee', 'Validation:courante']);
    // Prête, aperçu pas encore lancé : c'est à la personne d'agir — aucun travail simulé.
    expect(progressionVersion({ version: 4, etat: 'prete', apercu: 'aucun' }).statut).toBe('attente');
  });

  it('⚠️ une erreur ARRÊTE la progression sur l’étape fautive', () => {
    const p = progressionVersion({ version: 4, etat: 'echec', message: 'Source refusée.' });
    expect(p.statut).toBe('erreur');
    expect(p.etapes.find((e) => e.etat === 'echouee')?.libelle).toBe('Entraînement');
    expect(p.etapes.some((e) => e.etat === 'courante')).toBe(false);
    expect(p.message).toBe('Source refusée.');
    expect(progressionVersion({ version: 4, etat: 'prete', apercu: 'echec' }).etapes[3].etat).toBe('echouee');
  });

  it('⚠️ après un rechargement, la même réponse serveur redonne la MÊME progression (jamais remise au début)', () => {
    const avant = progressionVersion({ version: 5, etat: 'prete', apercu: 'en_cours' });
    const apres = progressionVersion(JSON.parse(JSON.stringify({ version: 5, etat: 'prete', apercu: 'en_cours' })));
    expect(apres).toEqual(avant);
    expect(apres.etapes.filter((e) => e.etat === 'terminee')).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Aucun faux pourcentage
// ─────────────────────────────────────────────────────────────────────────

describe('Aucun faux pourcentage', () => {
  afterEach(cleanup);

  it('⚠️ sans pourcentage réel : barre INDÉTERMINÉE, aucun « % » d’opération affiché', () => {
    const { container } = render(<ProgressStatus titre="Entraînement" statut="en_cours" etapes={progressionVersion({ version: 4, etat: 'entrainement' }).etapes} />);
    expect(container.querySelector('[data-progress-barre]')!.getAttribute('data-progress-barre')).toBe('indeterminee');
    expect(container.querySelector('[data-progress-pourcentage]')).toBeNull();
    expect(container.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBeNull();
  });

  it('un pourcentage RÉEL (octets envoyés) est affiché tel quel', () => {
    const { container } = render(<ProgressStatus titre="Envoi" statut="en_cours" pourcentage={37} />);
    expect(container.querySelector('[data-progress-pourcentage]')!.textContent).toBe('37 %');
  });

  it('« attente » : c’est à la personne d’agir — ni spinner ni barre animée', () => {
    const { container } = render(<ProgressStatus titre="Nouvelle version v4" statut="attente" />);
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('⚠️ le code des étapes de génération ne contient AUCUN pourcentage écrit en dur', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    for (const f of ['../lib/avatar/progression.ts', '../components/avatar/MesAvatars.tsx', '../components/avatar/FluxSourceAvatar.tsx']) {
      const src = readFileSync(resolve(__dirname, f), 'utf-8');
      expect(src).not.toMatch(/pourcentage=\{\s*\d/);
      expect(src).not.toMatch(/pourcentage:\s*\d{2}/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Étapes de la génération vidéo
// ─────────────────────────────────────────────────────────────────────────

describe('Génération : étapes réelles', () => {
  it('voix HeyGen : Envoi → Génération de l’avatar → Vidéo prête', () => {
    expect(etapesGeneration(ETAPES_GENERATION_HEYGEN, 'generation').map((e) => e.etat)).toEqual(['terminee', 'courante', 'a_venir']);
    expect(etapesGeneration(ETAPES_GENERATION_HEYGEN, 'prete').every((e) => e.etat === 'terminee')).toBe(true);
  });
  it('voix clonée : les phases du jumeau ; un échec s’arrête sur l’étape fautive', () => {
    expect(ETAPES_GENERATION_JUMEAU.map((e) => e.libelle)).toEqual(['Vérification de la voix', 'Préparation audio', 'Génération de l’avatar', 'Finalisation', 'Vidéo prête']);
    const e = etapesGeneration(ETAPES_GENERATION_JUMEAU, 'traitement', true);
    expect(e[2].etat).toBe('echouee');
    expect(e.slice(3).every((x) => x.etat === 'a_venir')).toBe(true);
  });
  it('reprise : une entrée mémorisée valide est relue ; périmée, forgée ou illisible → rien', () => {
    const g = { generationId: '11111111-2222-4333-8444-555555555555', mode: 'heygen', avatarId: 'a1', debutLe: 1_000_000 };
    expect(lireGenerationEnCours(JSON.stringify(g), 1_000_000 + 60_000)).toEqual(g);
    expect(lireGenerationEnCours(JSON.stringify(g), 1_000_000 + 36 * 60_000)).toBeNull();
    expect(lireGenerationEnCours(JSON.stringify({ ...g, generationId: '../x' }), 1_000_000)).toBeNull();
    expect(lireGenerationEnCours('{pas du json', 1_000_000)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. Le lecteur suit le format
// ─────────────────────────────────────────────────────────────────────────

describe('Lecteur : ratio du format choisi', () => {
  it('⚠️ 9:16 → 9 / 16, 16:9 → 16 / 9, 1:1 → 1 / 1 ; une classe par format, le 9:16 inchangé', () => {
    expect(ratioCadre('9:16')).toBe('9 / 16');
    expect(ratioCadre('16:9')).toBe('16 / 9');
    expect(ratioCadre('1:1')).toBe('1 / 1');
    expect(CLASSES_LECTEUR_GENERATION['9:16']).toBe(CLASSE_LECTEUR_GENERATION);
    expect(new Set(Object.values(CLASSES_LECTEUR_GENERATION)).size).toBe(3);
  });
  it('⚠️ budget de hauteur : aucun format ne dépasse la hauteur du lecteur 9:16 validé (bouton toujours visible)', () => {
    for (const h of [768, 800, 900]) {
      const budget = (largeurLecteur(h) * 16) / 9;
      for (const f of FORMATS_LECTEUR) expect(hauteurLecteur(f, h, 340)).toBeLessThanOrEqual(budget + 0.5);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. Version ≠ qualité ; correspondance des moteurs
// ─────────────────────────────────────────────────────────────────────────

describe('Version et qualité', () => {
  it('⚠️ Standard → avatar_iii, Qualité → avatar_iv, Premium → avatar_v', () => {
    expect(MOTEUR_PAR_QUALITE).toEqual({ standard: 'avatar_iii', qualite: 'avatar_iv', premium: 'avatar_v' });
    expect(LIBELLE_QUALITE).toEqual({ standard: 'Standard', qualite: 'Qualité', premium: 'Premium' });
  });
  it('⚠️ Mon avatar (voix HeyGen) : Qualité/avatar_iv par défaut et recommandée, Standard ouvert, Premium fermé sans confirmation', () => {
    expect(QUALITE_PAR_DEFAUT_MON_AVATAR).toBe('qualite');
    const q = qualitesMonAvatar(null, ENV());
    expect(q.map((x) => `${x.qualite}:${x.ouverte}`)).toEqual(['standard:true', 'qualite:true', 'premium:false']);
    expect(q.find((x) => x.recommandee)?.qualite).toBe('qualite');
    expect(q[2].motif).toBe('Pas encore ouvert sur Studiio.');
    // Ouvert par le serveur mais NON confirmé par le fournisseur : toujours fermé, motif dit.
    expect(qualitesMonAvatar(null, ENV({ AVATAR_MOTEURS_AUTORISES: 'avatar_v' }))[2]).toMatchObject({ ouverte: false, motif: 'Compatibilité de votre avatar non confirmée par le service de génération.' });
    expect(qualitesMonAvatar(['avatar_iii', 'avatar_iv'], ENV({ AVATAR_MOTEURS_AUTORISES: 'avatar_v' }))[2]).toMatchObject({ ouverte: false, motif: 'Non pris en charge par votre avatar.' });
    // Ouvert ET confirmé (`supported_api_engines`) : Premium s'ouvre.
    expect(qualitesMonAvatar(['avatar_iii', 'avatar_iv', 'avatar_v'], ENV({ AVATAR_MOTEURS_AUTORISES: 'avatar_v' }))[2].ouverte).toBe(true);
    expect(lireMoteursSupportes(['avatar_v', 'inconnu', 3])).toEqual(['avatar_v']);
    expect(lireMoteursSupportes(undefined)).toBeNull();
  });

  it('⚠️ par défaut seul Standard est ouvert ; la présélection suit le moteur par défaut du serveur', () => {
    expect(qualitesDisponibles(ENV()).map((q) => `${q.qualite}:${q.ouverte}`)).toEqual(['standard:true', 'qualite:false', 'premium:false']);
    expect(qualiteParDefaut(ENV())).toBe('standard');
    expect(qualiteParDefaut(ENV({ HEYGEN_AVATAR_ENGINE: 'avatar_iv' }))).toBe('qualite');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. Embellir — non destructif, sans géométrie
// ─────────────────────────────────────────────────────────────────────────

describe('Embellir le visage', () => {
  const infos = { largeurEffective: 1080, hauteurEffective: 1920 };
  const base = bornerParametres({ debutS: 0, finS: 30 }, 30);

  it('⚠️ quatre niveaux, « Naturel » proposé d’emblée ; une demande muette ou inconnue = AUCUN lissage', () => {
    expect(NIVEAUX_EMBELLISSEMENT).toEqual(['aucun', 'naturel', 'doux', 'lisse']);
    expect(EMBELLISSEMENT_PAR_DEFAUT).toBe('naturel');
    expect(base.amelioration.embellissement).toBe('aucun');
    expect(bornerParametres({ amelioration: { embellissement: 'remodeler' } as never }, 30).amelioration.embellissement).toBe('aucun');
    expect(AMELIORATION_NEUTRE.embellissement).toBe('aucun');
  });

  it('⚠️ un seul filtre de lissage (bilatéral), AUCUNE transformation géométrique ajoutée', () => {
    const sans = argumentsFfmpeg('in.mp4', 'out.mp4', base, infos);
    for (const n of ['naturel', 'doux', 'lisse'] as const) {
      const avec = argumentsFfmpeg('in.mp4', 'out.mp4', bornerParametres({ debutS: 0, finS: 30, amelioration: { embellissement: n } as never }, 30), infos);
      const vf = avec[avec.indexOf('-vf') + 1];
      expect(vf).toContain(filtreEmbellissement(n)!);
      expect(vf.replace(`${filtreEmbellissement(n)!},`, '')).toBe(sans[sans.indexOf('-vf') + 1]);
      expect(filtreEmbellissement(n)).toMatch(/^bilateral=/);
      expect(vf).not.toMatch(/crop|scale|transpose|perspective|lenscorrection|remap|displace/);
    }
    expect(filtreEmbellissement('aucun')).toBeNull();
  });

  it('⚠️ non destructif : l’original est l’ENTRÉE, la version embellie une AUTRE sortie', () => {
    const a = argumentsFfmpeg('original.mp4', 'preparee.mp4', bornerParametres({ debutS: 0, finS: 30, amelioration: { embellissement: 'lisse' } as never }, 30), infos);
    expect(a[a.indexOf('-i') + 1]).toBe('original.mp4');
    expect(a[a.length - 1]).toBe('preparee.mp4');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 7. « Mes avatars » : progression de la v4, historique, choix d'avatar
// ─────────────────────────────────────────────────────────────────────────

type Rep = { success?: boolean; data?: unknown; error?: string };
let reponses: Record<string, Rep> = {};
const appels: Array<{ url: string; method: string; corps: unknown }> = [];

const v = (version: number, etat: string, over: Record<string, unknown> = {}) => ({ id: `v${version}`, version, etat, message: null, type: 'video', creeLe: '2026-10-09T10:00:00Z', valideeLe: null, source: true, originalConserve: false, ...over });
const avatar = (over: Partial<AvatarPublic> = {}): AvatarPublic => ({
  id: 'a1', nom: 'Bassi principal', parDefaut: true, type: 'video', utilisable: true,
  versionActive: v(3, 'prete', { valideeLe: '2026-10-06', activeeLe: '2026-10-06T11:00:00Z' }) as never, candidate: null, historique: [], ...over,
});
const liste = (avatars: AvatarPublic[]) => { reponses['/api/avatars'] = { success: true, data: { avatars, capacite: { nouvelAvatarPhoto: true, nouvelAvatarVideo: false, emplacementsVideoLibres: 0 }, qualites: [] } }; };

describe('Mes avatars — progression, historique, choix', () => {
  beforeEach(() => {
    appels.length = 0; reponses = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      appels.push({ url, method: init?.method ?? 'GET', corps: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null });
      const r = reponses[url] ?? { success: true, data: {} };
      return { ok: r.success !== false, json: async () => r } as Response;
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('⚠️ v4 en entraînement : étapes visibles, barre indéterminée, « Votre version v3 reste utilisée »', async () => {
    liste([avatar({ candidate: v(4, 'entrainement') as never })]);
    const { container } = render(<MesAvatars />);
    await waitFor(() => expect(container.querySelector('[data-candidate="en-preparation"]')).not.toBeNull());
    const bloc = container.querySelector('[data-candidate="en-preparation"]')!;
    expect(bloc.querySelector('[data-progress-titre]')!.textContent).toBe('Nouvelle version v4');
    expect(bloc.querySelector('[data-progress-barre]')!.getAttribute('data-progress-barre')).toBe('indeterminee');
    expect([...bloc.querySelectorAll('[data-progress-etape-etat]')].map((e) => e.getAttribute('data-progress-etape-etat'))).toEqual(['terminee', 'terminee', 'courante', 'a_venir', 'a_venir']);
    expect(bloc.textContent).toMatch(/Votre version v3 reste utilisée/);
    // La v3 active reste affichée comme utilisée.
    expect(container.querySelector('[data-version-active]')?.textContent).toBe('Version actuellement utilisée : v3');
  });

  it('⚠️ rechargement pendant la génération de l’aperçu : le SUIVI reprend (lecture de statut), rien n’est relancé', async () => {
    liste([avatar({ candidate: v(4, 'prete', { apercu: 'en_cours', apercuGenerationId: 'gen-apercu-4' }) as never })]);
    const { container } = render(<MesAvatars />);
    await waitFor(() => expect(container.querySelector('[data-candidate-apercu="en_cours"]')).not.toBeNull());
    expect(container.querySelector('[data-candidate-apercu] [data-progress-etape-etat="courante"]')!.textContent).toContain('Aperçu');
    await waitFor(() => expect(appels.some((a) => a.url === '/api/avatar/status?generationId=gen-apercu-4')).toBe(true));
    expect(appels.some((a) => a.url === '/api/avatar/generate')).toBe(false);
  });

  it('⚠️ Gérer → « Versions de l’avatar » : v3 active puis l’historique conservé ; version ≠ qualité', async () => {
    liste([avatar({ historique: [v(2, 'prete', { valideeLe: '2026-10-01', activeeLe: '2026-10-01T09:00:00Z', apercu: 'pret', originalConserve: true }), v(1, 'abandonnee')] as never })]);
    const { container } = render(<MesAvatars />);
    await waitFor(() => expect(container.querySelector('[data-action="gerer"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-action="gerer"]')!);
    const lignes = [...container.querySelectorAll('[data-version-ligne]')];
    expect(lignes.map((l) => l.getAttribute('data-version-statut'))).toEqual(['Active', 'Version précédente', 'Mise de côté']);
    expect(lignes[0].querySelector('[data-version-numero]')!.textContent).toBe('v3 — Active');
    expect(lignes[1].querySelector('[data-version-source]')!.textContent).toBe('Vidéo (original conservé)');
    expect(container.querySelector('[data-historique-version-qualite]')!.textContent).toMatch(/pas des niveaux de qualité/);
    // La version active ne propose pas de « revenir » ; la v2 déjà utilisée, si.
    expect(lignes[0].querySelector('[data-action="revenir"]')).toBeNull();
    expect(lignes[1].querySelector('[data-action="revenir"]')).not.toBeNull();
    expect(lignes[2].querySelector('[data-action="revenir"]')).toBeNull();
    // Voir la source : la source PRIVÉE de cette version, puis l'original conservé.
    fireEvent.click(lignes[1].querySelector('[data-action="voir-source"]')!);
    expect(lignes[1].querySelector('[data-version-source-vue] video')!.getAttribute('src')).toBe('/api/avatars/versions/v2/source');
    fireEvent.click(lignes[1].querySelector('[data-action="voir-original"]')!);
    expect(lignes[1].querySelector('[data-version-source-vue] video')!.getAttribute('src')).toBe('/api/avatars/versions/v2/source?quelle=originale');
  });

  it('⚠️ « Revenir à cette version » réactive la version prête — une seule action « revenir », aucun lancement d’entraînement', async () => {
    liste([avatar({ historique: [v(2, 'prete', { valideeLe: '2026-10-01' })] as never })]);
    const { container } = render(<MesAvatars />);
    await waitFor(() => expect(container.querySelector('[data-action="gerer"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-action="gerer"]')!);
    await act(async () => { fireEvent.click(container.querySelector('[data-action="revenir"]')!); });
    const posts = appels.filter((a) => a.method === 'POST');
    expect(posts).toEqual([{ url: '/api/avatars/versions/v2', method: 'POST', corps: { action: 'revenir' } }]);
    expect(appels.some((a) => a.url === '/api/avatar/create' || a.url === '/api/avatar/generate')).toBe(false);
  });

  it('⚠️ « Changer d’avatar » = choisir parmi MES avatars (pas un nouvel envoi de source)', async () => {
    liste([avatar(), avatar({ id: 'a2', nom: 'Bassi studio', parDefaut: false })]);
    const { container, rerender } = render(<MesAvatars demandeChoixAvatar={0} />);
    await waitFor(() => expect(container.querySelectorAll('[data-carte-avatar]')).toHaveLength(2));
    rerender(<MesAvatars demandeChoixAvatar={1} />);
    await waitFor(() => expect(container.querySelector('[data-choix-avatar]')).not.toBeNull());
    await act(async () => { fireEvent.click(container.querySelector('[data-choix-avatar-utiliser="a2"]')!); });
    expect(appels.filter((a) => a.method === 'POST')).toEqual([{ url: '/api/avatars/defaut', method: 'POST', corps: { avatarId: 'a2' } }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 8. Remplacer / Créer : récapitulatif avant l'entraînement
// ─────────────────────────────────────────────────────────────────────────

describe('Parcours d’une nouvelle source — récapitulatif', () => {
  beforeEach(() => {
    appels.length = 0; reponses = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const corps = init?.body instanceof FormData ? Object.fromEntries((init.body as FormData).entries()) : null;
      appels.push({ url, method: init?.method ?? 'GET', corps });
      return { ok: true, json: async () => ({ success: true, data: {} }) } as Response;
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('⚠️ remplacer en vidéo : récapitulatif (source, format, embellissement) AVANT tout envoi ; puis une NOUVELLE VERSION de la même identité', async () => {
    const fin = vi.fn();
    const { container } = render(<FluxSourceAvatar mode="remplacer" avatar={{ id: 'a1', nom: 'Mon avatar vidéo', type: 'video' }} capacite={{ nouvelAvatarPhoto: true, nouvelAvatarVideo: false }} onFermer={() => {}} onTermine={fin} />);
    expect([...container.querySelectorAll('[data-flux-etape]')].map((e) => e.getAttribute('data-flux-etape'))).toEqual(['source', 'preparation', 'consentement', 'recapitulatif', 'lancement']);
    const entree = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(entree, { target: { files: [new File(['x'], 'moi.mp4', { type: 'video/mp4' })] } });
    fireEvent.click(container.querySelector('[data-fausse-preparation]')!);
    fireEvent.click(container.querySelector('[data-flux-consentement]')!);
    fireEvent.click(container.querySelector('[data-flux-continuer]')!);
    expect(appels).toHaveLength(0);
    const recap = (k: string) => container.querySelector(`[data-flux-recap="${k}"]`)!.textContent;
    expect(recap('avatar')).toBe('Mon avatar vidéo');
    expect(recap('source')).toBe('Vidéo importée');
    expect(recap('format')).toBe('16:9 (1920 × 1080)');
    expect(recap('embellissement')).toBe('Doux');
    expect(recap('qualite')).toBe('Choisie à chaque génération de vidéo');
    expect(container.querySelector('[data-flux-recap-apercu] video')!.getAttribute('src')).toBe('/api/avatar/sources/apercu?cle=T');
    await act(async () => { fireEvent.click(container.querySelector('[data-flux-envoyer]')!); });
    await waitFor(() => expect(fin).toHaveBeenCalled());
    // Remplacer = une version de la MÊME identité : mode « remplacer » + avatarId, et l'original conservé à côté.
    expect(appels[0].corps).toMatchObject({ mode: 'remplacer', avatarId: 'a1', cleSource: 'T', cleOriginal: 'O' });
  });

  it('⚠️ nouvel avatar : une identité SÉPARÉE (mode « nouveau », sans avatarId)', () => {
    const { container } = render(<FluxSourceAvatar mode="nouveau" avatar={null} capacite={{ nouvelAvatarPhoto: true, nouvelAvatarVideo: true }} onFermer={() => {}} onTermine={() => {}} />);
    expect(container.querySelector('h3')!.textContent).toBe('Créer un nouvel avatar');
    // La photo a désormais SON étape « Améliorer » (embellir), avant le consentement.
    expect(etapesParcoursSource('photo').map((e) => `${e.cle}:${e.libelle}`)).toEqual(['source:Source', 'preparation:Améliorer', 'consentement:Consentement', 'recapitulatif:Récapitulatif', 'lancement:Lancement']);
  });

  it('formatSource : dimensions réelles → format lisible ; inconnues → null (rien d’inventé)', () => {
    expect(formatSource(1080, 1920)).toBe('9:16 (1080 × 1920)');
    expect(formatSource(1000, 1000)).toBe('1:1 (1000 × 1000)');
    expect(formatSource(1000, 700)).toBe('1000 × 700');
    expect(formatSource(null, 1920)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 9. La page : format du lecteur, qualité, progression de génération, reprise
// ─────────────────────────────────────────────────────────────────────────

const A = '11111111-1111-4111-8111-000000000001';
const GEN = '99999999-1111-4111-8111-000000000009';
const URL_VIDEO = 'https://studiio.pro/storage/v1/object/public/media/u/avatar/heygen.mp4';
const avatarValide = { id: A, name: 'Mon avatar vidéo', status: 'completed', avatar_type: 'video', created_at: '2026-10-06T00:00:00Z', etat: 'valide', version: 3, validated_at: '2026-10-06T10:00:00Z', provider: 'heygen' };
const page = { statut: 'completed' as string, qualites: [] as unknown[] };

describe('Page Mon avatar', () => {
  beforeEach(() => {
    appels.length = 0;
    page.statut = 'completed';
    // Ce que le serveur rend réellement : fournisseur non confirmé, aucune configuration.
    page.qualites = qualitesMonAvatar(null, {} as NodeJS.ProcessEnv);
    window.localStorage.clear();
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      appels.push({ url: u, method: init?.method ?? 'GET', corps: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null });
      const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body } as unknown as Response);
      if (u === '/api/avatar/create') return json({ success: true, data: { avatar: avatarValide, voices: [{ voiceId: 'hg1', name: 'Yosef', language: 'French' }], defaultVoiceId: 'hg1', qualites: page.qualites, qualiteParDefaut: QUALITE_PAR_DEFAUT_MON_AVATAR, qualitesVoixClonee: qualitesDisponibles({} as NodeJS.ProcessEnv), qualiteParDefautVoixClonee: 'standard' } });
      if (u === '/api/avatar/apercu') return json({ success: true, data: { apercu: { statut: 'aucun' }, renduRecent: null } });
      if (u === '/api/avatar/generate') return json({ success: true, data: { generationId: GEN, status: 'pending' } });
      if (u.startsWith('/api/avatar/status?generationId=')) return json({ success: true, data: page.statut === 'completed' ? { status: 'completed', videoUrl: URL_VIDEO } : { status: page.statut } });
      if (u === '/api/voice/clone') return json({ success: true, voices: [] });
      return json({ success: true, data: { avatars: [], capacite: { nouvelAvatarPhoto: true, nouvelAvatarVideo: false, emplacementsVideoLibres: 0 } } });
    }) as unknown as typeof fetch;
  });
  afterEach(() => { cleanup(); });

  const monter = async () => {
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-avatar-generation]')).not.toBeNull());
  };
  const cadre = () => document.querySelector('[data-avatar-apercu-cadre]')!.getAttribute('data-avatar-apercu-cadre');

  it('⚠️ le cadre suit le bouton Format IMMÉDIATEMENT : 9:16 → 16:9 → 1:1', async () => {
    await monter();
    expect(cadre()).toBe('9 / 16');
    const format = (r: string) => [...document.querySelectorAll('[data-avatar-generation] button')].find((b) => b.textContent === r)!;
    fireEvent.click(format('16:9'));
    expect(cadre()).toBe('16 / 9');
    expect(document.querySelector('[data-apercu-media], [data-apercu]')!.closest('section')!.className).toContain(CLASSES_LECTEUR_GENERATION['16:9']);
    fireEvent.click(format('1:1'));
    expect(cadre()).toBe('1 / 1');
    fireEvent.click(format('9:16'));
    expect(cadre()).toBe('9 / 16');
  });

  it('⚠️ qualité : « Qualité » (Avatar IV, le moteur déjà utilisé) présélectionnée et recommandée ; Premium fermé avec son motif', async () => {
    await monter();
    const choix = document.querySelector('[data-avatar-qualite-choix]') as HTMLSelectElement;
    const opt = (q: string) => document.querySelector(`[data-avatar-qualite-option="${q}"]`) as HTMLOptionElement;
    expect(choix.value).toBe('qualite');
    expect(opt('qualite').textContent).toBe('Qualité — recommandé');
    expect(opt('standard').disabled).toBe(false);
    expect(opt('premium').disabled).toBe(true);
    // La raison est DITE dans le libellé du niveau fermé.
    expect(opt('premium').textContent).toBe('Premium — maximale (indisponible : Pas encore ouvert sur Studiio.)');
    fireEvent.change(document.querySelector('[data-avatar-generation] textarea')!, { target: { value: 'Bonjour.' } });
    await act(async () => { fireEvent.click(document.querySelector('[data-avatar-generer] button')!); });
    await waitFor(() => expect(document.querySelector(`video[src="${URL_VIDEO}"]`)).not.toBeNull());
    expect(appels.find((a) => a.url === '/api/avatar/generate')!.corps).toMatchObject({ qualite: 'qualite' });
    // Succès clair, étapes toutes franchies.
    expect(document.querySelector('[data-avatar-generation-progression="completed"]')).not.toBeNull();
  });

  it('⚠️ Standard reste sélectionnable et part tel quel', async () => {
    await monter();
    fireEvent.change(document.querySelector('[data-avatar-qualite-choix]')!, { target: { value: 'standard' } });
    expect((document.querySelector('[data-avatar-qualite-choix]') as HTMLSelectElement).value).toBe('standard');
    fireEvent.change(document.querySelector('[data-avatar-generation] textarea')!, { target: { value: 'Bonjour.' } });
    await act(async () => { fireEvent.click(document.querySelector('[data-avatar-generer] button')!); });
    await waitFor(() => expect(appels.some((a) => a.url === '/api/avatar/generate')).toBe(true));
    expect(appels.find((a) => a.url === '/api/avatar/generate')!.corps).toMatchObject({ qualite: 'standard' });
  });

  it('⚠️ génération en cours : étapes réelles + statut fournisseur, puis reprise du SUIVI après rechargement (sans relancer)', async () => {
    page.statut = 'processing';
    await monter();
    fireEvent.change(document.querySelector('[data-avatar-generation] textarea')!, { target: { value: 'Bonjour.' } });
    await act(async () => { fireEvent.click(document.querySelector('[data-avatar-generer] button')!); });
    await waitFor(() => expect(document.querySelector('[data-avatar-generation-phase="generation"]')).not.toBeNull());
    const bloc = document.querySelector('[data-avatar-generation-progression]')!;
    expect(bloc.querySelector('[data-progress-barre]')!.getAttribute('data-progress-barre')).toBe('indeterminee');
    expect(bloc.textContent).toMatch(/Le service de génération anime votre avatar/);
    // La génération acceptée est mémorisée…
    expect(JSON.parse(window.localStorage.getItem(CLE_GENERATION_EN_COURS)!)).toMatchObject({ generationId: GEN, mode: 'heygen', avatarId: A });

    // … et après un rechargement, le suivi reprend sur l'étape réelle — sans nouvel envoi.
    cleanup();
    appels.length = 0;
    await monter();
    await waitFor(() => expect(document.querySelector('[data-avatar-generation-phase="generation"]')).not.toBeNull());
    await waitFor(() => expect(appels.some((a) => a.url === `/api/avatar/status?generationId=${GEN}`)).toBe(true));
    expect(appels.some((a) => a.url === '/api/avatar/generate')).toBe(false);
  });

  it('⚠️ une erreur arrête la progression : statut erreur, étape fautive, motif', async () => {
    page.statut = 'failed';
    await monter();
    fireEvent.change(document.querySelector('[data-avatar-generation] textarea')!, { target: { value: 'Bonjour.' } });
    await act(async () => { fireEvent.click(document.querySelector('[data-avatar-generer] button')!); });
    await waitFor(() => expect(document.querySelector('[data-avatar-generation-progression="failed"]')).not.toBeNull());
    const bloc = document.querySelector('[data-avatar-generation-progression]')!;
    expect(bloc.querySelector('[data-progress-status]')!.getAttribute('data-progress-status')).toBe('erreur');
    expect(bloc.querySelector('[data-progress-etape-etat="echouee"]')!.textContent).toContain('Génération de l’avatar');
    expect(bloc.querySelector('.animate-spin')).toBeNull();
    expect(window.localStorage.getItem(CLE_GENERATION_EN_COURS)).toBeNull();
  });

  it('chargement initial : un texte dit ce qui se passe', () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    render(<AvatarPage />);
    expect(document.querySelector('[data-avatar-chargement]')!.textContent).toBe('Chargement de votre avatar…');
  });
});
