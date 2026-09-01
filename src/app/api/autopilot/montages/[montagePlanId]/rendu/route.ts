/**
 * M3-H — LE DÉCLENCHEMENT D'UN RENDU.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TROIS RÉPONSES, ET UNE SEULE LANCE DU TRAVAIL
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   • un rendu RÉUSSI d'identité identique existe → 200, `reutilise: true`.
 *     Aucun ffmpeg, aucun téléchargement, aucune capacité prise, aucun
 *     téléversement, aucune ligne de plus.
 *   • un rendu ACTIF existe → 409 avec son identifiant : l'écran peut le
 *     suivre plutôt que d'en demander un second.
 *   • sinon → 202, et le travail part derrière la réponse.
 *
 * ⚠️ LE CORPS EST VIDE, ET C'EST LE CONTRAT. Contrairement à M3-G, où le
 * format et la durée cible étaient de vraies demandes, il n'existe ici aucun
 * paramètre de rendu légitime : tout est lu dans le plan persisté.
 *
 * ⚠️ AUCUNE LOGIQUE FFMPEG ICI. La route authentifie, refuse, crée ou
 * réutilise, et confie le reste à l'orchestration.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { identifiantValide } from '@/lib/autopilot/analyse/clip-contrat';
import { lirePlanParId } from '@/lib/autopilot/analyse/montage-service';
import { prendrePlaceRendu } from '@/lib/autopilot/analyse/capacite';
import {
  BUDGET_RENDU_MAX_MS, CHAMPS_INTERDITS_RENDU, METHODE_RENDU, MOTIF_RENDU_INTERROMPU,
  type IdentiteRendu, type MotifRendu,
} from '@/lib/autopilot/analyse/rendu-contrat';
import { diagnosticRendu } from '@/lib/autopilot/analyse/rendu-ffmpeg';
import {
  creerRendu, lireRenduActif, lireRenduReussiIdentique, majRendu,
  type RenduMontage,
} from '@/lib/autopilot/analyse/rendu-service';
import { rendreEtPublier, type IssueConsignation } from '@/lib/autopilot/analyse/rendu';
import { renduPublic } from '@/lib/autopilot/analyse/rendu-presentation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/**
 * ⚠️ INERTE SOUS LE SERVEUR AUTONOME, et laissé pour la lisibilité. Le
 * conteneur lance `node server.js` : le processus vit, rien ne le gèle après
 * la réponse. C'est ce qui rend le travail détaché fiable ici, et le dépôt le
 * documente déjà pour M3-F.
 */
export const maxDuration = 60;

const SOCLE_ABSENT = 'La table des rendus n’existe pas encore sur ce serveur.';

const refus = (motif: string, message: string, status = 409) =>
  NextResponse.json({ ok: false, error: message, motif }, { status });

/**
 * Cette ligne peut-elle être SERVIE au lieu d'être refaite ?
 *
 * ⚠️ L'ÉTAT EST REVÉRIFIÉ ICI, MÊME SI LA REQUÊTE L'A DÉJÀ FILTRÉ.
 *
 * `lireRenduReussiIdentique` demande bien `etat = 'reussie'` à la base, mais
 * `renduDepuisLigne` RÉTROGRADE en mémoire une réussite dont le résultat ne
 * repasse pas la revalidation — clé hors du préfixe utilisateur, zéro octet,
 * codec vide. Se contenter de « la requête a rendu quelque chose » servait
 * alors un `reutilise: true` avec `video: null`, et comme l'index unique
 * interdit d'en créer un autre pour la même identité, le plan devenait
 * DÉFINITIVEMENT irrendable : chaque nouvel appel reservait la même impasse.
 *
 * L'identité est réaffirmée pour la même raison : elle est garantie par la
 * requête, et une garantie d'ailleurs n'est pas une garantie ici.
 */
function reutilisable(rendu: RenduMontage | null, identite: IdentiteRendu): boolean {
  if (!rendu) return false;
  if (rendu.etat !== 'reussie' || !rendu.resultat) return false;
  return rendu.montagePlanId === identite.montagePlanId
    && rendu.montagePlanVersion === identite.montagePlanVersion
    && rendu.methodeRendu === identite.methodeRendu;
}

