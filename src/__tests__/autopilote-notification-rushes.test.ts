import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Notification « rushes manquants » — et l'anti-doublon qui la rend lisible.
 *
 * ⚠️ IL N'EXISTAIT AUCUN SYSTÈME DE NOTIFICATIONS IN-APP. La demande disait
 * « réutiliser le mécanisme existant » ; la cloche de `Navbar.tsx` était un
 * bouton sans gestionnaire de clic, avec une pastille rouge écrite en dur, et
 * `/api/admin/notifications` ne règle que les alertes EMAIL de
 * l'administrateur. Ce lot pose donc le socle.
 *
 * ⚠️ ET IL CORRIGE UN DÉFAUT QUI EXISTAIT DÉJÀ. Le déclencheur de l'Autopilote
 * passe TOUTES LES HEURES, et `decideRun` rend `sans-rush` AVANT le test
 * d'heure de départ : un compte à la banque vide recevait donc VINGT-QUATRE
 * emails par jour. L'anti-doublon vaut pour la cloche ET pour l'email, depuis
 * une seule décision — deux conditions parallèles auraient fini par ne plus
 * dire la même chose (cf. `tasks/lessons.md`, 2026-07-29).
 */

// ── Une base en mémoire, chaînable comme PostgREST ────────────────────────
interface Ligne { id: string; user_id: string; kind: string; created_at: string; read_at: string | null }

const base: { lignes: Ligne[]; tableAbsente: boolean; horloge: number } = {
  lignes: [], tableAbsente: false, horloge: Date.parse('2026-08-07T09:00:00.000Z'),
};

/**
 * Constructeur de requête minimal.
 *
 * Il est THENABLE parce que `markRead` attend la requête elle-même, sans
 * appeler de méthode terminale — le vrai client PostgREST se comporte ainsi.
 */
