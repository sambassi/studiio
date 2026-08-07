import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  sanitizeConfig, pickRush, sanitizeHexColor, sanitizeVolume,
  DEFAULT_CONFIG, DEFAULT_BRANDING, DEFAULT_VOLUMES,
  type AutopilotConfig,
} from '@/lib/autopilot/rules';
import { buildAutopilotDesign, buildAutopilotMetadata } from '@/lib/autopilot/design';
import { elevenLabsVoiceId } from '@/lib/autopilot/voice';
import { backgroundFor, type CreerSimpleMontageProps } from '../../remotion/CreerSimpleMontage';
import { mixAt } from '../../remotion/audio';
import { DEFAULT_COLORS } from '@/lib/creer/designSpec';
import type { PreparedPost } from '@/lib/autopilot/engine';

/**
 * Autopilote — ce qui VARIE et ce qui NE VARIE PAS.
 *
 * La promesse produit est en deux moitiés, et c'est la seule chose que ces
 * tests vérifient vraiment :
 *
 *   VARIE d'une vidéo à l'autre — l'affiche, les textes, le rush.
 *   NE VARIE JAMAIS — les couleurs, le fond des cartes, la musique, la voix
 *   clonée, le son du rush et les trois niveaux du mixeur.
 *
 * ⚠️ CES TESTS APPELLENT LE CODE, ILS NE LE LISENT PAS. Le dépôt a déjà payé
 * le prix des assertions sur le texte source (cf. `tasks/lessons.md`,
 * 2026-07-30) : elles cassent au premier retour à la ligne et ne cassent
 * jamais quand le produit est réellement abîmé. Les seules lectures de
 * fichier ici portent sur la MIGRATION, qui n'est pas du code exécutable.
 */

const migration = readFileSync(
  resolve(__dirname, '../../migrations/2026-08-07-autopilot-branding.sql'),
  'utf-8',
);

const POST: PreparedPost = {
  title: 'sommeil',
  caption: 'peu importe',
  scheduledDate: '2026-08-08',
  scheduledTime: '18:00',
  platforms: [],
  rushUrl: 'https://exemple.test/rush-a.mp4',
  content: {
    subtitle: 'Un sous-titre',
    tagLine: 'Un CTA',
    cards: [{ icon: 'Moon', title: 'Carte', description: 'Description', value: '8h' }],
  } as PreparedPost['content'],
};

/** Une configuration complète, sur laquelle chaque réglage est distinct du défaut. */
function config(patch: Partial<AutopilotConfig> = {}): AutopilotConfig {
  return sanitizeConfig({ ...DEFAULT_CONFIG, ...patch });
}

