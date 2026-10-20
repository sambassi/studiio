import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import ApercuMontageListe from '@/components/creer/ApercuMontageListe';
import ChronologieMontage, { segmentsChronologie, LARGEUR_MIN_SEGMENT } from '@/components/creer/ChronologieMontage';
import CompleterRushesStock, { CANDIDATS_PAR_PLAN, classerCandidats, repartirCandidats } from '@/components/creer/CompleterRushesStock';
import { lireVideoAvatarReelle } from '@/components/creer/AvatarPrincipalAutopilote';
import { etapesMontageApercuAutopilote, mediaApercuAutopilote, signatureResume, type ResumeMediasApercu } from '@/lib/autopilot/apercu-medias';
import { planCompletAutopilote } from '@/lib/autopilot/plan-complet';
import { construireRecherchesStock, conceptsAbstraitsDe } from '@/lib/stock/requetes';
import { pertinenceMedia, scenarioPertinence } from '@/lib/autopilot/pertinence-medias';
import type { EtapeApercu, LigneChronologie } from '@/lib/creer/medias-video';
import type { MediaStock } from '@/lib/stock/types';
import type { MediaStockRetenu } from '@/lib/autopilot/sources';

/**
 * Autopilote — médias, chronologie visuelle, aperçu réel de l'avatar.
 *
 * Retours utilisateur (capture du 20/10) : des pastilles de texte
 * (« Vidéo suggérée 0–4 s / Mon avatar 4–7 s… ») au lieu d'images ; une
 * recherche « motivation motiver » qui donnait des torses et une main qui
 * écrit ; un seul choix par plan ; l'avatar remplacé par un exemple.
 */

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const ORIGINE = 'https://studiio.pro/storage/v1/object/public/media/u1';
const RUSH = `${ORIGINE}/plage.mp4`;
const STOCK_V = `${ORIGINE}/library/stock-pexels-video-77.mp4`;
const PHOTO = 'https://images.pexels.com/photos/9/p.jpg';
const VIDEO_AVATAR = `${ORIGINE}/avatar/11111111-1111-4111-8111-111111111111.mp4`;
const VIGNETTE_AVATAR = { url: '/api/avatars/versions/ver-1/source', type: 'photo' as const };

const retenu = (url: string, type: 'video' | 'photo'): MediaStockRetenu => ({
  url, type, provider: 'pexels', providerAssetId: url, auteur: 'X', sourceUrl: '', licence: 'Pexels License', vignetteUrl: `${url}.jpg`,
});

function resume(o: Partial<ResumeMediasApercu> = {}): ResumeMediasApercu {
  return {
    gabarit: [],
    actives: { rushes: true, avatar: false, stock: false },
    rushesPerso: [],
    stock: [],
    avatar: { disponible: false, vignette: null },
    ...o,
  };
}

/* ─────────────────────────────────────────────────────────────────────── */

