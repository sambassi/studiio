/**
 * CREER_PREMIUM_3D_FIX — LA BANQUE AUDIO NE PEUT PLUS PERDRE UNE PISTE.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER MESURE, ET CE QU'IL NE MESURE PAS
 * ───────────────────────────────────────────────────────────────────────────
 *
 * L'atomicité elle-même est une propriété du MOTEUR : elle se prouve sur un
 * vrai PostgreSQL, et c'est ce que fait `tests-pg/banque-audio-atomique.pg.test
 * .ts` — verrou pris par une transaction tierce, appel concurrent forcé
 * d'attendre, dix ajouts simultanés comptés APRÈS coup.
 *
 * Ici on tient l'autre moitié, celle qu'un test de base ne voit pas : que
 * l'application PASSE bien par cette garantie, et qu'aucun chemin d'écriture
 * ne la contourne. Un correctif atomique auquel une seule route continue de
 * préférer l'ancien chemin ne corrige rien du tout.
 *
 * ⚠️ LE DÉFAUT D'ORIGINE, EN UNE PHRASE. La route lisait la bibliothèque,
 * calculait `[...pistes, nouvelle]` en mémoire, puis renvoyait la clé entière
 * à la fusion atomique. Deux imports lancés de front — ce que fait le dépôt
 * groupé, `CONCURRENCE_IMPORT_MEDIA = 2` — lisaient tous deux N pistes et
 * écrivaient tous deux N+1 : la fusion s'appliquait fidèlement à une valeur
 * déjà périmée, et une piste sur deux disparaissait sous un `200`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|--)/.test(l)).join('\n');

const MIGRATION = 'migrations/2026-09-09-autopilot-banque-audio-atomique.sql';
const SQL = lire(MIGRATION);
const SQL_NU = sansProse(SQL);
const ROUTE = sansProse(lire('src/app/api/autopilot/banque-audio/route.ts'));
const PROFIL = sansProse(lire('src/lib/autopilot/analyse/profil-compte.ts'));
const MEDIA = sansProse(lire('src/components/shared/MediaLibrary.tsx'));

describe('1. La liste est relue au moment où elle est écrite', () => {
  it('1.1 ⚠️ LE VERROU EST LA GARANTIE — les deux fonctions le prennent', () => {
    // Sans `for update`, deux appels liraient la même liste et le second
    // effacerait le premier : c'est exactement le défaut mesuré en navigateur.
    expect(SQL_NU.match(/for update/g) ?? []).toHaveLength(2);
  });

  it('1.2 la lecture de la liste a lieu DANS la fonction, pas avant', () => {
    // La liste vient de la ligne verrouillée, jamais d'un paramètre : un
    // appelant ne peut pas lui imposer un état lu plus tôt.
    expect(SQL_NU).toContain("v_pistes := coalesce(v_audio->'pistes', '[]'::jsonb)");
    expect(SQL_NU).not.toMatch(/p_pistes\b/);
  });

  it('1.3 chaque fonction n’écrit qu’une fois, à la fin', () => {
    expect(SQL_NU.match(/update public\.autopilot_config/g) ?? []).toHaveLength(2);
  });
});

describe('2. Aucun chemin d’écriture ne contourne la garantie', () => {
  it('2.1 ⚠️ LA ROUTE NE RECOMPOSE PLUS LA LISTE EN MÉMOIRE', () => {
    // Les trois formes exactes du défaut d'origine, interdites de retour.
    expect(ROUTE).not.toContain('[...biblio.audio.pistes');
    expect(ROUTE).not.toContain('biblio.audio.pistes.filter');
    expect(ROUTE).not.toContain('biblio.audio.pistes.map');
  });

  it('2.2 la route n’écrit plus la bibliothèque entière', () => {
    // `enregistrerBibliothequeUtilisateur` reste juste pour les voisins
    // (favoris, voix off) ; la banque audio, elle, ne doit plus y toucher.
    expect(ROUTE).not.toContain('enregistrerBibliothequeUtilisateur');
  });

  it('2.3 les deux mutations passent par les RPC atomiques', () => {
    expect(ROUTE).toContain('ajouterPisteBanqueAudio');
    expect(ROUTE).toContain('muterPisteBanqueAudio');
    expect(PROFIL).toContain("supabaseAdmin.rpc('autopilot_banque_audio_ajouter'");
    expect(PROFIL).toContain("supabaseAdmin.rpc('autopilot_banque_audio_muter'");
  });

  it('2.4 ⚠️ AUCUN VERROU EN MÉMOIRE NODE NE TIENT LIEU DE GARANTIE', () => {
    /* Un `Map<userId, Mutex>` sérialiserait les appels d'UN processus et
       laisserait passer ceux du voisin : deux instances, deux onglets servis
       par deux workers, et la perte revient — mais seulement en production,
       là où elle ne se reproduit pas à la demande. */
    expect(ROUTE).not.toMatch(/mutex|verrouMemoire|fileDAttente|globalThis\.__/i);
    expect(PROFIL).not.toMatch(/mutex|verrouMemoire|fileDAttente/i);
  });
});

