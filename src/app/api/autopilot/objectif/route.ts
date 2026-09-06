import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import {
  MESSAGES_OBJECTIF_COMPTE, enregistrerObjectifCommunicationUtilisateur,
  lireObjectifCommunicationUtilisateur,
} from '@/lib/autopilot/analyse/objectif-compte';
import { lireObjectif } from '@/lib/autopilot/analyse/objectif-communication';

/**
 * LOT 2B ÉTAPE 4C — « MON OBJECTIF » : L'OBJECTIF PAR DÉFAUT DU COMPTE.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI UNE ROUTE À PART DE `/api/autopilot/config`
 * ---------------------------------------------------------------------------
 *
 * Le `PUT` de la configuration écrit TOUTES les colonnes : cadence, mode,
 * plateformes, plancher de crédits, rushes. Y brancher « Mon objectif »
 * obligerait l'écran à renvoyer la configuration entière pour changer une
 * intention — et le premier champ oublié remettrait une cadence à sa valeur
 * par défaut, silencieusement. Le même raisonnement qu'à l'étape 3 pour
 * « Mon style », et la même conclusion.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ LE `userId` VIENT DE LA SESSION, ET DE NULLE PART AILLEURS
 * ---------------------------------------------------------------------------
 *
 * Aucun champ du corps ne le porte, aucun paramètre d'URL ne le porte. Lire
 * ou écrire l'objectif d'un autre compte n'est donc pas « interdit » : c'est
 * inexprimable.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ CE `PUT` EST LA SEULE FAÇON DE CHANGER LE DÉFAUT DU COMPTE
 * ---------------------------------------------------------------------------
 *
 * Ni la création d'une vidéo, ni un plan de montage, ni un rendu n'écrivent
 * ici. Une vidéo peut déclarer son propre objectif — il vaut pour elle seule,
 * et le compte n'en sait rien. Sans cette séparation, essayer un objectif sur
 * une vidéo redéfinirait l'intention de toutes les suivantes.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * ⚠️ REFUSÉS, JAMAIS IGNORÉS. Un champ ignoré laisse croire qu'il a été pris
 * en compte, et c'est exactement ce qu'espère celui qui l'envoie.
 *
 * `lireObjectif` refuse déjà toute clé hors de son contrat — cette liste
 * existe pour que le refus NOMME ce qui a été tenté, plutôt que de répondre
 * « objectif invalide » à une tentative de prise de contrôle.
 */
const CHAMPS_INTERDITS = [
  'userId', 'user_id', 'id', 'algorithmePlan', 'algorithme_plan', 'politique',
  'objectiveScore', 'objectifCanonique', 'signaux', 'notes', 'montagePlanId',
  'clipSetId', 'candidateSetId', 'analysisId', 'renduId', 'design_style',
  'profilCreatif', 'montage', 'audio',
] as const;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const objectif = await lireObjectifCommunicationUtilisateur(session.user.id);
  // `objectif: null` n'est pas une erreur : c'est « ce compte n'a pas encore
  // d'objectif ». L'écran affiche « Objectif général » et propose de le
  // configurer, et le montage reste celui d'avant ce lot.
  return NextResponse.json({ ok: true, objectif });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  let json: unknown;
  try { json = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Corps JSON invalide' }, { status: 400 });
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return NextResponse.json({ ok: false, error: 'Corps invalide' }, { status: 422 });
  }

  for (const interdit of CHAMPS_INTERDITS) {
    if (Object.prototype.hasOwnProperty.call(json as Record<string, unknown>, interdit)) {
      return NextResponse.json(
        {
          ok: false,
          motif: 'champ_interdit',
          error: `Le champ « ${interdit} » est décidé par le serveur.`,
        },
        { status: 422 },
      );
    }
  }

  // ⚠️ LE MÊME LECTEUR FERMÉ QUE LE MOTEUR, PAS UN SECOND. Un schéma permissif
  // ici laisserait entrer en base un objectif que `politiqueDePlan` ne sait
  // pas lire : il serait « enregistré » et sans effet.
  const lecture = lireObjectif(json);
  if (!lecture.ok) {
    return NextResponse.json(
      { ok: false, error: lecture.message, motif: lecture.motif }, { status: 422 },
    );
  }

  const ecriture = await enregistrerObjectifCommunicationUtilisateur(userId, lecture.objectif);
  if (!ecriture.ok) {
    // ⚠️ 503 ET NON 500 POUR LES DEUX PREMIERS. Ce ne sont pas des pannes :
    // ce sont des migrations qui manquent, donc des situations qui se
    // résolvent d'elles-mêmes au déploiement suivant. Un 500 ferait chercher
    // un bug là où il n'y en a pas.
    const statut = ecriture.motif === 'ecriture_impossible' ? 500 : 503;
    return NextResponse.json(
      { ok: false, error: MESSAGES_OBJECTIF_COMPTE[ecriture.motif], motif: ecriture.motif },
      { status: statut },
    );
  }
  return NextResponse.json({ ok: true, objectif: ecriture.objectif });
}
