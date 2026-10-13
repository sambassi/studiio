import { buildAutopilotSample } from '@/lib/autopilot/sample';
import { pickTopics } from '@/lib/autopilot/topics';
import { signatureContenu } from '@/lib/creer/signature-contenu';
import type { AutopilotConfig } from '@/lib/autopilot/rules';

/**
 * Le contenu de « Produire un brouillon maintenant ».
 *
 * ⚠️ LE BUG QU'IL FERME. Le serveur tirait son PROPRE sujet (rotation sur les
 * douze thèmes quand aucun n'est coché) avec une graine à la minute, pendant
 * que l'aperçu montrait le premier thème avec une autre graine. L'utilisateur
 * réglait « Danse » et recevait « NUTRITION — Nutrition et microbiote… » dans
 * le Calendrier : un autre projet que celui qu'il venait de voir.
 *
 * Quand l'écran envoie l'empreinte de son aperçu, le serveur RECALCULE cet
 * aperçu depuis la configuration enregistrée (il ne fait pas confiance au
 * texte du client) et produit exactement ce sujet et cette variante. Si
 * l'empreinte ne correspond plus — configuration modifiée entre-temps, autre
 * onglet — on refuse plutôt que de produire autre chose que ce qui est affiché.
 *
 * Sans empreinte (ancien écran) : la rotation d'avant, inchangée.
 */
export type ContenuManuel =
  | { ok: true; topic: string; seeds?: number[]; depuisApercu: boolean; contenuSignature: string | null }
  | { ok: false; code: 'apercu-perime'; message: string };

/** Empreinte de l'aperçu Autopilote — celle que l'écran envoie. */
export function signatureApercuAutopilote(config: Pick<AutopilotConfig, 'topics' | 'brief'>): string {
  const s = buildAutopilotSample(config);
  return signatureContenu({ title: s.title, subtitle: s.subtitle, cards: s.cards, cta: s.cta, ctaSub: s.ctaSub });
}

export function choisirContenuManuel(input: {
  config: Pick<AutopilotConfig, 'topics' | 'brief'>;
  /** Empreinte de l'aperçu affiché, envoyée par l'écran ; absente = ancien comportement. */
  apercuSignature?: string | null;
  recents: string[];
  now: number;
}): ContenuManuel {
  const { config, apercuSignature, recents, now } = input;
  if (typeof apercuSignature === 'string' && apercuSignature) {
    const sample = buildAutopilotSample(config);
    const attendue = signatureContenu({
      title: sample.title, subtitle: sample.subtitle, cards: sample.cards, cta: sample.cta, ctaSub: sample.ctaSub,
    });
    if (attendue !== apercuSignature) {
      return {
        ok: false,
        code: 'apercu-perime',
        message: 'L’aperçu a changé depuis l’affichage (réglages modifiés). Rechargez la page puis relancez : rien n’a été produit ni débité.',
      };
    }
    return { ok: true, topic: sample.topic, seeds: [sample.seed], depuisApercu: true, contenuSignature: attendue };
  }
  const [topic] = pickTopics({
    count: 1,
    exclude: recents,
    // À la minute et non au jour : deux essais manuels dans la journée ne
    // doivent pas retomber sur le même sujet.
    seed: Math.floor(now / 60_000),
    pool: config.topics.length ? config.topics : undefined,
  });
  return { ok: true, topic, depuisApercu: false, contenuSignature: null };
}
