/**
 * PUBLICATION DIRECTE (hors Zernio) — elle suit le choix de l'utilisateur.
 *
 * Deux défauts corrigés ici, qui ne se voyaient que sur une VRAIE publication :
 *   - TikTok partait toujours en `SELF_ONLY`, donc en PRIVÉ, même quand l'utilisateur
 *     avait choisi « Public » (le chemin Zernio, lui, honorait son choix) ;
 *   - la description YouTube portait « Powered by Afroboost - afroboost.com », une marque
 *     étrangère ajoutée sous la vidéo d'un client de Studiio.
 *
 * Ce que ces tests NE prouvent PAS : l'acceptation par les API réelles de TikTok et YouTube.
 * Aucune requête ne sort : `fetch` est doublé et les corps envoyés sont inspectés.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { lireReglagesTiktok, validerTiktok, CONFIDENTIALITE_SECURITE } from '@/lib/social/couverture';

const SRC = readFileSync('src/app/api/cron/publish/route.ts', 'utf8');

/** Les réglages tels que l'écran les écrit dans la metadata du post. */
const reglages = (o: Partial<{ privacy_level: string; allow_comment: boolean; allow_duet: boolean; allow_stitch: boolean; consentement: boolean }> = {}) => ({
  tiktok: {
    privacy_level: 'PUBLIC_TO_EVERYONE', allow_comment: true, allow_duet: true, allow_stitch: true, consentement: true, ...o,
  },
});

/**
 * Rejoue la décision du chemin direct, telle qu'elle est écrite dans la route : mêmes
 * fonctions, mêmes règles. Le test de câblage ci-dessous garantit que la route les utilise.
 */
function corpsTiktok(meta: unknown) {
  const r = lireReglagesTiktok(meta);
  const consenti = validerTiktok(r).ok;
  return {
    privacy_level: consenti && r ? r.privacy_level : CONFIDENTIALITE_SECURITE,
    disable_duet: r ? !r.allow_duet : false,
    disable_comment: r ? !r.allow_comment : false,
    disable_stitch: r ? !r.allow_stitch : false,
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('TikTok : la confidentialité est celle que l’utilisateur a choisie', () => {
  it('« Public » choisi et consentement donné : la vidéo part en PUBLIC (plus jamais forcée en privé)', () => {
    expect(corpsTiktok(reglages()).privacy_level).toBe('PUBLIC_TO_EVERYONE');
  });

  it('chaque confidentialité proposée est transmise telle quelle', () => {
    for (const v of ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']) {
      expect(corpsTiktok(reglages({ privacy_level: v })).privacy_level).toBe(v);
    }
  });

  it('consentement NON donné : repli en privé — jamais une publication publique non demandée', () => {
    expect(corpsTiktok(reglages({ consentement: false })).privacy_level).toBe('SELF_ONLY');
  });

  it('réglages absents, vides ou invalides : repli en privé', () => {
    for (const meta of [undefined, null, {}, { tiktok: null }, { tiktok: { privacy_level: 'NIMPORTE' } }, { tiktok: { privacy_level: 'PUBLIC_TO_EVERYONE' } }]) {
      expect(corpsTiktok(meta).privacy_level).toBe('SELF_ONLY');
    }
    expect(CONFIDENTIALITE_SECURITE).toBe('SELF_ONLY');
  });

  it('commentaires, duos et collages suivent le choix de l’utilisateur (`disable_*` = inverse de `allow_*`)', () => {
    expect(corpsTiktok(reglages({ allow_comment: false, allow_duet: false, allow_stitch: false })))
      .toMatchObject({ disable_comment: true, disable_duet: true, disable_stitch: true });
    expect(corpsTiktok(reglages()))
      .toMatchObject({ disable_comment: false, disable_duet: false, disable_stitch: false });
  });

  it('sans réglages : les trois autorisations gardent le comportement d’avant (tout autorisé)', () => {
    expect(corpsTiktok(undefined)).toMatchObject({ disable_comment: false, disable_duet: false, disable_stitch: false });
  });
});

describe('câblage de la route', () => {
  it('TikTok : plus aucune confidentialité codée en dur ; la metadata du post est bien transmise', () => {
    expect(SRC).not.toMatch(/privacy_level:\s*'SELF_ONLY'/);
    expect(SRC).toContain('privacy_level: confidentialite');
    expect(SRC).toContain('const reglages = lireReglagesTiktok(meta);');
    expect(SRC).toContain('const consenti = validerTiktok(reglages).ok;');
    expect(SRC).toContain('publishToTikTok(authedAccount, videoData, post.caption, post.user_id, meta)');
  });

  it('YouTube : la description est celle de l’utilisateur, sans signature ajoutée ; publication publique conservée', () => {
    expect(SRC).toContain("description: caption || video.title || ''");
    expect(SRC).toContain("privacyStatus: 'public'");
  });

  it('aucune marque étrangère n’est ajoutée au CONTENU publié (titre, description, légende)', () => {
    // On n'inspecte que les lignes de CODE qui composent un champ envoyé aux réseaux :
    // le canal de diffusion `afroboost` et le désabonnement sont des fonctions légitimes
    // du produit et n'ont rien à voir avec une signature imposée.
    const champs = SRC.split('\n')
      .filter((l) => !l.trimStart().startsWith('//'))
      .filter((l) => /^\s*(description|title|caption|snippet|message):/.test(l));
    expect(champs.length).toBeGreaterThan(2);
    expect(champs.filter((l) => /powered by|afroboost|boosttribe|studiio\.pro/i.test(l))).toEqual([]);
  });

  it('le canal de diffusion afroboost, lui, reste intact (ce n’est pas une signature)', () => {
    expect(SRC).toContain("const NO_ACCOUNT_CHANNELS = ['email', 'whatsapp', 'afroboost.com', 'afroboost']");
  });
});
