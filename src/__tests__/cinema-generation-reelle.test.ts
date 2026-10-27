// @vitest-environment node
//
// ⚠️ NÉCESSAIRE pour les tests ajoutés plus bas qui LISENT un vrai fichier (`writeFileSync` +
// `readFile`) et attendent que `detecterSignatureImage` le reconnaisse : sous l'environnement
// `jsdom` (par défaut, `vitest.config.ts`), le `Uint8Array` global diffère de celui du `Buffer`
// natif de Node, et `bytes instanceof Uint8Array` y est TOUJOURS faux pour un fichier lu sur
// disque — quel que soit son contenu réel. `src/__tests__/ai-generate-bg-route.test.ts` évite
// ce piège en ne construisant que des `Uint8Array` en mémoire ; ici, l'intégration réelle de
// `genererVideo` avec un fichier sur disque est précisément ce qu'on veut éprouver.
/**
 * CINEMA IA — GÉNÉRATION RÉELLE (Replicate) : branchée, éteinte, et jamais appelée par erreur.
 *
 * Ce fournisseur DÉPENSE de l'argent réel. Ces tests prouvent qu'il ne s'allume qu'avec une
 * décision explicite ET un jeton, que c'est le SERVEUR qui le choisit (jamais le navigateur),
 * et que ses tarifs viennent d'une page officielle datée.
 *
 * ⚠️ AUCUN APPEL SORTANT ICI : aucun test ne met `CINEMA_GENERATION_REELLE` à `true` avec un
 * vrai jeton pour ensuite générer. On n'éprouve que la DÉCISION, jamais la dépense.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  generationReelleActive, FOURNISSEUR_REPLICATE_IMAGE, FOURNISSEUR_REPLICATE_VIDEO,
  MODELE_IMAGE, MODELE_VIDEO, ID_REPLICATE_IMAGE, ID_REPLICATE_VIDEO, DUREE_VIDEO_MAX_S,
} from '@/lib/cinema/generation/replicate';
import { fournisseurServeur, modeGenerationAffiche, compteAutoriseADepenser } from '@/lib/cinema/garde';
import { tarifGeneration, CATALOGUE_GENERATION } from '@/lib/cinema/generation/couts';

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const src = (p: string) => readFileSync(p, 'utf8');
const ENV0 = { ...process.env };
afterEach(() => { process.env = { ...ENV0 }; });

describe('la génération réelle exige DEUX conditions', () => {
  it('rien, décision seule, ou jeton seul : ÉTEINTE', () => {
    expect(generationReelleActive(env({}))).toBe(false);
    expect(generationReelleActive(env({ CINEMA_GENERATION_REELLE: 'true' }))).toBe(false); // pas de jeton
    expect(generationReelleActive(env({ REPLICATE_API_TOKEN: 'r8_x' }))).toBe(false); // pas de décision
  });

  it('décision explicite + jeton : allumée', () => {
    for (const d of ['true', 'TRUE', ' true ', '1']) {
      expect(generationReelleActive(env({ CINEMA_GENERATION_REELLE: d, REPLICATE_API_TOKEN: 'r8_x' }))).toBe(true);
    }
  });

  it('une décision approchante ne suffit pas', () => {
    for (const d of ['false', '0', 'oui', 'on', 'yes', '']) {
      expect(generationReelleActive(env({ CINEMA_GENERATION_REELLE: d, REPLICATE_API_TOKEN: 'r8_x' }))).toBe(false);
    }
  });

  it('un jeton vide ou blanc ne compte pas', () => {
    for (const t of ['', '   ']) {
      expect(generationReelleActive(env({ CINEMA_GENERATION_REELLE: 'true', REPLICATE_API_TOKEN: t }))).toBe(false);
    }
  });

  it('les deux fournisseurs se déclarent inactifs par défaut, et relisent l’interrupteur à chaque usage', () => {
    delete process.env.CINEMA_GENERATION_REELLE;
    expect(FOURNISSEUR_REPLICATE_IMAGE.actif).toBe(false);
    expect(FOURNISSEUR_REPLICATE_VIDEO.actif).toBe(false);
    process.env.CINEMA_GENERATION_REELLE = 'true';
    process.env.REPLICATE_API_TOKEN = 'r8_test';
    expect(FOURNISSEUR_REPLICATE_IMAGE.actif).toBe(true);
    process.env.CINEMA_GENERATION_REELLE = 'false';
    expect(FOURNISSEUR_REPLICATE_IMAGE.actif).toBe(false);
  });

  it('chaque fournisseur refuse l’opération qui n’est pas la sienne, sans appeler personne', async () => {
    expect(await FOURNISSEUR_REPLICATE_IMAGE.genererVideo({ fichierImageSource: '/x', prompt: 'x', dureeS: 3, format: '9:16', graine: 1 }))
      .toMatchObject({ ok: false });
    expect(await FOURNISSEUR_REPLICATE_VIDEO.genererImage({ promptPlan: 'x', promptConstruit: 'x', personnages: [], format: '9:16', graine: 1 }))
      .toMatchObject({ ok: false });
  });
});

const U = 'compte-autorise';
const AUTRE = 'compte-ordinaire';
/** Tout est allumé ET le compte `U` est autorisé à dépenser. */
const REELLE = { CINEMA_GENERATION_REELLE: 'true', REPLICATE_API_TOKEN: 'r8_x', CINEMA_GENERATION_REELLE_COMPTES: U };
/** Rien ne restreint : les credits decident (le cas normal). */
const REELLE_OUVERTE = { CINEMA_GENERATION_REELLE: 'true', REPLICATE_API_TOKEN: 'r8_x' };