describe('Requêtes — sujet abstrait → scènes concrètes en anglais', () => {
  const MOTS_FR = /\b(motiv\w*|objectif|reussite|confiance)\b/;
  it('« motivation » : au moins 5 requêtes concrètes, en anglais, jamais « motivation motiver »', () => {
    const r = construireRecherchesStock({ sujet: 'motivation', role: 'HOOK', visuel: 'video' });
    expect(r.requetes.length).toBeGreaterThanOrEqual(5);
    expect(r.requetes).not.toContain('motivation motiver');
    for (const q of r.requetes) {
      expect(q).toMatch(/^[a-z ]+$/);
      expect(q).not.toMatch(MOTS_FR);
      expect(q.split(' ').length).toBeLessThanOrEqual(4);
    }
    expect(r.requetes).toEqual(expect.arrayContaining(['athlete training sunrise', 'runner determination', 'person climbing stairs', 'writing goals notebook', 'boxing training']));
    expect(r.intentions[0]).toBe('motivation');
    // Libellés FRANÇAIS à l'écran, requêtes anglaises envoyées.
    expect(r.suggestions[0].libelle).toMatch(/[éèà’]|Athlète/);
  });

  it('chaque phase (accroche, développement, temps fort) ouvre sur une scène différente', () => {
    const premieres = (['HOOK', 'BUILD', 'PEAK'] as const).map((role) => construireRecherchesStock({ sujet: 'motivation', role, visuel: 'video' }).requetes[0]);
    expect(new Set(premieres).size).toBe(3);
  });

  it('combiné avec l’objectif : l’activité du brief, dite avec le concept', () => {
    const r = construireRecherchesStock({ sujet: 'motivation', objectif: 'remplir ma salle de sport', role: 'HOOK', visuel: 'video' });
    expect(r.requetes[0]).toBe('athlete training sunrise');
    expect(r.requetes[1]).toMatch(/^determined working out/);
  });

  it('autres concepts abstraits reconnus (confiance, discipline, réussite)', () => {
    expect(conceptsAbstraitsDe('Avoir confiance en soi').map((c) => c.id)).toEqual(['confiance']);
    expect(conceptsAbstraitsDe('La discipline au quotidien').map((c) => c.id)).toEqual(['discipline']);
    expect(construireRecherchesStock({ sujet: 'réussite', role: 'HOOK' }).requetes[0]).toBe('celebrating victory');
  });

  it('DEFAULT SAFE : un sujet de la taxonomie garde ses requêtes (aucune scène abstraite)', () => {
    const r = construireRecherchesStock({ sujet: 'cours Afroboost cardio-danse', texte: 'motivation', role: 'HOOK', visuel: 'video' });
    const sans = construireRecherchesStock({ sujet: 'cours Afroboost cardio-danse', role: 'HOOK', visuel: 'video' });
    expect(r.requetes[0]).toBe(sans.requetes[0]);
    expect(r.intentions).not.toContain('motivation');
    expect(r.requetes.join(' ')).not.toMatch(/sunrise|stairs|notebook/);
  });
});

