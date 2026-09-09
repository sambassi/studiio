// @vitest-environment node
/**
 * A_8c — L'INSCRIPTION D'UNE SOURCE, AVANT TOUT FOURNISSEUR.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER TIENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Que l'inscription puisse exister SANS qu'aucun fournisseur ne sache qu'elle
 * existe — et que rien, nulle part, ne fasse semblant du contraire.
 *
 * Trois choses en découlent, et chacune a déjà été un défaut ailleurs :
 *
 *   1. `provider_avatar_id` reste NULL. Y poser « PLACEHOLDER » ferait mentir
 *      une colonne qui signifie « identifiant chez le fournisseur ».
 *   2. la route de statut n'interroge PAS le fournisseur pour une telle ligne.
 *      Elle le faisait : `null` partait sur le réseau à chaque affichage.
 *   3. l'écran ne dit jamais « clone créé » quand rien n'a été entraîné.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  interrogerLeFournisseur, estEtatLocal, estEtatPret, ETATS_LOCAUX,
} from '@/lib/avatar/etats';
import {
  SUJET_AVATAR, VERSION_CONSENTEMENT, TEXTE_CONSENTEMENT, ETAT_SOURCE_PRETE,
} from '@/lib/avatar/contrat';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|--)/.test(l)).join('\n');

const ENROLLMENT = sansProse(lire('src/app/api/avatar/enrollment/route.ts'));
const CREATE = sansProse(lire('src/app/api/avatar/create/route.ts'));
const PANNEAU = sansProse(lire('src/components/avatar/CloneVideoPanel.tsx'));
const PAGE = sansProse(lire('src/app/dashboard/avatar/page.tsx'));
const MIGRATION = lire('migrations/2026-09-09-avatar-provider-id-nullable-enrollment.sql');

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Deux phases de vie, jamais confondues', () => {
  it('1.1 ⚠️ SANS IDENTIFIANT FOURNISSEUR, ON NE L’INTERROGE PAS', () => {
    /* LE DÉFAUT EXACT : la condition était « statut pas encore prêt », et une
       ligne `source_ready` sans identifiant y entrait — `null` partait sur le
       réseau à chaque affichage de la page. */
    expect(interrogerLeFournisseur({
      status: ETAT_SOURCE_PRETE, provider_avatar_id: null,
    })).toBe(false);
    expect(interrogerLeFournisseur({
      status: 'processing', provider_avatar_id: null,
    })).toBe(false);
    expect(interrogerLeFournisseur({
      status: 'processing', provider_avatar_id: '',
    })).toBe(false);
    expect(interrogerLeFournisseur(null)).toBe(false);
  });

  it('1.2 avec un identifiant et un entraînement en cours, on l’interroge', () => {
    expect(interrogerLeFournisseur({
      status: 'processing', provider_avatar_id: 'hg-42',
    })).toBe(true);
  });

  it('1.3 un avatar déjà prêt n’est pas réinterrogé', () => {
    for (const s of ['completed', 'ready', 'success']) {
      expect(interrogerLeFournisseur({ status: s, provider_avatar_id: 'hg-42' }), s).toBe(false);
    }
  });

  it('1.4 ⚠️ `source_ready` EST UN ÉTAT LOCAL, PAS UN ÉTAT « EN COURS »', () => {
    // Il n'avance pas tout seul : il attend une action de son propriétaire.
    expect(estEtatLocal(ETAT_SOURCE_PRETE)).toBe(true);
    expect(estEtatLocal('processing')).toBe(false);
    expect(estEtatPret(ETAT_SOURCE_PRETE)).toBe(false);
    expect(ETATS_LOCAUX).toContain(ETAT_SOURCE_PRETE);
  });

  it('1.5 la route de consultation passe par cette garde', () => {
    expect(CREATE).toContain('interrogerLeFournisseur(avatar)');
    // L'ancienne condition, plus large, ne doit pas revenir.
    expect(CREATE).not.toContain('!READY_STATUSES.includes(avatar.status)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Aucun identifiant inventé', () => {
  it('2.1 ⚠️ `provider_avatar_id` EST ÉCRIT À NULL, EXPLICITEMENT', () => {
    expect(ENROLLMENT).toContain('provider_avatar_id: null');
  });

  it('2.2 aucun placeholder nulle part', () => {
    /* « PLACEHOLDER », « pending », « local » dans cette colonne feraient
       mentir la donnée — et la route de statut irait interroger le
       fournisseur avec cette valeur. */
    expect(ENROLLMENT).not.toMatch(/provider_avatar_id:\s*'(?!null)/);
    /* Le SQL EXÉCUTÉ, pas la prose : le commentaire de la migration cite ces
       mots précisément pour dire qu'on ne les écrira pas. Les compter comme
       fautifs interdirait d'expliquer une décision. */
    const sqlNu = MIGRATION.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
    expect(sqlNu).not.toMatch(/PLACEHOLDER|'pending'|'local'|'temp'/i);
  });

  it('2.3 la migration ne relâche QUE la contrainte, et rien d’autre', () => {
    expect(MIGRATION).toContain('drop not null');
    expect(MIGRATION).not.toMatch(/drop\s+column|drop\s+table|alter\s+column\s+\w+\s+type/i);
    expect(MIGRATION).not.toMatch(/^\s*update\s+/im);
  });

  it('2.4 aucun avatar n’est marqué validé ni entraîné par l’inscription', () => {
    expect(ENROLLMENT).not.toMatch(/validated_at\s*:/);
    expect(ENROLLMENT).toContain(`status: ETAT_SOURCE_PRETE`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Aucun appel fournisseur', () => {
  it('3.1 ⚠️ L’INSCRIPTION N’APPELLE AUCUN FOURNISSEUR', () => {
    /* `provider: 'heygen'` reste écrit en base — c'est une DONNÉE, elle dit à
       quel fournisseur cette identité appartiendra. Ce qui est interdit ici,
       c'est l'APPEL : aucun import du client, aucune requête réseau. */
    expect(ENROLLMENT).not.toMatch(/from '@\/lib\/avatar\/heygen'/);
    expect(ENROLLMENT).not.toMatch(/uploadAsset|createAvatar|generateAvatarVideo|heygenFetch/);
    expect(ENROLLMENT).not.toMatch(/fetch\(|api\.heygen|api\.elevenlabs/);
  });

  it('3.2 l’écran non plus', () => {
    expect(PANNEAU).not.toMatch(/heygen|elevenlabs/i);
  });

  it('3.3 aucune clé d’API n’est requise pour ce parcours', () => {
    // A_8c doit être testable et utilisable sans HEYGEN_API_KEY.
    expect(ENROLLMENT).not.toContain('HEYGEN_API_KEY');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Le consentement', () => {
  it('4.1 ⚠️ IL PRÉCÈDE TOUT LE RESTE', () => {
    /* On ne téléverse ni ne mesure le visage de quelqu'un « en attendant » sa
       certification. */
    const consentement = ENROLLMENT.indexOf("form.get('consentement')");
    const fichier = ENROLLMENT.indexOf("form.get('fichier')");
    expect(consentement).toBeGreaterThan(-1);
    expect(consentement).toBeLessThan(fichier);
  });

  it('4.2 ⚠️ `subject_type` VIENT DU SERVEUR, JAMAIS DE LA REQUÊTE', () => {
    // A_8 est SELF ONLY : un sujet fourni par le client serait la porte
    // exacte que cette règle ferme.
    expect(SUJET_AVATAR).toBe('self');
    expect(ENROLLMENT).toContain('subject_type: SUJET_AVATAR');
    expect(ENROLLMENT).not.toMatch(/form\.get\('subject/);
  });

  it('4.3 le texte et sa version vivent à un seul endroit', () => {
    // Deux copies d'une phrase juridique divergent au premier ajustement.
    expect(TEXTE_CONSENTEMENT).toMatch(/Je certifie être la personne visible/);
    expect(VERSION_CONSENTEMENT.length).toBeGreaterThan(3);
    expect(ENROLLMENT).toContain('consent_version: VERSION_CONSENTEMENT');
    expect(PANNEAU).toContain('TEXTE_CONSENTEMENT');
  });

  it('4.4 l’écran exige la case avant d’envoyer', () => {
    expect(PANNEAU).toContain('disabled={!consentement || envoi}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. La source reste privée', () => {
  it('5.1 elle est rangée par le helper A_8b, dans le namespace protégé', () => {
    expect(ENROLLMENT).toContain('cleSourceAvatar(userId, extension, Date.now())');
    expect(ENROLLMENT).toContain('.from(BUCKET_AVATAR)');
  });

  it('5.2 ⚠️ AUCUNE URL PUBLIQUE N’EST FABRIQUÉE', () => {
    expect(ENROLLMENT).not.toContain('getPublicUrl');
  });

  it('5.3 ⚠️ UNE VIDÉO DE LA BIBLIOTHÈQUE EST COPIÉE, PAS RÉFÉRENCÉE', () => {
    /* Ce n'est pas une préférence : les objets de `library/` sont servis SANS
       session par le relais public. Y laisser la source d'un clone rendrait la
       vidéo du visage publique — le défaut qu'A_8b a fermé. La copie garantit
       aussi que le cycle de vie de l'avatar n'atteint jamais le média
       d'origine. */
    expect(ENROLLMENT).toContain('.download(cheminMediatheque)');
    expect(ENROLLMENT).toContain('cleSourceAvatar');
  });

  it('5.4 le chemin de bibliothèque doit appartenir au compte', () => {
    // Le préfixe EST la preuve de propriété : un chemin d'autrui ne passe pas.
    expect(ENROLLMENT).toContain('chemin.startsWith(`${userId}/`)');
    expect(ENROLLMENT).toMatch(/includes\('\.\.'\)/);
  });

  it('5.5 l’aperçu de la source enregistrée passe par la route authentifiée', () => {
    expect(PAGE).toContain('/api/avatar/${avatar.id}/source');
    expect(PAGE).not.toMatch(/src=\{avatar\.source_url\}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Rien n’est écrit tant que la vidéo n’est pas acceptée', () => {
  it('6.1 ⚠️ LE VERDICT PRÉCÈDE LE TÉLÉVERSEMENT ET L’INSERTION', () => {
    /* Enregistrer d'abord et corriger ensuite produirait des inscriptions à
       demi valides que plus rien ne nettoie. */
    const verdict = ENROLLMENT.indexOf('verdictQualiteSource(mesure)');
    const envoi = ENROLLMENT.indexOf('.upload(cle,');
    const insert = ENROLLMENT.indexOf(".from('user_avatars')\n      .insert(");
    expect(verdict).toBeGreaterThan(-1);
    expect(envoi).toBeGreaterThan(verdict);
    expect(ENROLLMENT.indexOf('if (!verdict.acceptable)')).toBeLessThan(envoi);
    if (insert > -1) expect(insert).toBeGreaterThan(verdict);
  });

  it('6.2 une vidéo refusée répond 422 avec son verdict', () => {
    // La requête est bien formée ; c'est la vidéo qui ne convient pas.
    expect(ENROLLMENT).toContain('{ status: 422 }');
    expect(ENROLLMENT).toContain('{ success: false, verdict, mesure }');
  });

  it('6.3 la mesure se fait sur le fichier réel, jamais sur son nom', () => {
    expect(ENROLLMENT).toContain('argumentsSondeAvatar(local)');
    expect(ENROLLMENT).toContain('cheminFfprobe()');
  });

  it('6.4 le dossier temporaire est toujours nettoyé', () => {
    expect(ENROLLMENT).toContain('finally');
    expect(ENROLLMENT).toMatch(/rm\(dossier, \{ recursive: true, force: true \}\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. L’écran ne promet rien qu’il n’ait fait', () => {
  it('7.1 ⚠️ JAMAIS « CLONE CRÉÉ » SANS ENTRAÎNEMENT', () => {
    /* Le pire retour possible est celui qui a l'air d'un succès. */
    expect(PANNEAU).not.toMatch(/Clone créé|Votre clone est prêt|Clone entraîné/i);
    expect(PANNEAU).toContain('Vidéo prête');
    expect(PANNEAU).toContain('L’entraînement sera');
  });

  it('7.2 le guide 2–5 min est affiché avant de demander la vidéo', () => {
    const guide = PANNEAU.indexOf('data-clone-guide');
    const sources = PANNEAU.indexOf('data-clone-enregistrer');
    expect(guide).toBeGreaterThan(-1);
    expect(guide).toBeLessThan(sources);
  });

  it('7.3 les trois sources sont proposées', () => {
    for (const marque of ['data-clone-enregistrer', 'data-clone-importer', 'data-clone-bibliotheque']) {
      expect(PANNEAU, marque).toContain(marque);
    }
  });

  it('7.4 la bibliothèque ne montre que des vidéos', () => {
    expect(PANNEAU).toContain('mediaType="video"');
  });

  it('7.5 ⚠️ AUCUN PLAFOND DE 32 Mo NE DICTE PLUS LA DURÉE', () => {
    /* C'était la limite de l'ancien envoi direct ; elle interdisait en
       pratique les 2 à 5 minutes recommandées. */
    expect(PANNEAU).not.toMatch(/32\s*Mo|MAX_VIDEO_MB/);
    expect(ENROLLMENT).not.toMatch(/32 \* 1024 \* 1024|MAX_VIDEO_MB/);
  });

  it('7.6 un refus de caméra ne relance pas la demande en boucle', () => {
    // Redemander en rafale fait basculer le navigateur en refus permanent.
    expect(PANNEAU).toContain('n’a pas accès à votre caméra');
    expect((PANNEAU.match(/getUserMedia/g) ?? []).length).toBe(1);
  });

  it('7.7 la caméra est relâchée quand l’écran disparaît', () => {
    // Sans cela, la diode reste allumée après la navigation.
    expect(PANNEAU).toContain('camera?.getTracks().forEach((t) => t.stop())');
  });

  it('7.8 la vidéo n’est pas relue dans un tampon React avant l’envoi', () => {
    /* Une capture de cinq minutes pèse plusieurs centaines de mégaoctets : le
       navigateur n'a aucune raison de la porter en mémoire. */
    expect(PANNEAU).toContain("fd.append('fichier', fichier)");
    expect(PANNEAU).not.toMatch(/await fichier\.arrayBuffer\(\)/);
  });
});