describe('qui peut dépenser : les crédits décident, la liste ne fait que restreindre', () => {
  it('liste ABSENTE : tout compte authentifié — ce sont les crédits qui autorisent', () => {
    expect(compteAutoriseADepenser(U, env({}))).toBe(true);
    expect(compteAutoriseADepenser(AUTRE, env({}))).toBe(true);
    // Sans identifiant, rien n'est jamais autorisé.
    expect(compteAutoriseADepenser(null, env({}))).toBe(false);
    expect(compteAutoriseADepenser('', env({}))).toBe(false);
  });

  it('liste DÉFINIE : restriction volontaire, comparaison exacte', () => {
    const e = env({ CINEMA_GENERATION_REELLE_COMPTES: ` ${U} , autre ` });
    expect(compteAutoriseADepenser(U, e)).toBe(true);
    expect(compteAutoriseADepenser('autre', e)).toBe(true);
    for (const v of [AUTRE, U.toUpperCase(), `${U}x`]) {
      expect(compteAutoriseADepenser(v, e)).toBe(false);
    }
  });

  it('définie mais VIDE : personne (fermeture explicite, jamais « tout le monde » par erreur)', () => {
    for (const l of ['', '   ', ',', ' , ,']) {
      expect(compteAutoriseADepenser(U, env({ CINEMA_GENERATION_REELLE_COMPTES: l }))).toBe(false);
    }
  });

  it('la liste peut fermer la dépense même quand tout le reste est allumé', () => {
    const e = env({ CINEMA_GENERATION_REELLE: 'true', REPLICATE_API_TOKEN: 'r8_x', CINEMA_GENERATION_REELLE_COMPTES: '' });
    expect(generationReelleActive(e)).toBe(true); // le fournisseur est prêt…
    expect(fournisseurServeur('image', U, e)).toBeNull(); // …mais personne n'y accède
  });
});