describe('3. Le succès désigne un état persisté', () => {
  it('3.1 ⚠️ UN 200 NE PEUT PLUS RECOUVRIR UNE PISTE EFFACÉE', () => {
    // La route ne répond `ok: true` qu'après un `r.ok` de la mutation, et rend
    // la liste que la transaction a réellement écrite.
    expect(ROUTE).toContain('if (!r.ok) return echecMutation(r.motif)');
    expect(ROUTE).toContain('pistes: r.pistes');
  });

  it('3.2 la banque pleine et la fiche absente gardent leur statut d’origine', () => {
    expect(ROUTE).toContain("if (motif === 'pleine') return refus('banque_pleine')");
    expect(ROUTE).toContain("if (motif === 'absente') return refus('fichier_absent', 404)");
  });

  it('3.3 ⚠️ SANS LA MIGRATION, LA BANQUE REFUSE — ELLE NE SE REPLIE PAS', () => {
    /* Le repli lire-modifier-écrire serait le retour exact du défaut, et sous
       un `200`. Le même choix que « Mon objectif » : un refus lisible vaut
       mieux qu'une perte muette. */
    expect(PROFIL).toContain("return { ok: false, motif: 'socle_absent' }");
    expect(ROUTE).toContain("motif === 'socle_absent'");
    expect(ROUTE).toContain('503');
  });

  it('3.4 le message d’indisponibilité dit quoi appliquer', () => {
    expect(PROFIL).toContain('2026-09-09-autopilot-banque-audio-atomique.sql');
    expect(PROFIL).toContain('docker kill -s SIGUSR1 studiio-postgrest');
  });
});

describe('4. Capacité et doublon sont jugés dans la transaction', () => {
  it('4.1 ⚠️ 199 + DEUX AJOUTS SIMULTANÉS NE FONT PAS 201', () => {
    // La borne est lue sur la liste verrouillée, donc après l'ajout voisin.
    expect(SQL_NU).toContain('elsif jsonb_array_length(v_pistes) >= v_max then');
    expect(SQL_NU).toContain("issue := 'pleine'");
  });

  it('4.2 la clé reste la seule identité d’une piste', () => {
    // Ni le nom ni la taille : deux fichiers homonymes restent deux pistes.
    expect(SQL_NU).toContain("v_pistes->(i - 1)->>'cle' = v_cle");
    expect(SQL_NU).not.toMatch(/->>'nom'\s*=\s*/);
  });

  it('4.3 la même clé remplace la fiche, elle n’en crée pas une seconde', () => {
    expect(SQL_NU).toContain("issue := 'existante'");
    expect(SQL_NU).toContain('jsonb_set(v_pistes, array[v_rang::text], v_piste)');
  });

  it('4.4 la date de confirmation des droits n’est pas réécrite', () => {
    expect(SQL_NU).toContain("v_piste, '{droitsConfirmesLe}'");
  });
});

describe('5. Le retrait reste cohérent, dans la même transaction', () => {
  it('5.1 favoris et autorisations sont nettoyés avec la piste', () => {
    expect(SQL_NU).toContain("jsonb_set(v_biblio, '{favoris}', v_favoris, true)");
    expect(SQL_NU).toContain("jsonb_set(v_biblio, '{automatisation}', v_autom, true)");
  });

  it('5.2 retirer du catalogue ne détruit aucun octet', () => {
    expect(SQL).not.toMatch(/removeObject|deleteObject|drop table|truncate/i);
  });
});

describe('6. Le dépôt groupé garde sa concurrence', () => {
  it('6.1 ⚠️ CONCURRENCE_IMPORT_MEDIA RESTE À 2', () => {
    /* La ramener à 1 aurait masqué la course dans CE composant, en la laissant
       intacte pour deux onglets, deux workers ou une seconde instance. La
       garantie est descendue dans la base ; la vitesse d'import reste. */
    expect(MEDIA).toContain('export const CONCURRENCE_IMPORT_MEDIA = 2');
  });
});

describe('7. La migration reste jouable et sûre', () => {
  it('7.1 les fonctions sont remplaçables sans casse', () => {
    expect(SQL_NU.match(/create or replace function/g) ?? []).toHaveLength(2);
  });

  it('7.2 les conventions de sécurité des RPC autopilote sont tenues', () => {
    expect(SQL_NU.match(/security definer/g) ?? []).toHaveLength(2);
    expect(SQL_NU.match(/set search_path = public, pg_temp/g) ?? []).toHaveLength(2);
    // Aucun SQL dynamique : rien à injecter.
    expect(SQL_NU).not.toMatch(/execute\s+(format|'|")/i);
  });

  it('7.3 ⚠️ LE COMPTE VIENT DU SERVEUR, JAMAIS DU NAVIGATEUR', () => {
    // La route tient `userId` de la session, et la clé est vérifiée avant tout.
    expect(ROUTE).toContain('const userId = session.user.id');
    expect(ROUTE).toContain("if (!cleAudioValide(cle, userId)) return refus('cle_hors_perimetre', 403)");
  });

  it('7.4 aucune écriture sans compte', () => {
    expect(SQL_NU).toContain('if p_user_id is null');
    expect(SQL_NU).toContain("issue := 'argument_invalide'");
  });
});