describe('Pertinence — concepts abstraits : classer, jamais exclure', () => {
  const s = scenarioPertinence({ sujets: ['motivation'] });
  it('un média qui illustre la motivation passe devant ; un autre reste « inconnu » (jamais « hors »)', () => {
    const bon = pertinenceMedia('athlete training at sunrise', s);
    const neutre = pertinenceMedia('cat sleeping on a sofa', s);
    const cuisine = pertinenceMedia('chef cooking pasta', s);
    expect(bon.niveau).toBe('pertinent');
    expect(bon.score).toBeGreaterThan(neutre.score);
    expect(neutre.niveau).toBe('inconnu');
    expect(cuisine.niveau).not.toBe('hors');
  });
  it('sujet de la taxonomie : la règle d’avant, inchangée', () => {
    const v = scenarioPertinence({ sujets: ['Voyage'] });
    expect(v.abstraits).toBeUndefined();
    expect(pertinenceMedia('chef cooking pasta', v).niveau).toBe('hors');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */

function stock(id: string, o: Partial<MediaStock> = {}): MediaStock {
  return {
    id: `pexels-video-${id}`, provider: 'pexels', providerAssetId: id, type: 'video',
    largeur: 1080, hauteur: 1920, orientation: 'portrait', dureeSecondes: 10,
    vignetteUrl: `https://images.pexels.com/videos/${id}/thumb.jpg`, apercuUrl: `https://images.pexels.com/videos/${id}/a.jpg`,
    fichierUrl: `https://videos.pexels.com/video-files/${id}/hd.mp4`, sourceUrl: `https://www.pexels.com/video/${id}/`,
    auteur: `A ${id}`, description: 'person running', licence: 'Pexels License', attribution: 'x', ...o,
  };
}

describe('Candidats — 3 par plan, classés, répartis sans doublon', () => {
  it('classerCandidats : pertinence d’abord, puis le format, « hors » écarté', () => {
    const s = scenarioPertinence({ sujets: ['Voyage'] });
    const r = classerCandidats([
      stock('cuisine', { description: 'chef cooking pasta' }),
      stock('paysage', { description: 'mountain landscape', orientation: 'landscape' }),
      stock('voyageur', { description: 'man traveling with suitcase' }),
    ], { orientation: 'portrait', scenario: s });
    expect(r.map((m) => m.providerAssetId)).toEqual(['voyageur', 'paysage']);
  });

  it('repartirCandidats : au tour par tour, 3 au plus par plan, jamais deux fois le même, banque exclue', () => {
    const l = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x) => stock(x));
    const r = repartirCandidats([l, l, l], new Set(['pexels-video-a']));
    expect(r.map((c) => c.map((m) => m.providerAssetId))).toEqual([['b', 'e'], ['c', 'f'], ['d', 'g']]);
    const r2 = repartirCandidats([l, l.slice().reverse()], new Set());
    expect(r2[0]).toHaveLength(CANDIDATS_PAR_PLAN);
    expect(r2[1]).toHaveLength(CANDIDATS_PAR_PLAN);
    const tous = r2.flat().map((m) => m.id);
    expect(new Set(tous).size).toBe(tous.length);
  });
});

describe('CompleterRushesStock — propositions multiples, vidéos puis photos', () => {
  let appels: string[];
  beforeEach(() => {
    appels = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      appels.push(u);
      const p = new URLSearchParams(u.split('?')[1] ?? '');
      const requete = p.get('requete') ?? '';
      const type = p.get('type');
      const cle = requete.replace(/\s+/g, '_');
      const medias = type === 'photo'
        ? [stock(`ph-${cle}`, { type: 'photo', id: `pexels-photo-ph-${cle}`, description: 'writing goals notebook' })]
        : [1, 2, 3].map((k) => stock(`${cle}-${k}`, { description: requete }));
      return { ok: true, json: async () => ({ success: true, medias, echecs: [] }) };
    }));
  });

  it('3 candidats par plan manquant, une miniature chacun ; « Remplacer » alterne sans réseau ; « Conserver » garde le choix', async () => {
    const conserver = vi.fn();
    const { container } = render(
      <CompleterRushesStock sujet="motivation" rushUrls={[]} accent="#7C3AED" onConserver={conserver} />,
    );
    await waitFor(() => expect(container.querySelectorAll('[data-autopilot-stock-slot][data-etat="propose"]').length).toBe(3));
    for (const plan of ['plan-1', 'plan-2', 'plan-3']) {
      const candidats = container.querySelectorAll(`[data-autopilot-stock-candidats="${plan}"] [data-autopilot-stock-candidat]`);
      expect(candidats.length).toBe(CANDIDATS_PAR_PLAN);
    }
    // Requêtes concrètes, en anglais (jamais « motivation motiver »).
    expect(appels.every((u) => !u.includes('motiver'))).toBe(true);
    expect(appels.some((u) => u.includes('requete=athlete+training+sunrise'))).toBe(true);
    const vignette = () => container.querySelector('[data-autopilot-stock-slot="plan-1"] [data-autopilot-stock-vignette]')!.getAttribute('data-autopilot-stock-vignette');
    const avant = vignette();
    const nb = appels.length;
    fireEvent.click(container.querySelector('[data-autopilot-stock-remplacer="plan-1"]')!);
    await waitFor(() => expect(vignette()).not.toBe(avant));
    expect(appels.length).toBe(nb);
    const choisi = vignette();
    // Rien n'est ajouté sans « Conserver » ; « Conserver » garde LE candidat montré.
    expect(conserver).not.toHaveBeenCalled();
    appels.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const corps = JSON.parse(String(init?.body ?? '{}')) as { providerAssetId: string };
      return { ok: true, json: async () => ({ success: true, url: `${ORIGINE}/library/stock-pexels-video-${corps.providerAssetId}.mp4`, importe: true, media: stock(corps.providerAssetId) }) };
    }));
    fireEvent.click(container.querySelector('[data-autopilot-stock-conserver="plan-1"]')!);
    await waitFor(() => expect(conserver).toHaveBeenCalledTimes(1));
    expect(conserver.mock.calls[0][1].providerAssetId).toBe(choisi);
  });

  it('vidéos insuffisantes : des PHOTOS Pexels complètent (si le panneau sait les retenir)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      appels.push(u);
      const type = new URLSearchParams(u.split('?')[1] ?? '').get('type');
      const medias = type === 'photo'
        ? [1, 2, 3, 4, 5, 6].map((k) => stock(`ph${k}`, { type: 'photo', id: `pexels-photo-ph${k}`, description: 'athlete training' }))
        : [stock('v1', { description: 'athlete training' })];
      return { ok: true, json: async () => ({ success: true, medias, echecs: [] }) };
    }));
    const retenir = vi.fn();
    const { container } = render(
      <CompleterRushesStock sujet="motivation" rushUrls={[]} accent="#7C3AED" onConserver={vi.fn()} onRetenir={retenir} />,
    );
    await waitFor(() => expect(container.querySelectorAll('[data-autopilot-stock-slot][data-etat="propose"]').length).toBe(3));
    const types = (plan: string) => Array.from(container.querySelectorAll(`[data-autopilot-stock-candidats="${plan}"] [data-autopilot-stock-candidat]`)).map((b) => b.getAttribute('aria-label'));
    expect(types('plan-1')).toHaveLength(3);
    expect(types('plan-1').some((l) => /vidéo/.test(l!))).toBe(true);
    expect(types('plan-1').some((l) => /photo/.test(l!))).toBe(true);
    // Unsplash n'est jamais interrogé pour des propositions automatiques.
    expect(appels.every((u) => !u.includes('unsplash'))).toBe(true);
    // Conserver une photo : retenue par le chemin du panneau (aucune importation).
    fireEvent.click(container.querySelector('[data-autopilot-stock-candidats="plan-2"] [data-autopilot-stock-candidat]:nth-child(2)')!);
    fireEvent.click(container.querySelector('[data-autopilot-stock-conserver="plan-2"]')!);
    await waitFor(() => expect(retenir).toHaveBeenCalledTimes(1));
    expect(retenir.mock.calls[0][0]).toMatchObject({ type: 'photo', provider: 'pexels' });
  });

  it('sans onRetenir : vidéos seules (comportement d’avant)', async () => {
    const { container } = render(
      <CompleterRushesStock sujet="motivation" rushUrls={[]} accent="#7C3AED" onConserver={vi.fn()} />,
    );
    await waitFor(() => expect(container.querySelectorAll('[data-autopilot-stock-slot][data-etat="propose"]').length).toBe(3));
    expect(appels.every((u) => u.includes('type=video'))).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */

describe('Chronologie visuelle — ordre, largeurs, libellés', () => {
  const etapes: EtapeApercu[] = [
    { id: 'a', source: 'avatar', type: 'video', url: null, debut: 0, fin: 4, depuis: 0, libelle: 'Mon avatar — accroche', horsNarration: false },
    { id: 'v', source: 'stock-video', type: 'video', url: STOCK_V, debut: 4, fin: 7, depuis: 0, libelle: 'Vidéo suggérée', horsNarration: false },
    { id: 'p', source: 'stock-photo', type: 'image', url: PHOTO, debut: 7, fin: 10, depuis: 0, libelle: 'Photo suggérée', horsNarration: false },
    { id: 'r', source: 'rush', type: 'video', url: RUSH, debut: 10, fin: 12, depuis: 0, libelle: 'Rush : plage.mp4', horsNarration: false },
  ];
  const lignes: LigneChronologie[] = [
    ...etapes.map((e) => ({ id: e.id, libelle: e.libelle, debut: e.debut, fin: e.fin })),
    { id: 'cta', libelle: 'CTA', debut: 12, fin: 16, cta: true, fondu: 0.8 },
  ];

  it('segmentsChronologie : même ordre, genre, durée et part proportionnelle', () => {
    const s = segmentsChronologie(lignes, etapes);
    expect(s.map((x) => x.id)).toEqual(['a', 'v', 'p', 'r', 'cta']);
    expect(s.map((x) => x.genre)).toEqual(['avatar', 'video', 'photo', 'rush', 'cta']);
    expect(s.map((x) => x.duree)).toEqual([4, 3, 3, 2, 4]);
    expect(s.reduce((t, x) => t + x.part, 0)).toBeCloseTo(1, 6);
    expect(s[0].part).toBeCloseTo(4 / 16, 6);
    expect(s[0].url).toBeNull();
    expect(s[1].url).toBe(STOCK_V);
  });

  it('rendu : une bande défilante, largeur ∝ durée (min lisible), icône + « 3 s », clic = saut, Remplacer hors avatar/CTA', () => {
    const sauter = vi.fn();
    const remplacer = vi.fn();
    const { container } = render(
      <ChronologieMontage segments={segmentsChronologie(lignes, etapes)} indexCourant={1} accent="#7C3AED" onSauter={sauter} onRemplacer={remplacer} vignettes={{ [STOCK_V]: 'https://images.pexels.com/v/thumb.jpg' }} />,
    );
    const bande = container.querySelector('[data-chronologie]') as HTMLElement;
    expect(bande.style.overflowX === 'auto' || bande.className.includes('overflow-x-auto')).toBe(true);
    const items = Array.from(container.querySelectorAll('[data-segment]')) as HTMLElement[];
    expect(items.map((li) => li.getAttribute('data-segment'))).toEqual(['avatar', 'video', 'photo', 'rush', 'cta']);
    expect(items.map((li) => Number(li.style.flexGrow))).toEqual([4, 3, 3, 2, 4]);
    for (const li of items) expect(li.style.minWidth).toBe(`${LARGEUR_MIN_SEGMENT}px`);
    expect(items.map((li) => li.querySelector('[data-segment-duree]')!.textContent)).toEqual(['4 s', '3 s', '3 s', '2 s', '4 s']);
    for (const li of items) expect(li.querySelector('svg')).toBeTruthy();
    // Vignette connue : l'image du média, pas un lecteur vidéo.
    expect(items[1].querySelector('img')!.getAttribute('src')).toBe('https://images.pexels.com/v/thumb.jpg');
    expect(items[2].querySelector('img')!.getAttribute('src')).toBe(PHOTO);
    // Libellé complet accessible (« Vidéo suggérée 4–7 s »).
    expect(items[1].textContent).toContain('Vidéo suggérée 4–7 s');
    expect(container.querySelector('[data-ligne="v"]')!.getAttribute('aria-current')).toBe('step');
    fireEvent.click(container.querySelector('[data-ligne="p"]')!);
    expect(sauter).toHaveBeenCalledWith(7);
    expect(container.querySelector('[data-chronologie-remplacer="a"]')).toBeNull();
    expect(container.querySelector('[data-chronologie-remplacer="cta"]')).toBeNull();
    fireEvent.click(container.querySelector('[data-chronologie-remplacer="v"]')!);
    expect(remplacer).toHaveBeenCalledWith(expect.objectContaining({ id: 'v', genre: 'video' }));
  });

  it('sans onRemplacer : aucun bouton (Créer inchangé)', () => {
    const { container } = render(<ApercuMontageListe etapes={etapes} lignes={lignes} format="9:16" accent="#7C3AED" />);
    expect(container.querySelector('[data-chronologie-remplacer]')).toBeNull();
    expect(container.querySelectorAll('[data-chronologie] [data-ligne]').length).toBe(5);
  });

  it('la chronologie de l’Autopilote suit planCompletAutopilote : mêmes médias, même ordre', () => {
    const r = resume({
      gabarit: [{ id: 'a', type: 'rush' }, { id: 'b', type: 'stock' }],
      actives: { rushes: true, avatar: false, stock: true },
      rushesPerso: [RUSH],
      stock: [retenu(STOCK_V, 'video'), retenu(PHOTO, 'photo')],
      plan: { avatarDisponible: false, cible: 20, rythme: null, durees: { [RUSH]: 8 } },
    });
    const a = etapesMontageApercuAutopilote(r, { dureeCta: 4 });
    const complet = planCompletAutopilote(r, { cible: 20, rythme: null, durees: { [RUSH]: 8 } });
    const seg = segmentsChronologie(a.lignes, a.etapes);
    expect(seg.filter((x) => x.genre !== 'cta').map((x) => x.url)).toEqual(complet.segments.map((x) => x.url));
    expect(seg[seg.length - 1].genre).toBe('cta');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */

describe('Aperçu de l’avatar — sa vraie vidéo, jamais du stock à sa place', () => {
  const base = {
    gabarit: [{ id: 'a', type: 'avatar' as const }, { id: 'b', type: 'stock' as const }],
    actives: { rushes: true, avatar: true, stock: true },
    stock: [retenu(STOCK_V, 'video')],
    plan: { avatarDisponible: true, cible: 20, rythme: null, durees: {} },
  };

  it('prêt avec une vidéo déjà produite : les segments avatar la portent (« video-reelle »)', () => {
    const a = etapesMontageApercuAutopilote(resume({ ...base, avatar: { disponible: true, vignette: VIGNETTE_AVATAR, video: VIDEO_AVATAR } }), { dureeCta: 4 });
    const avatars = a.etapes.filter((e) => e.source === 'avatar');
    expect(avatars.length).toBeGreaterThan(0);
    expect(avatars.every((e) => e.url === VIDEO_AVATAR)).toBe(true);
    expect(a.avatar).toBe('video-reelle');
    const { container } = render(<ApercuMontageListe etapes={a.etapes} lignes={a.lignes} format="9:16" accent="#7C3AED" vignetteAvatar={VIGNETTE_AVATAR} />);
    const video = container.querySelector('[data-apercu-montage-avatar="video-reelle"]') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe(VIDEO_AVATAR);
    expect(container.querySelector('[data-apercu-montage-avatar-mention]')).toBeTruthy();
    // L'onglet « Vidéo » de l'exemple de style : la même vidéo réelle.
    const m = mediaApercuAutopilote(resume({ ...base, avatar: { disponible: true, vignette: VIGNETTE_AVATAR, video: VIDEO_AVATAR } }), { rushUrls: [] });
    expect(m).toMatchObject({ type: 'avatar', url: VIDEO_AVATAR, media: 'video' });
  });

  it('prêt sans vidéo : la vignette (« vignette ») — et elle est transmise au plan (n’est plus `null`)', () => {
    const a = etapesMontageApercuAutopilote(resume({ ...base, avatar: { disponible: true, vignette: VIGNETTE_AVATAR } }), { dureeCta: 4 });
    expect(a.avatar).toBe('vignette');
    expect(a.etapes.filter((e) => e.source === 'avatar').every((e) => e.url === null)).toBe(true);
  });

  it('rien de disponible : emplacement « Votre avatar apparaîtra ici », jamais un média stock', () => {
    const a = etapesMontageApercuAutopilote(resume({ ...base, avatar: { disponible: true, vignette: null } }), { dureeCta: 4 });
    expect(a.avatar).toBe('emplacement');
    for (const e of a.etapes.filter((x) => x.source === 'avatar')) expect(e.url).toBeNull();
    const { container } = render(<ApercuMontageListe etapes={a.etapes} lignes={a.lignes} format="9:16" accent="#7C3AED" vignetteAvatar={null} />);
    expect(container.querySelector('[data-apercu-montage-avatar-emplacement]')!.textContent).toContain('Votre avatar apparaîtra ici');
    expect(container.querySelector('[data-apercu-montage-video]')).toBeNull();
  });

  it('en lecture (avatarPret null) : aucun plan rempli de stock — un état de chargement', () => {
    const r = resume({ ...base, avatar: { disponible: false, vignette: null, chargement: true } });
    const a = etapesMontageApercuAutopilote(r, { dureeCta: 4 });
    expect(a).toEqual({ etapes: [], lignes: [], duree: 0, avatar: 'chargement' });
    const m = mediaApercuAutopilote(r, { rushUrls: [STOCK_V] });
    expect(m).toMatchObject({ type: 'avatar', url: null, chargement: true });
    // La fin de la lecture se remonte (signature différente).
    expect(signatureResume(r)).not.toBe(signatureResume(resume({ ...base, avatar: { disponible: true, vignette: null } })));
  });

  it('lireVideoAvatarReelle : aperçu prêt, sinon rendu récent ; autre avatar ou échec → null ; une seule lecture GET', async () => {
    const reponse = (data: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => ({ success: ok, data }) })) as unknown as typeof fetch;
    const pret = reponse({ avatarId: 'av1', apercu: { statut: 'pret', url: VIDEO_AVATAR }, renduRecent: { url: 'autre.mp4' } });
    expect(await lireVideoAvatarReelle(null, pret)).toBe(VIDEO_AVATAR);
    expect((pret as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('/api/avatar/apercu');
    expect(await lireVideoAvatarReelle('av1', reponse({ avatarId: 'av1', apercu: { statut: 'aucun' }, renduRecent: { url: 'recent.mp4' } }))).toBe('recent.mp4');
    expect(await lireVideoAvatarReelle('av2', reponse({ avatarId: 'av1', apercu: { statut: 'pret', url: VIDEO_AVATAR } }))).toBeNull();
    expect(await lireVideoAvatarReelle(null, reponse({ avatarId: 'av1', apercu: { statut: 'en_cours' }, renduRecent: null }))).toBeNull();
    expect(await lireVideoAvatarReelle(null, reponse(null, false))).toBeNull();
  });
});