describe('c’est le SERVEUR qui choisit le fournisseur', () => {
  it('aucune génération autorisée : aucun fournisseur, aucun mode annoncé', () => {
    expect(fournisseurServeur('image', U, env({}))).toBeNull();
    expect(modeGenerationAffiche(U, env({}))).toBeNull();
  });

  it('simulée seule : le fournisseur simulé, annoncé comme SIMULÉ', () => {
    const e = env({ CINEMA_GENERATION_SIMULEE: 'true' });
    expect(fournisseurServeur('image', U, e)).toEqual({ id: 'simule', mode: 'simulee' });
    expect(modeGenerationAffiche(U, e)).toBe('simulee');
  });

  it('réelle autorisée POUR CE COMPTE : elle PRIME, et l’opération décide du modèle', () => {
    const e = env({ ...REELLE, CINEMA_GENERATION_SIMULEE: 'true' });
    expect(fournisseurServeur('image', U, e)).toEqual({ id: ID_REPLICATE_IMAGE, mode: 'reelle' });
    expect(fournisseurServeur('video', U, e)).toEqual({ id: ID_REPLICATE_VIDEO, mode: 'reelle' });
    expect(modeGenerationAffiche(U, e)).toBe('reelle');
  });

  it('un compte hors de la liste restrictive retombe sur le simulé, jamais sur le payant', () => {
    const e = env({ ...REELLE, CINEMA_GENERATION_SIMULEE: 'true' });
    expect(fournisseurServeur('image', AUTRE, e)).toEqual({ id: 'simule', mode: 'simulee' });
    // Et si le simulé est éteint aussi : rien du tout.
    expect(fournisseurServeur('image', AUTRE, env(REELLE))).toBeNull();
  });

  it('sans liste : tout compte atteint la génération réelle, et ce sont ses crédits qui la paient', () => {
    expect(fournisseurServeur('image', AUTRE, env(REELLE_OUVERTE))).toEqual({ id: ID_REPLICATE_IMAGE, mode: 'reelle' });
    expect(modeGenerationAffiche(AUTRE, env(REELLE_OUVERTE))).toBe('reelle');
  });

  it('la route IGNORE tout fournisseur envoyé par le navigateur, et refuse proprement s’il n’y en a aucun', () => {
    const r = src('src/app/api/cinema/films/[id]/generation/route.ts');
    expect(r).not.toMatch(/corps\?\.fournisseurId/);
    expect(r).toContain("const choix = fournisseurServeur(operation as 'image' | 'video', s.userId);");
    expect(r).toContain('fournisseurId: choix.id');
    expect(r).toContain('status: 409');
    // Le choix précède tout travail : réservation de la génération, puis exécution.
    expect(r.indexOf('const choix = fournisseurServeur')).toBeLessThan(r.indexOf('reserverGeneration('));
    expect(r.indexOf('reserverGeneration(')).toBeLessThan(r.indexOf('lancerGeneration('));
  });

  it('l’écran n’envoie plus de fournisseur et dit la vérité sur ce qu’il déclenche', () => {
    const p = src('src/app/dashboard/cinema/page.tsx');
    expect(p).not.toContain("fournisseurId: 'simule'");
    expect(p).toContain("JSON.stringify({ planId, operation })");
    expect(p).toContain("generationMode === 'simulee' ? 'Generer (IA, simule)' : 'Generer l’image (IA)'");
  });
});

describe('les tarifs viennent d’une page officielle, avec sa date', () => {
  it('image : 0,003 $, source officielle citée et datée', () => {
    const t = tarifGeneration(ID_REPLICATE_IMAGE, 'image');
    expect(t).not.toBeNull();
    expect(t!.usdParUnite).toBe(0.003);
    expect(t!.actif).toBe(true);
    expect(t!.source).toContain('replicate.com/pricing');
    expect(t!.source).toMatch(/2026-10-27/);
  });

  it('vidéo : tarifée au PIRE cas (5 s à 0,09 $), jamais sous-estimée', () => {
    const t = tarifGeneration(ID_REPLICATE_VIDEO, 'video');
    expect(t!.usdParUnite).toBe(0.45);
    expect(DUREE_VIDEO_MAX_S * 0.09).toBeCloseTo(t!.usdParUnite!, 5);
    expect(t!.source).toContain('replicate.com/pricing');
  });

  it('les modèles branchés sont EXACTEMENT ceux dont le prix a été lu', () => {
    expect(MODELE_IMAGE).toBe('black-forest-labs/flux-schnell');
    // `wan-2.2-i2v-fast` n'est pas tarifé sur la page officielle : il n'est donc pas branché
    // (le fichier l'explique en commentaire, mais ne l'appelle jamais).
    expect(MODELE_VIDEO).toBe('wavespeedai/wan-2.1-i2v-480p');
    const code = src('src/lib/cinema/generation/replicate.ts')
      .split('\n').filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//')).join('\n');
    expect(code).not.toContain('wan-2.2-i2v-fast');
  });

  it('aucun tarif de ce catalogue n’est actif sans prix vérifié', () => {
    for (const t of CATALOGUE_GENERATION) {
      if (t.actif) expect(t.usdParUnite, `${t.fournisseurId}/${t.operation}`).not.toBeNull();
    }
  });
});

