import { langueParleeValide, type LangueParlee } from '@/lib/voice/spoken-text';

/**
 * A_8g — LA VOIX DU JUMEAU EST LA VOIX DE LA PERSONNE, ET RIEN D'AUTRE.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * CE QUE CE MODULE DECIDE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * `ConfigJumeauNumerique.userVoiceId` designe une ligne de `user_voices` —
 * la table A_6 qui, seule, dit a qui appartient une voix clonee. Ce module
 * repond a une question et une seule : cette ligne peut-elle PARLER pour ce
 * compte ? Il ne choisit jamais a la place de la personne.
 *
 * ⚠️ AUCUN REPLI. Pas de voix de catalogue, pas de premiere voix trouvee, pas
 * de voix « par defaut ». Une voix absente, etrangere ou sans consentement
 * rend un motif nomme — et la generation s'arrete la, en le disant.
 *
 * ⚠️ LA CONFIGURATION NE FAIT PAS AUTORITE. Elle dit ce que la personne a
 * DEMANDE ; c'est la ligne relue — avec son `user_id` — qui dit ce qui est
 * vrai. Un identifiant injecte par le navigateur ne vaut donc rien tant que
 * la base ne l'a pas confirme sous le compte de la session.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * « PRETE » — CE QUE LE MODELE A_6 PERMET DE DIRE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * `user_voices` n'a pas de colonne d'etat : une ligne n'y est ecrite qu'apres
 * un clonage REUSSI, avec son identifiant fournisseur et sa preuve datee de
 * consentement. « Prete » veut donc dire : la ligne existe, elle appartient
 * au compte, `provider_voice_id` est rempli, `consent_at` est rempli. Il
 * n'y a pas de « version » de voix non plus ; on n'en invente pas.
 */

/** Ce que le portail a besoin de savoir d'une voix, et rien de plus. */
export interface VoixPourJumeau {
  id?: unknown;
  user_id?: unknown;
  provider?: unknown;
  provider_voice_id?: unknown;
  name?: unknown;
  lang?: unknown;
  consent_at?: unknown;
}

/** La voix retenue pour faire parler le jumeau. */
export interface VoixJumeau {
  /** La reference STUDIIO — `user_voices.id`. C'est elle l'identite metier. */
  userVoiceId: string;
  /** L'identifiant chez le fournisseur : un detail de synthese, jamais une identite. */
  providerVoiceId: string;
  provider: string;
  nom: string | null;
  /** La langue declaree au clonage, ramenee au vocabulaire A_8d. */
  langue: LangueParlee;
}

export type MotifVoixJumeau = 'voix_absente' | 'voix_etrangere';

export type IssueVoixJumeau =
  | { ok: true; voix: VoixJumeau }
  | { ok: false; motif: MotifVoixJumeau };

const texte = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/**
 * Cette ligne peut-elle faire parler le jumeau de CE compte ?
 *
 * FONCTION PURE. Elle recoit la ligne telle que la base l'a rendue (deja
 * filtree par compte ou non — elle reverifie de toute facon) et decide sur
 * des valeurs.
 */
export function voixJumeauUtilisable(entree: {
  userId: string;
  userVoiceId: string | null | undefined;
  voix: VoixPourJumeau | null | undefined;
}): IssueVoixJumeau {
  const { userId, userVoiceId, voix } = entree;
  if (!userId || !userVoiceId) return { ok: false, motif: 'voix_absente' };
  if (!voix || voix.id !== userVoiceId) return { ok: false, motif: 'voix_absente' };
  if (voix.user_id !== userId) return { ok: false, motif: 'voix_etrangere' };

  /* ⚠️ SANS IDENTIFIANT FOURNISSEUR NI PREUVE DE CONSENTEMENT, CE N'EST PAS UNE
     VOIX PRETE. Le consentement est relu ICI, a l'usage — pas seulement au
     clonage : une ligne ecrite par une autre version du code ne fait pas
     parler quelqu'un sans preuve datee. */
  const providerVoiceId = texte(voix.provider_voice_id);
  const consentement = texte(voix.consent_at);
  if (!providerVoiceId || !consentement) return { ok: false, motif: 'voix_absente' };

  return {
    ok: true,
    voix: {
      userVoiceId,
      providerVoiceId,
      provider: texte(voix.provider) ?? 'elevenlabs',
      nom: texte(voix.name),
      langue: langueParleeValide(voix.lang),
    },
  };
}