function requete(op: 'select' | 'insert' | 'update') {
  const filtres: Array<(l: Ligne) => boolean> = [];
  let majRead = false;
  const resultat = () => {
    if (base.tableAbsente) {
      return { data: null, error: { message: 'relation "user_notifications" does not exist' } };
    }
    const trouves = base.lignes.filter((l) => filtres.every((f) => f(l)));
    if (op === 'update' && majRead) {
      for (const l of trouves) l.read_at = new Date(base.horloge).toISOString();
    }
    return { data: trouves, error: null };
  };
  const b: Record<string, unknown> = {
    eq: (col: string, v: unknown) => { filtres.push((l) => (l as never as Record<string, unknown>)[col] === v); return b; },
    gte: (col: string, v: string) => { filtres.push((l) => String((l as never as Record<string, unknown>)[col]) >= v); return b; },
    is: (col: string, v: null) => { filtres.push((l) => (l as never as Record<string, unknown>)[col] === v); return b; },
    in: (col: string, vs: unknown[]) => { filtres.push((l) => vs.includes((l as never as Record<string, unknown>)[col])); return b; },
    order: () => b,
    limit: () => resultat(),
    then: (res: (v: unknown) => unknown) => Promise.resolve(resultat()).then(res),
  };
  if (op === 'update') majRead = true;
  return b;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => requete('select'),
      update: () => requete('update'),
      insert: (row: Record<string, unknown>) => {
        if (base.tableAbsente) {
          return Promise.resolve({ error: { message: 'relation "user_notifications" does not exist' } });
        }
        base.lignes.push({
          id: `n${base.lignes.length + 1}`,
          user_id: String(row.user_id),
          kind: String(row.kind),
          created_at: new Date(base.horloge).toISOString(),
          read_at: null,
        });
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

import {
  notifyOnce, listNotifications, markRead, resetNotificationThrottle,
  NOTIFICATION_KINDS, DEFAULT_DEDUPE_MS,
} from '@/lib/notifications/store';

const HEURE = 60 * 60 * 1000;
const T0 = Date.parse('2026-08-07T09:00:00.000Z');

beforeEach(() => {
  base.lignes = [];
  base.tableAbsente = false;
  base.horloge = T0;
  resetNotificationThrottle();
});

/** Un passage horaire du cron, sur un compte à la banque vide. */
async function passage(t: number) {
  base.horloge = t;
  return notifyOnce({
    userId: 'u1',
    kind: NOTIFICATION_KINDS.autopiloteSansRush,
    title: 'Autopilote en pause : ajoutez des rushes',
    body: 'Ajoutez-y au moins une vidéo.',
    href: '/dashboard/creer?panneau=autopilote',
    now: t,
  });
}

// ─────────────────────────────────────────────────────────────────────────
describe('A — une seule notification par jour, pas vingt-quatre', () => {
  it('le premier passage prévient', async () => {
    const r = await passage(T0);
    expect(r.created).toBe(true);
    expect(r.persisted).toBe(true);
    expect(base.lignes).toHaveLength(1);
  });

  it('les vingt-trois passages suivants ne préviennent plus', async () => {
    await passage(T0);
    const suivants = [];
    for (let h = 1; h < 24; h += 1) suivants.push(await passage(T0 + h * HEURE));
    expect(suivants.every((r) => r.created === false)).toBe(true);
    // ⚠️ C'EST LE CHIFFRE QUI COMPTE. Sans anti-doublon, la cloche —  et la
    // boîte mail — en compteraient vingt-quatre.
    expect(base.lignes).toHaveLength(1);
  });

  it('le lendemain, on prévient de nouveau', async () => {
    await passage(T0);
    const r = await passage(T0 + DEFAULT_DEDUPE_MS + 1);
    expect(r.created).toBe(true);
    expect(base.lignes).toHaveLength(2);
  });

  it('deux CAUSES différentes se notifient chacune', async () => {
    // L'anti-doublon porte sur la famille, pas sur l'utilisateur : « sans
    // rush » et « plus de crédits » sont deux choses à lever séparément.
    await passage(T0);
    const autre = await notifyOnce({
      userId: 'u1', kind: NOTIFICATION_KINDS.autopiloteCredits, title: 'Crédits', now: T0,
    });
    expect(autre.created).toBe(true);
    expect(base.lignes).toHaveLength(2);
  });

  it('deux UTILISATEURS différents sont prévenus chacun', async () => {
    await passage(T0);
    const autre = await notifyOnce({
      userId: 'u2', kind: NOTIFICATION_KINDS.autopiloteSansRush, title: 'Rushes', now: T0,
    });
    expect(autre.created).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B — sans la migration, rien ne casse et l email reste limité', () => {
  beforeEach(() => { base.tableAbsente = true; });

  it('la première tentative autorise quand même l alerte', async () => {
    const r = await passage(T0);
    expect(r.created).toBe(true);
    // Rien n'est écrit : la cloche restera muette, l'email partira seul.
    expect(r.persisted).toBe(false);
    expect(base.lignes).toHaveLength(0);
  });

  it('le garde-fou EN MÉMOIRE prend le relais dans la même journée', async () => {
    // ⚠️ SANS LUI, l'email best-effort repartirait à chaque passage horaire —
    // exactement le défaut que ce lot corrige.
    await passage(T0);
    const suivants = [];
    for (let h = 1; h < 24; h += 1) suivants.push(await passage(T0 + h * HEURE));
    expect(suivants.every((r) => r.created === false)).toBe(true);
  });

  it('la lecture rend une liste vide plutôt que de lever', async () => {
    await expect(listNotifications('u1')).resolves.toEqual([]);
    await expect(markRead('u1')).resolves.toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('C — lecture et marquage', () => {
  it('la cloche relit ce qui a été écrit, non lu', async () => {
    await passage(T0);
    const liste = await listNotifications('u1');
    expect(liste).toHaveLength(1);
    expect(liste[0].readAt).toBeNull();
    expect(liste[0].kind).toBe(NOTIFICATION_KINDS.autopiloteSansRush);
  });

  it('marquer comme lu vide le compteur, sans supprimer l historique', async () => {
    await passage(T0);
    expect(await markRead('u1')).toBe(true);
    const liste = await listNotifications('u1');
    expect(liste).toHaveLength(1);
    expect(liste[0].readAt).not.toBeNull();
  });

  it('une requête sans utilisateur ne fait rien', async () => {
    // Un `userId` vide passerait sinon un filtre `eq` qui ne filtre rien.
    expect(await markRead('')).toBe(false);
    expect(await listNotifications('')).toEqual([]);
    expect((await notifyOnce({ userId: '', kind: 'x', title: 'y' })).created).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('D — le câblage du cron et de la cloche', () => {
  // Ces quatre-là sont des vérifications de CÂBLAGE : elles constatent que
  // les pièces testées plus haut sont bien reliées entre elles. Le
  // comportement, lui, est vérifié par les sections A à C.
  const cron = readFileSync(resolve(__dirname, '../app/api/cron/autopilot/route.ts'), 'utf-8');
  const navbar = readFileSync(resolve(__dirname, '../components/layout/Navbar.tsx'), 'utf-8');
  const migration = readFileSync(
    resolve(__dirname, '../../migrations/2026-08-07-user-notifications.sql'), 'utf-8',
  );

  it('l email ne part QUE si la notification a réellement été créée', () => {
    // Une seule source de vérité pour les deux canaux.
    expect(cron).toContain('if (!created || !email) return;');
    expect(cron).toContain('sendEmailSilent({');
  });

  it('un rush introuvable est retiré de la banque ET signalé', () => {
    expect(cron).toContain('rushEncorePresent');
    expect(cron).toContain('rushesMorts.add(rushUrl)');
    expect(cron).toContain('rush_urls: banquePropre');
    expect(cron).toContain('NOTIFICATION_KINDS.autopiloteRushIntrouvable');
  });

  it('la cloche n annonce plus une pastille écrite en dur', () => {
    // ⚠️ ELLE ÉTAIT PERMANENTE : une pastille rouge sans aucune source de
    // données, qui annonçait en continu des notifications inexistantes.
    expect(navbar).toContain("fetch('/api/notifications')");
    expect(navbar).toContain('{nonLues > 0 && (');
    expect(navbar).not.toContain(
      '<span className="absolute top-0 right-0 w-2 h-2 bg-studiio-accent rounded-full"></span>',
    );
  });

  it('la migration n ajoute qu une table, avec ses deux étapes PostgREST', () => {
    expect(migration).toContain('create table if not exists user_notifications');
    expect(migration).not.toMatch(/alter table (?!.*user_notifications)/i);
    expect(migration).toContain('grant all on table public.user_notifications to public;');
    expect(migration).toContain('docker kill -s SIGUSR1 studiio-postgrest');
    // L'index qui porte l'anti-doublon.
    expect(migration).toContain('user_notifications_user_kind_idx');
  });
});