describe('une dépense engagée est TOUJOURS comptée, même quand l’appel échoue', () => {
  it('l’atelier rend `depenseUsd` sur chaque échec survenu APRÈS l’appel au fournisseur', () => {
    const a = src('src/lib/cinema/generation/atelier.ts');
    // Les quatre échecs possibles après l'appel : image, vidéo, fichier illisible, import refusé.
    expect(a.match(/depenseUsd: devis\.totalUsd \?\? 0/g)?.length).toBe(4);
    // Et le refus de plafond, lui, n'engage rien : il est AVANT l'appel.
    expect(a.indexOf('if (!verification.autorise)')).toBeLessThan(a.indexOf('fournisseur.genererImage'));
  });

  it('l’exécuteur l’enregistre sur le film, en échec comme en succès — sinon le plafond ne serait jamais atteint', () => {
    const x = src('src/lib/cinema/generation/executeur-generation.ts');
    expect(x).toContain("const engageUsd = ('depenseUsd' in resultat ? resultat.depenseUsd : 0) ?? 0;");
    expect(x).toContain('coutGenerationUsd: engageUsd > 0 ? arrondi((f.coutGenerationUsd ?? 0) + engageUsd) : f.coutGenerationUsd,');
    expect(x).toContain('coutGenerationUsd: arrondi((f.coutGenerationUsd ?? 0) + depense),');
  });
});

/**
 * RÉGRESSION — le modèle image-vers-video (wavespeedai/wan-2.1-i2v-480p) exige `prompt`
 * ET `image`, et REFUSE `num_frames` (422), contrairement à la variante 720p qui l'accepte.
 * Avant ce correctif, l'appel réel échouait systématiquement : aucune vidéo Cinema IA n'a
 * jamais pu être produite en mode réel, et les crédits déjà pris (lot 2) n'étaient jamais
 * rendus (voir la description ci-dessous).
 */
describe('le modèle vidéo exige prompt + image, jamais num_frames', () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('le code n’envoie plus `num_frames` au fournisseur vidéo', () => {
    // Hors commentaires : le mot peut légitimement apparaître pour EXPLIQUER pourquoi il
    // n'est plus envoyé, mais jamais comme champ réellement construit dans l'appel.
    const code = src('src/lib/cinema/generation/replicate.ts')
      .split('\n').filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//')).join('\n');
    expect(code).not.toContain('num_frames');
  });

  it('le code envoie `prompt` dans l’appel MODELE_VIDEO', () => {
    const code = src('src/lib/cinema/generation/replicate.ts');
    const bloc = code.slice(code.indexOf('async function genererVideo'), code.indexOf('async function genererVideo') + 2200);
    expect(bloc).toMatch(/appeler\(MODELE_VIDEO,\s*\{\s*image,\s*prompt:\s*demande\.prompt/);
  });

  it('un prompt vide est refusé AVANT tout appel réseau (image lisible, mais aucun jeton nécessaire)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'studiio-replicate-video-'));
    const image = join(dir, 'source.png');
    writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); // en-tête PNG minimal, suffisant pour etre lu en base64
    delete process.env.REPLICATE_API_TOKEN; // si un vrai appel partait, il échouerait ici — la preuve qu'il ne part pas
    const r = await FOURNISSEUR_REPLICATE_VIDEO.genererVideo({
      fichierImageSource: image, prompt: '   ', dureeS: 3, format: '9:16', graine: 1,
    });
    expect(r).toMatchObject({ ok: false });
    expect((r as { erreur: string }).erreur).toContain('prompt manquant');
  });

  it('l’atelier construit le prompt vidéo depuis `plan.description`, comme pour l’image', () => {
    const a = src('src/lib/cinema/generation/atelier.ts');
    expect(a).toContain("construirePromptImage(plan.description, { mode: 'texte' })");
    expect(a).toMatch(/fournisseur\.genererVideo\(\{[^}]*prompt:\s*promptVideo/s);
  });
});