export async function POST(
  req: NextRequest, { params }: { params: { montagePlanId: string } },
) {
  let place: { liberer(): void } | null = null;
  let libereeParLeTravail = false;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    if (!identifiantValide(params.montagePlanId)) {
      return refus('identifiant_invalide', 'Identifiant invalide.', 422);
    }

    // ── Le corps : rien, et tout paramètre est REFUSÉ ────────────────────
    const brut = (await req.text()).trim();
    if (brut.length > 0) {
      let json: unknown;
      try { json = JSON.parse(brut); } catch {
        return NextResponse.json({ ok: false, error: 'Corps JSON invalide' }, { status: 400 });
      }
      if (typeof json !== 'object' || json === null || Array.isArray(json)) {
        return NextResponse.json({ ok: false, error: 'Corps invalide' }, { status: 422 });
      }
      for (const interdit of CHAMPS_INTERDITS_RENDU) {
        if (Object.prototype.hasOwnProperty.call(json, interdit)) {
          return NextResponse.json(
            { ok: false, error: `Le champ « ${interdit} » est decide par le serveur.` },
            { status: 422 },
          );
        }
      }
    }

    // ── Le plan, et la propriété prouvée par la requête ──────────────────
    const { plan, motif: motifPlan } = await lirePlanParId(userId, params.montagePlanId);
    if (motifPlan === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    if (!plan) {
      return NextResponse.json({ ok: false, error: 'Plan introuvable' }, { status: 404 });
    }

    const identite: IdentiteRendu = {
      montagePlanId: plan.id,
      montagePlanVersion: plan.version,
      methodeRendu: METHODE_RENDU,
    };

    // ── Déjà rendu ? On sert l'existant, sans rien relancer ──────────────
    const existant = await lireRenduReussiIdentique(userId, identite);
    if (existant.motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    if (reutilisable(existant.rendu, identite)) {
      return NextResponse.json({
        ok: true, reutilise: true, rendu: renduPublic(existant.rendu!),
      });
    }

    // ── La place, AVANT la ligne ─────────────────────────────────────────
    //
    // Une place refusée ne doit laisser AUCUNE ligne derrière elle : sinon le
    // refus le plus bénin occuperait l'index actif et interdirait toute
    // relance pendant la péremption.
    place = prendrePlaceRendu();
    if (!place) {
      const actif = await lireRenduActif(userId, plan.id);
      return NextResponse.json({
        ok: false, motif: 'capacite_saturee' as MotifRendu,
        error: 'Un rendu est déjà en cours sur ce serveur.',
        rendu: actif.rendu ? renduPublic(actif.rendu) : null,
      }, {
        status: 429,
        // ⚠️ DÉRIVÉ DU PIRE CAS, comme le fait M3-F. Un 429 muet renvoie
        // l'utilisateur réessayer à l'aveugle, et une valeur empruntée à un
        // autre travail mentirait : un rendu tient sa place bien plus
        // longtemps qu'une extraction.
        headers: { 'Retry-After': String(Math.ceil(BUDGET_RENDU_MAX_MS / 1000)) },
      });
    }

    const creation = await creerRendu(userId, identite);
    if (creation.motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    if (creation.motif === 'rendu_actif' || creation.motif === 'rendu_concurrent') {
      // La base a refusé : un travail tourne déjà, ou vient d'aboutir. On
      // relit plutôt que d'échouer — l'écran doit pouvoir le suivre.
      const relu = await lireRenduReussiIdentique(userId, identite);
      if (reutilisable(relu.rendu, identite)) {
        return NextResponse.json({
          ok: true, reutilise: true, rendu: renduPublic(relu.rendu!),
        });
      }
      const actif = await lireRenduActif(userId, plan.id);
      return NextResponse.json({
        ok: false, motif: 'rendu_actif',
        error: 'Un rendu de ce montage est déjà en cours.',
        rendu: actif.rendu ? renduPublic(actif.rendu) : null,
      }, { status: 409 });
    }
    if (!creation.rendu) return refus('rendu_absent', 'Le rendu n’a pas pu être créé.', 500);

    const rendu = creation.rendu;
    const placeDuTravail = place;
    libereeParLeTravail = true;
    // ⚠️ LE TRAVAIL SURVIT À LA RÉPONSE. Le conteneur lance `node server.js`
    // et `output: 'standalone'` : le processus vit, rien ne gèle après le
    // `return`. Le `catch` est la ceinture qui rend la place si le travail
    // jetait avant d'entrer dans son propre `finally`.
    void executerRendu(userId, plan, rendu.id, placeDuTravail)
      .catch((e: unknown) => {
        // La ceinture, et elle ne se tait pas : une panne avant le `try` du
        // travail serait autrement invisible.
        console.error(
          `[autopilote][rendu] travail non démarré : ${diagnosticRendu(
            e instanceof Error ? e.message : String(e),
          )}`,
        );
        placeDuTravail.liberer();
      });

    return NextResponse.json(
      { ok: true, reutilise: false, rendu: renduPublic(rendu) }, { status: 202 },
    );
  } catch (e: unknown) {
    console.error(
      `[autopilote][rendu] panne inattendue : ${diagnosticRendu(
        e instanceof Error ? e.message : String(e),
      )}`,
    );
    return NextResponse.json(
      { ok: false, error: 'Une erreur interne est survenue.', motif: 'erreur_interne' },
      { status: 500 },
    );
  } finally {
    if (!libereeParLeTravail) place?.liberer();
  }
}

/**
 * Le travail détaché : produire, publier, consigner.
 *
 * La place est rendue par le TRAVAIL, pas par la réponse — c'est le patron de
 * M3-F, et `produireMontage` s'en charge dans son propre `finally`.
 */
async function executerRendu(
  userId: string,
  plan: Awaited<ReturnType<typeof lirePlanParId>>['plan'],
  renduId: string,
  place: { liberer(): void },
): Promise<void> {
  try {
    // ⚠️ AVEC LA GARDE, ET SON RETOUR LU. Entre l'insertion et cette écriture,
    // le plan peut disparaître en cascade : démarrer un encodage pour une
    // ligne qui n'existe plus, c'est brûler quatre cœurs pour rien.
    const depart = await majRendu(userId, renduId, {
      etat: 'en_cours', demarre: true, siEtat: ['en_attente'],
    });
    if (depart.motif === 'rendu_absent') return;
    await rendreEtPublier(
      {
        userId, plan: plan!,
        // Chaque frontière demande si la ligne existe encore. `rendu_absent`
        // est un ordre d'arrêt : on nettoie et on n'écrit plus rien.
        avancer: async (etape) => {
          const r = await majRendu(userId, renduId, { etape, siEtat: ['en_attente', 'en_cours'] });
          return r.motif === 'rendu_absent' ? 'rendu_absent' : null;
        },
      },
      renduId,
      {
        consigner: async (bucket, cle, mesure, usage): Promise<IssueConsignation> => {
          const r = await majRendu(userId, renduId, {
            etat: 'reussie', etape: 'televersement', termine: true,
            resultat: { ...mesure, bucket, cle },
            usage, siEtat: ['en_attente', 'en_cours'],
          });
          if (r.motif === 'rendu_absent') return 'rendu_absent';
          // ⚠️ TOUT AUTRE MOTIF EST UN ÉCHEC, PAS UNE RÉUSSITE. `socle_absent`
          // et `rendu_concurrent` laissent la ligne intacte : les traduire en
          // succès publierait un montage que la base ne référence pas.
          if (r.motif !== null || !r.rendu) return 'non_consigne';
          return 'consigne';
        },
        clore: async (motif, usage) => {
          await majRendu(userId, renduId, {
            etat: 'echouee', motifEchec: motif, termine: true, usage,
            siEtat: ['en_attente', 'en_cours'],
          });
        },
      },
      // ⚠️ LA PLACE DÉJÀ TENUE EST TRANSMISE. En laisser reprendre une seconde
      // ferait échouer chaque rendu en `capacite_saturee` : il n'y en a qu'une.
      place,
    );
  } catch (e: unknown) {
    // ⚠️ SANS CE `catch`, UNE PANNE DU TRAVAIL DÉTACHÉ EST TOTALEMENT MUETTE.
    // `majRendu` jette sur toute erreur que la persistance ne reconnaît pas ;
    // la ligne resterait `en_cours` et bloquerait le plan jusqu'à la
    // péremption, sans motif et sans journal. Même geste qu'en M3-F.
    console.error(
      `[autopilote][rendu] travail interrompu : ${diagnosticRendu(
        e instanceof Error ? e.message : String(e),
      )}`,
    );
    try {
      // ⚠️ PAS `encodage_echoue` : ON NE SAIT PAS QUE FFMPEG A CÉDÉ.
      //
      // Ce `catch` attrape TOUT ce que le travail détaché peut jeter — un
      // `majRendu` qui échoue pendant la mesure, un nettoyage de répertoire
      // qui jette après un montage parfaitement produit, une panne du socle.
      // Accuser l'encodage était une affirmation que rien n'établit, et qui
      // envoyait chercher la panne dans ffmpeg alors qu'il avait rendu 0.
      await majRendu(userId, renduId, {
        etat: 'echouee', motifEchec: MOTIF_RENDU_INTERROMPU, termine: true,
        siEtat: ['en_attente', 'en_cours'],
      });
    } catch { /* la ligne se fermera par péremption */ }
  } finally {
    place.liberer();
  }
}
