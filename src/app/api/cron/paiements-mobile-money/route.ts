import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron/auth';
import {
  depotsAbandonnesARelire, depotsEnAttente, SocleAbsent, MESSAGE_SOCLE_ABSENT,
} from '@/lib/paiements/pawapay/depots';
import { reconcilier } from '@/lib/paiements/pawapay/confirmation';
import { lecteurEtat } from '@/lib/paiements/pawapay/lecteur';
import { etatMobileMoney } from '@/lib/paiements/mobile-money';

/**
 * RÉCONCILIATION AUTOMATIQUE DES PAIEMENTS MOBILE MONEY.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI ELLE NE PEUT PAS RESTER MANUELLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le prestataire n'accepte qu'UNE adresse de notification par compte
 * marchand, et celle du compte est celle d'afroboost, qui répartit ensuite
 * vers les applications qu'il connaît. Studiio n'y figure pas, et l'y
 * inscrire supposerait de modifier afroboost.
 *
 * La notification n'arrive donc pas jusqu'ici. Ce n'est pas un problème de
 * correction — la relecture du dépôt auprès du prestataire, avec notre
 * propre jeton, prouve le paiement sans dépendre de personne. Mais tant que
 * cette relecture n'était déclenchée QUE par un bouton d'administration, un
 * client ayant payé attendait qu'un humain veuille bien cliquer. C'est ce
 * que ce cron corrige : la vérification indépendante devient réellement
 * indépendante.
 *
 * ⚠️ IL NE CRÉDITE RIEN LUI-MÊME. Il appelle le chemin unique
 * (`confirmerDepot`), qui interroge le prestataire, vérifie le montant et la
 * devise, et s'appuie sur l'index unique pour qu'un dépôt ne soit crédité
 * qu'une fois. Le rejouer plus souvent ne crédite pas davantage.
 *
 * Cadence raisonnable : toutes les deux à cinq minutes. Plus souvent n'aide
 * pas — le paiement, lui, prend le temps qu'il prend.
 */
export const dynamic = 'force-dynamic';

async function executer(req: NextRequest) {
  // Même garde et même corps de refus que les autres crons maison : le test
  // `securite-cron-secret` les éprouve tous de la même façon, et une route qui
  // répondrait autrement passerait à côté de cette vérification commune.
  if (!isCronAuthorized(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Service fermé : rien à relire, et surtout aucun appel sortant.
  const etat = etatMobileMoney();
  if (!etat.actif) {
    return NextResponse.json({ success: true, ignore: true, motif: etat.motif });
  }

  try {
    const lire = lecteurEtat();
    const bilan = await reconcilier(await depotsEnAttente(50), lire);
    const rattrapage = await reconcilier(
      await depotsAbandonnesARelire(10), lire, { fermerLesAbandonnes: false },
    );

    const total = { ...bilan, rattrapage };
    // Journalisé à chaque passage : c'est la trace qui permet de voir, sans
    // ouvrir l'écran, que les crédits arrivent bien sans la notification.
    console.info('[cron mobile money] réconciliation', total);
    return NextResponse.json({ success: true, bilan: total });
  } catch (e) {
    if (e instanceof SocleAbsent) {
      return NextResponse.json(
        { success: false, code: 'socle_absent', error: MESSAGE_SOCLE_ABSENT },
        { status: 503 },
      );
    }
    console.error('[cron mobile money] échec :', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { success: false, error: 'La réconciliation automatique a échoué.' },
      { status: 503 },
    );
  }
}

/**
 * `GET` parce que c'est ainsi que le planificateur appelle les crons maison.
 * `POST` est accepté aussi : l'action modifie bien un état, et un déclencheur
 * qui préfère la forme correcte ne doit pas être renvoyé à une erreur.
 */
export const GET = executer;
export const POST = executer;