/**
 * RÉGRESSION — le plafond de dépense par compte (lib/cinema/generation/plafond-compte.ts)
 * dépend d'une distinction FIABLE entre « rien n'est parti » (`jamaisEnvoye`, la réservation
 * peut être libérée) et « le délai a expiré » (`incertain`, on NE SAIT PAS si le fournisseur
 * a démarré — reste compté). Ces tests prouvent que `replicate.ts` pose CES DRAPEAUX, et
 * seulement dans les cas où ils sont VRAIMENT prouvés.
 */
describe('jamaisEnvoye / incertain — distingués pour le plafond de dépense par compte', () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('prompt vide : `jamaisEnvoye` (aucune requête n’est jamais partie)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'studiio-replicate-flags-'));
    const image = join(dir, 'source.png');
    writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const r = await FOURNISSEUR_REPLICATE_VIDEO.genererVideo({ fichierImageSource: image, prompt: '', dureeS: 3, format: '9:16', graine: 1 });
    expect(r).toMatchObject({ ok: false, jamaisEnvoye: true });
    expect((r as { incertain?: boolean }).incertain).toBeFalsy();
  });

  it('image source illisible : `jamaisEnvoye` (le fichier n’a jamais pu être lu, donc jamais envoyé)', async () => {
    const r = await FOURNISSEUR_REPLICATE_VIDEO.genererVideo({
      fichierImageSource: '/chemin/inexistant.png', prompt: 'mouvement', dureeS: 3, format: '9:16', graine: 1,
    });
    expect(r).toMatchObject({ ok: false, jamaisEnvoye: true });
  });

  it('REPLICATE_API_TOKEN absent : `jamaisEnvoye` (le client n’est même pas construit)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'studiio-replicate-flags-'));
    const image = join(dir, 'source.png');
    writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    delete process.env.REPLICATE_API_TOKEN;
    const r = await FOURNISSEUR_REPLICATE_VIDEO.genererVideo({ fichierImageSource: image, prompt: 'mouvement', dureeS: 3, format: '9:16', graine: 1 });
    expect(r).toMatchObject({ ok: false, jamaisEnvoye: true });
  });

  it('une erreur fournisseur ORDINAIRE (ni jamaisEnvoye ni incertain) ne pose aucun des deux drapeaux — reste compté par défaut', () => {
    // Preuve statique : seules les branches `ctrl.signal.aborted` posent `incertain`, et
    // seules les validations locales (prompt, lecture de fichier, token absent) posent
    // `jamaisEnvoye`. Toute AUTRE erreur (réponse HTTP du fournisseur, média illisible après
    // téléchargement) ne pose NI L'UN NI L'AUTRE — le filet de sécurité « reste compté » par
    // défaut, décrit dans `fournisseur.ts`, s'applique.
    const code = src('src/lib/cinema/generation/replicate.ts');
    expect(code).toMatch(/return \{ ok: false, erreur: e instanceof Error \? e\.message\.slice\(0, 140\) : 'generation refusee par le fournisseur' \};/);
    // `rapatrier` (après une réponse RÉUSSIE du fournisseur) ne pose jamais ces drapeaux :
    // l'appel a eu lieu, le média est juste illisible — toujours une dépense réelle.
    const rapatrier = code.slice(code.indexOf('async function rapatrier'), code.indexOf('async function genererImage'));
    expect(rapatrier).not.toMatch(/jamaisEnvoye|incertain/);
  });

  it('le délai dépassé (abort) pose `incertain: true`, jamais `jamaisEnvoye` — et seulement là', () => {
    // Comportement dynamique vérifié indirectement : un VRAI timeout de 600 s (DELAI_VIDEO_MS)
    // ne peut pas s'attendre dans un test, et les horloges simulées de vitest n'avancent pas
    // ici de façon fiable à travers un import dynamique + un AbortSignal (bloque le worker).
    // Preuve statique, ligne par ligne : les DEUX points où `ctrl.signal.aborted` est observé
    // posent `incertain: true`, et SEULEMENT ceux-là — jamais `jamaisEnvoye` à ces lignes, qui
    // affirmerait à tort que rien n'est parti alors que la requête a pu être envoyée.
    const code = src('src/lib/cinema/generation/replicate.ts');
    const occurrences = [...code.matchAll(/if \(ctrl\.signal\.aborted\)[^\n]*\n?[^\n]*incertain: true/g)];
    expect(occurrences.length).toBeGreaterThanOrEqual(1);
    for (const m of occurrences) expect(m[0]).not.toContain('jamaisEnvoye');
    // Et la ligne qui DÉCLENCHE l'abandon (le minuteur) ne pose, elle, jamais de drapeau :
    // c'est la détection de l'abandon qui compte, pas son déclenchement.
    expect(code).toContain('setTimeout(() => ctrl.abort(), delaiMs)');
  });
});