// ─────────────────────────────────────────────────────────────────────────
describe('A — les défauts, et ce qu ils changent volontairement', () => {
  it('les cartes ne sont PAS sur la photo par défaut', () => {
    // La demande explicite : les cartes se lisent mal sur une affiche.
    expect(DEFAULT_CONFIG.cardsShowPoster).toBe(false);
  });

  it('le son du rush est coupé par défaut', () => {
    // Musique + voix off suffisent ; l'ambiance du rush ferait une troisième
    // piste que personne n'a demandée.
    expect(DEFAULT_CONFIG.keepRushAudio).toBe(false);
  });

  it('les couleurs par défaut sont EXACTEMENT celles jusqu ici en dur', () => {
    // ⚠️ SANS CETTE ÉGALITÉ, LA MIGRATION EST UNE RÉGRESSION VISUELLE. Les
    // comptes existants n'ont jamais choisi de couleurs : ils héritent des
    // défauts, qui doivent donc reproduire `DEFAULT_COLORS` au caractère près.
    expect(DEFAULT_CONFIG.cardGradientStart).toBe(DEFAULT_COLORS.gradientStart);
    expect(DEFAULT_CONFIG.cardGradientEnd).toBe(DEFAULT_COLORS.gradientEnd);
    expect(DEFAULT_CONFIG.titleColor).toBe(DEFAULT_COLORS.title);
  });

  it('la migration pose les MÊMES défauts que le code', () => {
    // Deux sources de vérité pour un même défaut finissent par diverger, et
    // l'écart ne se verrait que sur un compte créé après la migration.
    expect(migration).toContain(`default '${DEFAULT_BRANDING.cardGradientStart}'`);
    expect(migration).toContain(`default '${DEFAULT_BRANDING.cardGradientEnd}'`);
    expect(migration).toContain(`default '${DEFAULT_BRANDING.titleColor}'`);
    expect(migration).toMatch(/cards_show_poster\s+boolean not null default false/);
    expect(migration).toMatch(/keep_rush_audio\s+boolean not null default false/);
    expect(migration).toMatch(/music_volume\s+real\s+not null default 0\.8/);
    expect(migration).toMatch(/voice_volume\s+real\s+not null default 1\.0/);
    expect(migration).toMatch(/rush_volume\s+real\s+not null default 0\.5/);
  });

  it('la migration n oublie ni le grant ni le rechargement de PostgREST', () => {
    // Les deux étapes de CLAUDE.md, sans lesquelles la colonne existe en base
    // et reste invisible à l'application.
    expect(migration).toContain('grant all on table public.autopilot_config to public;');
    expect(migration).toContain('docker kill -s SIGUSR1 studiio-postgrest');
  });

  it('elle n ajoute que des colonnes — aucune table touchée autrement', () => {
    expect(migration).toContain('add column if not exists');
    expect(migration).not.toMatch(/drop\s+(table|column)/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B — sanitizeConfig ne laisse pas passer de valeur toxique', () => {
  it('une couleur illisible retombe sur son défaut', () => {
    // Un `linear-gradient` invalide fait tomber le fond en noir, sans erreur.
    expect(sanitizeHexColor('rouge', '#7C3AED')).toBe('#7C3AED');
    expect(sanitizeHexColor('#GGG', '#7C3AED')).toBe('#7C3AED');
    expect(sanitizeHexColor(null, '#7C3AED')).toBe('#7C3AED');
    expect(sanitizeHexColor('  #abc  ', '#7C3AED')).toBe('#abc');
    expect(sanitizeHexColor('#A1B2C3', '#7C3AED')).toBe('#A1B2C3');
  });

  it('les niveaux du mixeur sont bornés à 0–1', () => {
    // Au-dessus de 1 le montage sature ; en dessous de 0 la phase s'inverse.
    expect(sanitizeVolume(40, 0.8)).toBe(1);
    expect(sanitizeVolume(-3, 0.8)).toBe(0);
    expect(sanitizeVolume(0.35, 0.8)).toBe(0.35);
    expect(sanitizeVolume('bruit', 0.8)).toBe(0.8);
    expect(sanitizeVolume(undefined, 0.8)).toBe(0.8);
    // Zéro est un réglage LÉGITIME — le confondre avec « absent » rendrait
    // impossible de couper une piste depuis le mixeur.
    expect(sanitizeVolume(0, 0.8)).toBe(0);
  });

  it('les trois niveaux d une config relue sont tous bornés', () => {
    const c = sanitizeConfig({ musicVolume: 12, voiceVolume: -1, rushVolume: 0.42 });
    expect(c.musicVolume).toBe(1);
    expect(c.voiceVolume).toBe(0);
    expect(c.rushVolume).toBe(0.42);
  });

  it('une colonne ABSENTE vaut le défaut sûr, jamais un accident', () => {
    // Tant que la migration n'est pas appliquée, PostgREST rend `undefined` :
    // le résultat doit être le comportement voulu, pas une valeur au hasard.
    const c = sanitizeConfig({});
    expect(c.cardsShowPoster).toBe(false);
    expect(c.keepRushAudio).toBe(false);
    expect(c.musicUrl).toBeNull();
    expect(c.voiceId).toBeNull();
    expect(c.musicVolume).toBe(DEFAULT_VOLUMES.music);
  });

  it('la musique doit être une adresse http(s)', () => {
    expect(sanitizeConfig({ musicUrl: 'javascript:alert(1)' }).musicUrl).toBeNull();
    expect(sanitizeConfig({ musicUrl: '' }).musicUrl).toBeNull();
    expect(sanitizeConfig({ musicUrl: 'https://x.test/a.mp3' }).musicUrl).toBe('https://x.test/a.mp3');
  });

  it('sanitizeConfig est IDEMPOTENT sur les nouveaux champs', () => {
    // L'écran ré-assainit ce que le serveur lui rend : une deuxième passe qui
    // change la valeur ferait osciller le formulaire à chaque enregistrement.
    const une = config({ cardGradientStart: '#123456', musicVolume: 0.3, cardsShowPoster: true });
    expect(sanitizeConfig(une)).toEqual(une);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('C — le design hérite de l identité, et d elle seule', () => {
  it('les couleurs du compte remplacent celles du dépôt', () => {
    const design = buildAutopilotDesign(POST, {
      config: config({
        cardGradientStart: '#101010',
        cardGradientEnd: '#202020',
        titleColor: '#303030',
      }),
    });
    expect(design.gradientStart).toBe('#101010');
    expect(design.gradientEnd).toBe('#202020');
    expect(design.titleColor).toBe('#303030');
  });

  it('SANS config, le montage sort exactement comme avant', () => {
    // Rétro-compatibilité : un appelant qui ne passe rien doit obtenir le
    // montage d'avant la fonctionnalité.
    const design = buildAutopilotDesign(POST, { posterUrl: 'https://x.test/p.jpg' });
    expect(design.gradientStart).toBe(DEFAULT_COLORS.gradientStart);
    expect(design.gradientEnd).toBe(DEFAULT_COLORS.gradientEnd);
    expect(design.titleColor).toBe(DEFAULT_COLORS.title);
    expect(design.musicUrl).toBeNull();
  });

  it('la musique et les trois niveaux sont propagés', () => {
    const design = buildAutopilotDesign(POST, {
      config: config({
        musicUrl: 'https://x.test/fond.mp3',
        musicVolume: 0.4, voiceVolume: 0.9, rushVolume: 0.25,
      }),
    });
    expect(design.musicUrl).toBe('https://x.test/fond.mp3');
    expect(design.musicVolume).toBe(0.4);
    expect(design.voiceVolume).toBe(0.9);
    expect(design.rushVolume).toBe(0.25);
  });

  it('« garder le son du rush » pilote la coupure, pas le niveau', () => {
    // ⚠️ LE NIVEAU SURVIT À LA COUPURE. Le mettre à zéro au lieu de couper
    // ferait perdre le réglage : rallumer le son rendrait une piste muette.
    const coupe = buildAutopilotDesign(POST, {
      config: config({ keepRushAudio: false, rushVolume: 0.6 }),
    });
    expect(coupe.rushMuted).toBe(true);
    expect(coupe.rushVolume).toBe(0.6);

    const garde = buildAutopilotDesign(POST, {
      config: config({ keepRushAudio: true, rushVolume: 0.6 }),
    });
    expect(garde.rushMuted).toBe(false);
    expect(garde.rushVolume).toBe(0.6);
  });

  it('les cartes SANS photo : l affiche reste sur l intro', () => {
    const design = buildAutopilotDesign(POST, {
      posterUrl: 'https://x.test/affiche.jpg',
      config: config({ cardsShowPoster: false }),
    });
    // L'affiche est TOUJOURS transmise — c'est sa PORTÉE qui change.
    expect(design.posterUrl).toBe('https://x.test/affiche.jpg');
    expect(design.posterOnAllSequences).toBe(false);
  });

  it('les cartes AVEC photo : l affiche couvre tout', () => {
    const design = buildAutopilotDesign(POST, {
      posterUrl: 'https://x.test/affiche.jpg',
      config: config({ cardsShowPoster: true }),
    });
    expect(design.posterOnAllSequences).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('D — le rendu applique réellement la portée de l affiche', () => {
  const props = (patch: Partial<CreerSimpleMontageProps>): CreerSimpleMontageProps => ({
    title: 'T', cards: [],
    introDuration: 4, cardsDuration: 6, videoDuration: 0, ctaDuration: 4,
    posterUrl: 'https://x.test/affiche.jpg',
    ...patch,
  });

  it('ABSENT = partout : les montages déjà enregistrés ne bougent pas', () => {
    // Le champ n'existait pas ; aucun design en base ne le porte.
    const p = props({});
    for (const seq of ['intro', 'cards', 'video', 'cta']) {
      expect(backgroundFor(p, seq)).toBe('https://x.test/affiche.jpg');
    }
  });

  it('à FAUX, seule l intro garde l affiche', () => {
    const p = props({ posterOnAllSequences: false });
    expect(backgroundFor(p, 'intro')).toBe('https://x.test/affiche.jpg');
    expect(backgroundFor(p, 'cards')).toBeNull();
    expect(backgroundFor(p, 'cta')).toBeNull();
    expect(backgroundFor(p, 'video')).toBeNull();
  });

  it('un fond PROPRE à une séquence l emporte, même quand l affiche est restreinte', () => {
    // C'est un choix explicite de l'utilisateur : un drapeau de portée n'a
    // pas à le défaire.
    const p = props({
      posterOnAllSequences: false,
      sequenceBackgrounds: { cartes: 'https://x.test/fond-cartes.jpg' },
    });
    expect(backgroundFor(p, 'cards')).toBe('https://x.test/fond-cartes.jpg');
  });

  it('sans affiche du tout, il n y a rien à peindre — le dégradé prend la place', () => {
    const p = props({ posterUrl: null, posterOnAllSequences: false });
    expect(backgroundFor(p, 'intro')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('E — le mixeur du rendu honore les trois niveaux', () => {
  it('un niveau de rush explicite remplace le défaut', () => {
    const m = mixAt(0, { rushVolume: 0.25, hasVoice: false, hasMixAudio: true });
    expect(m.rush).toBe(0.25);
  });

  it('ABSENT = le défaut du compositeur, pas le silence', () => {
    // ⚠️ SI L'ABSENCE VALAIT ZÉRO, tous les montages manuels — qui ne
    // transmettent rien ici — seraient sortis muets sur leur séquence vidéo.
    expect(mixAt(0, { hasVoice: false, hasMixAudio: false }).rush).toBe(1);
    expect(mixAt(0, { hasVoice: false, hasMixAudio: true }).rush).toBe(0.5);
  });

  it('zéro est un niveau, pas une absence', () => {
    expect(mixAt(0, { rushVolume: 0, hasVoice: false, hasMixAudio: false }).rush).toBe(0);
  });

  it('les atténuations posées à la main gardent la priorité', () => {
    // Les images-clés REMPLACENT le volume statique — c'est déjà la règle du
    // compositeur, et le nouveau champ ne doit pas la renverser.
    const m = mixAt(1, {
      rushVolume: 0.9,
      hasVoice: false,
      hasMixAudio: true,
      keyframes: [{ id: 'k1', time: 0, musicVolume: 1, voiceVolume: 1, rushVolume: 0.1 }],
    });
    expect(m.rush).toBe(0.1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('F — la voix clonée', () => {
  it('l identifiant préfixé est dépréfixé avant l appel au fournisseur', () => {
    // ⚠️ ENVOYÉ PRÉFIXÉ, ELEVENLABS REND UN 404 — donc un montage muet, sans
    // que rien n'explique pourquoi.
    expect(elevenLabsVoiceId('elevenlabs-ABC123')).toBe('ABC123');
  });

  it('un identifiant nu passe tel quel', () => {
    expect(elevenLabsVoiceId('ABC123')).toBe('ABC123');
  });

  it('sans choix, la voix du serveur — jamais une chaîne vide', () => {
    expect(elevenLabsVoiceId(null)).toBeTruthy();
    expect(elevenLabsVoiceId('   ')).toBeTruthy();
    expect(elevenLabsVoiceId(undefined)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('G — la rotation des rushes', () => {
  const A = 'https://x.test/a.mp4';
  const B = 'https://x.test/b.mp4';
  const C = 'https://x.test/c.mp4';

  it('deux montages d un même cycle ne partagent pas le rush', () => {
    const cycle = [0, 1].map((i) => pickRush([A, B], null, i));
    expect(new Set(cycle).size).toBe(2);
  });

  it('deux cycles successifs ne repartent pas sur le même rush', () => {
    // Cycle de 1 : le dernier utilisé est évité au passage suivant.
    const premier = pickRush([A, B], null, 0);
    const second = pickRush([A, B], premier, 0);
    expect(second).not.toBe(premier);
    expect(pickRush([A, B], second, 0)).toBe(premier);
  });

  it('sur trois rushes, un cycle de trois les épuise tous', () => {
    const cycle = [0, 1, 2].map((i) => pickRush([A, B, C], null, i));
    expect(new Set(cycle).size).toBe(3);
  });

  it('un cycle plus long que la banque boucle sans jamais doubler DEUX VOISINS', () => {
    const cycle = [0, 1, 2, 3, 4].map((i) => pickRush([A, B], null, i));
    for (let i = 1; i < cycle.length; i += 1) {
      expect(cycle[i]).not.toBe(cycle[i - 1]);
    }
  });

  it('une banque avec DOUBLONS ne rend pas deux fois le même fichier', () => {
    // ⚠️ SANS DÉDOUBLONNAGE, l'utilisateur voit « deux rushes » et reçoit
    // deux fois la même vidéo, sans qu'aucune erreur ne le signale.
    const cycle = [0, 1].map((i) => pickRush([A, A, B], null, i));
    expect(new Set(cycle).size).toBe(2);
  });

  it('un seul rush est forcément répété — la limite est assumée', () => {
    expect(pickRush([A], null, 0)).toBe(A);
    expect(pickRush([A], A, 1)).toBe(A);
  });

  it('un dernier rush RETIRÉ de la banque ne bloque pas la rotation', () => {
    // `indexOf` rend -1 : on repart du premier plutôt que de rendre `undefined`.
    expect(pickRush([A, B], 'https://x.test/disparu.mp4', 0)).toBe(A);
  });

  it('une banque vide ne rend rien, sans lever', () => {
    expect(pickRush([], null, 0)).toBeNull();
    expect(pickRush(['', null as unknown as string], null, 0)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('H — les métadonnées disent la vérité sur le montage produit', () => {
  const meta = (c: AutopilotConfig, posterUrl: string | null = null) => buildAutopilotMetadata({
    post: POST,
    design: buildAutopilotDesign(POST, { posterUrl, config: c }),
    videoUrl: 'https://x.test/montage.mp4',
    thumbnailUrl: 'https://x.test/vignette.jpg',
    mode: 'review',
  });

  it('« hasAudio » suit la réalité, il n est plus écrit faux en dur', () => {
    // ⚠️ AVEC UNE MUSIQUE, ANNONCER UNE VIDÉO MUETTE fait proposer par le
    // Calendrier de corriger un défaut qui n'existe pas.
    expect(meta(config({ musicUrl: 'https://x.test/f.mp3' })).hasAudio).toBe(true);
  });

  it('sans musique, sans voix et rush coupé, la vidéo EST muette', () => {
    expect(meta(config({ keepRushAudio: false })).hasAudio).toBe(false);
  });

  it('le son du rush gardé suffit à faire une vidéo sonore', () => {
    expect(meta(config({ keepRushAudio: true })).hasAudio).toBe(true);
  });

  it('la couleur d accent est celle du COMPTE, pas celle du dépôt', () => {
    const m = meta(config({ cardGradientStart: '#0F0F0F' }));
    expect((m.branding as Record<string, unknown>).accentColor).toBe('#0F0F0F');
  });

  it('une régénération retrouve tout ce qui fait l identité', () => {
    // ⚠️ SANS CES CHAMPS, un clic sur « Régénérer » dans le Calendrier
    // remettrait la photo derrière les cartes et rallumerait le son du rush.
    const d = meta(config({
      cardsShowPoster: false,
      musicUrl: 'https://x.test/f.mp3',
      musicVolume: 0.4, voiceVolume: 0.7, rushVolume: 0.3,
      keepRushAudio: false,
    })).design as Record<string, unknown>;
    expect(d.posterOnAllSequences).toBe(false);
    expect(d.musicUrl).toBe('https://x.test/f.mp3');
    expect(d.audioMusicVolume).toBe(0.4);
    expect(d.audioVoiceVolume).toBe(0.7);
    // Le son coupé se relit comme un niveau nul : le design regénéré doit
    // rester muet même si personne ne relit `keepRushAudio`.
    expect(d.audioRushVolume).toBe(0);
  });
});
