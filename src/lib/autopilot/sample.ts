import { generateSmartContent } from '@/lib/smart-content';
import { THEMES } from '@/lib/themes';
import { posterQuery } from '@/lib/autopilot/poster';
import type { AutopilotConfig } from '@/lib/autopilot/rules';

/**
 * L'ÉCHANTILLON montré dans l'aperçu de l'Autopilote.
 *
 * ⚠️ CE N'EST PAS LA PROCHAINE VIDÉO, ET IL NE FAUT PAS LE LAISSER CROIRE.
 * L'Autopilote tire son sujet, son affiche et son rush à chaque cycle : rien
 * de ce qui est montré ici ne sera reproduit à l'identique. Ce que l'aperçu
 * prouve, c'est le STYLE — les couleurs, le fond des cartes, la mise en page —
 * qui, lui, est constant. L'écran doit le dire, et le dit.
 *
 * Fonctions PURES : aucun React, aucun réseau. C'est ce qui les rend
 * vérifiables sur des valeurs, alors qu'un aperçu ne se constate autrement
 * qu'à l'œil.
 */

/**
 * Le thème qui sert d'échantillon.
 *
 * Le PREMIER thème coché, parce que c'est celui que l'utilisateur reconnaîtra
 * — montrer un sujet qu'il a justement décoché serait une réponse à côté.
 * Sans aucun choix, la rotation parcourt les douze thèmes : le premier de la
 * liste les représente aussi bien qu'un autre.
 *
 * ⚠️ UN THÈME PERSONNALISÉ EST RENDU TEL QUEL. Il ne figure dans aucune liste
 * — le filtrer sur les thèmes connus le remplacerait silencieusement par
 * « Sommeil », et l'utilisateur croirait son thème ignoré par le moteur.
 */
export function sampleTopic(topics: string[] | undefined | null): string {
  const propre = (topics ?? []).map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean);
  return propre[0] || THEMES[0].topic;
}

/**
 * Graine du contenu d'échantillon.
 *
 * ⚠️ ELLE NE DÉPEND QUE DU SUJET, VOLONTAIREMENT. Le moteur, lui, fait varier
 * la sienne à chaque cycle (`contentSeed`) — c'est ce qui donne des textes
 * différents d'une vidéo à l'autre. Ici, l'inverse est recherché : régler une
 * couleur ne doit pas réécrire tout le texte sous les yeux de l'utilisateur.
 * Un aperçu qui change à chaque frappe empêche justement de comparer.
 */
export function sampleSeed(topic: string): number {
  let n = 0;
  for (const c of topic) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return n % 100_000;
}

export interface AutopilotSample {
  /** Sujet retenu — celui affiché sous l'aperçu. */
  topic: string;
  title: string;
  subtitle: string;
  cards: Array<{ icon: string; title: string; description: string; value: string }>;
  cta: string;
  ctaSub: string;
  /** Mots-clés de la banque d'images, pour aller chercher une affiche d'exemple. */
  posterQuery: string;
}

/**
 * Contenu d'exemple pour un thème.
 *
 * ⚠️ MÊME GÉNÉRATEUR QUE LE MOTEUR. `preparePosts` appelle `generateSmartContent`
 * sur le même sujet, et en tire le titre, le sous-titre, les cartes et le CTA
 * de la même façon (`title = topic`, `tagLine` en CTA). Un second assemblage
 * écrit ici aurait montré une mise en page que l'Autopilote ne produit pas —
 * et l'écart ne se serait vu qu'en comparant une vraie vidéo à l'aperçu.
 */
export function buildAutopilotSample(config: Pick<AutopilotConfig, 'topics'>): AutopilotSample {
  const topic = sampleTopic(config.topics);
  const contenu = generateSmartContent(topic, sampleSeed(topic));
  return {
    topic,
    // Le moteur met le titre en capitales (`post.title.toUpperCase()`) et
    // `SequenceTitle` le fait de toute façon : on montre ce qui sera rendu.
    title: topic.toUpperCase(),
    subtitle: contenu.subtitle,
    cards: contenu.cards.slice(0, 5).map((c) => ({
      icon: c.icon, title: c.title, description: c.description, value: c.value,
    })),
    // `tagLine` EST le CTA du moteur — voir `buildAutopilotDesign`.
    cta: contenu.tagLine,
    ctaSub: '',
    posterQuery: posterQuery(topic),
  };
}

/**
 * L'affiche doit-elle être peinte sur la séquence affichée ?
 *
 * ⚠️ C'EST LA MÊME RÈGLE QUE LE RENDU (`backgroundFor` dans
 * `CreerSimpleMontage`), et il faut qu'elle le reste : un aperçu qui montre
 * les cartes sur une photo alors que la vidéo les pose sur les couleurs vaut
 * moins que pas d'aperçu du tout. La séquence titre garde l'affiche en toutes
 * circonstances ; cartes, vidéo et CTA ne l'ont que si l'utilisateur l'a
 * demandé.
 *
 * `'all'` empile les séquences sur un seul plateau — l'aperçu n'a qu'un fond
 * pour les trois. C'est celui de l'intro qui est montré, comme dans
 * l'assistant.
 */
export function samplePosterVisible(
  focus: 'all' | 'intro' | 'cards' | 'video' | 'cta',
  cardsShowPoster: boolean,
): boolean {
  if (focus === 'all' || focus === 'intro') return true;
  return cardsShowPoster;
}