/**
 * RÉGRESSION — le data URI envoyé au modèle vidéo déclarait `image/png` SANS REGARDER les
 * octets réels. Or `genererImage` (juste au-dessus) produit du WEBP (`output_format: 'webp'`) :
 * animer une image que Cinema IA a elle-même générée revenait donc à annoncer un format faux.
 * Corrigé en détectant le format réel (même fonction que `lib/ai/affiche-reference.ts`), jamais
 * deviné. Non prouvé avec certitude comme LA cause de l'échec E002 observé en production (aucun
 * appel réel n'a été fait pour le confirmer), mais c'est une incohérence réelle, corrigée par
 * principe.
 */
describe('le data URI vidéo déclare le VRAI format de l’image, jamais une supposition', () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('le code détecte la signature réelle au lieu d’écrire `data:image/png` en dur', () => {
    const code = src('src/lib/cinema/generation/replicate.ts');
    expect(code).toContain("await import('@/lib/storage/image-signature')");
    expect(code).toContain('detecterSignatureImage(octets)');
    expect(code).toContain('data:${signature.mime};base64');
    // Hors commentaires : le hardcode fautif ne doit plus apparaître comme code actif.
    const sansCommentaires = code.split('\n').filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//')).join('\n');
    expect(sansCommentaires).not.toContain('data:image/png;base64');
  });

  it('une image WEBP réelle (celle que `genererImage` produit) passe la détection — jamais rejetée pour son format', async () => {
    dir = mkdtempSync(join(tmpdir(), 'studiio-replicate-mime-'));
    const image = join(dir, 'source.webp');
    // En-tête RIFF/WEBP minimal, suffisant pour la signature (pas une image décodable complète).
    writeFileSync(image, Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]));
    delete process.env.REPLICATE_API_TOKEN; // preuve qu'aucun appel reseau ne part, meme ici
    const r = await FOURNISSEUR_REPLICATE_VIDEO.genererVideo({
      fichierImageSource: image, prompt: 'mouvement', dureeS: 3, format: '9:16', graine: 1,
    });
    // Le refus vient du jeton absent, PAS du format de l'image : la preuve qu'il a été lu et
    // reconnu avant d'atteindre l'appel réseau.
    expect(r).toMatchObject({ ok: false, jamaisEnvoye: true });
    expect((r as { erreur: string }).erreur).not.toContain('format non reconnu');
  });

  it('un contenu qui n’est ni PNG, ni JPEG, ni WEBP est refusé AVANT tout appel réseau', async () => {
    dir = mkdtempSync(join(tmpdir(), 'studiio-replicate-mime-'));
    const image = join(dir, 'source.bin');
    writeFileSync(image, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
    const r = await FOURNISSEUR_REPLICATE_VIDEO.genererVideo({
      fichierImageSource: image, prompt: 'mouvement', dureeS: 3, format: '9:16', graine: 1,
    });
    expect(r).toMatchObject({ ok: false, jamaisEnvoye: true });
    expect((r as { erreur: string }).erreur).toContain('format non reconnu');
  });
});
