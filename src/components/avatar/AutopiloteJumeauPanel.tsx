'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bot, Check, Loader2, Mic } from 'lucide-react';
import { estEtatPret } from '@/lib/avatar/etats';
import { ETAT_SOURCE_PRETE } from '@/lib/avatar/contrat';
import type { ConfigJumeauNumerique } from '@/lib/avatar/jumeau';
import { EVENEMENT_VOIX_JUMEAU } from '@/lib/avatar/jumeau-creer';

/**
 * A_8f — « UTILISER MON CLONE DANS AUTOPILOTE ».
 *
 * ═════════════════════════════════════════════════════════════════════════
 * L'INTERRUPTEUR LE PLUS LOURD DU PRODUIT
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Il autorise un moteur automatique à produire, sans que personne ne regarde,
 * des vidéos où c'est LE VISAGE ET LA VOIX de quelqu'un qui parlent. Il est
 * donc éteint par défaut, il ne s'allume jamais tout seul, et il refuse de
 * s'allumer tant que le clone n'a pas été regardé et accepté.
 *
 * ⚠️ ET L'ÉCRAN DIT CE QUI MANQUE. Un interrupteur grisé sans explication
 * laisse chercher ; chaque état porte sa phrase et le geste qui débloque.
 */

interface Props {
  avatarId: string | null;
  statut: string | null;
  providerAvatarId?: string | null;
  valideLe?: string | null;
  /**
   * Les voix clonées du compte — `id` est `user_voices.id`, la référence
   * Studiio, jamais un identifiant de fournisseur. Vide = aucune voix prête.
   */
  voix: readonly { id: string; name: string }[];
}

type Etat = 'chargement' | 'pret' | 'envoi';

export default function AutopiloteJumeauPanel({
  avatarId, statut, providerAvatarId = null, valideLe = null, voix,
}: Props) {
  const [config, setConfig] = useState<ConfigJumeauNumerique | null>(null);
  const [etat, setEtat] = useState<Etat>('chargement');
  const [erreur, setErreur] = useState<string | null>(null);
  /* ⚠️ « MA VOIX » — A_8g. La voix retenue est celle que la personne a CHOISIE
     parmi ses propres voix clonées ; relue de la configuration, jamais
     devinée. Une seule voix au compte est retenue d'office — c'est la
     sienne, il n'y a rien à choisir. Plusieurs : le choix est explicite. */
  const [voixChoisie, setVoixChoisie] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      const j = await (await fetch('/api/autopilot/jumeau')).json();
      setConfig(j?.jumeau ?? null);
    } catch {
      setErreur('Votre configuration n’a pas pu être chargée.');
    } finally {
      setEtat('pret');
    }
  }, []);

  useEffect(() => { void charger(); }, [charger]);

  useEffect(() => {
    if (etat === 'chargement') return;
    const rangee = config?.userVoiceId ?? null;
    if (rangee && voix.some((v) => v.id === rangee)) { setVoixChoisie(rangee); return; }
    setVoixChoisie(voix.length === 1 ? voix[0].id : null);
  }, [etat, config?.userVoiceId, voix]);

  const cloneChezFournisseur = typeof providerAvatarId === 'string' && providerAvatarId.length > 0;
  const cloneEntraine = cloneChezFournisseur && estEtatPret(statut);
  const valide = typeof valideLe === 'string' && valideLe.length > 0;
  const voixPrete = voix.length > 0;

  /* ⚠️ LA VOIX N'EMPÊCHE PAS DE CONFIGURER, ELLE EMPÊCHE DE PRODUIRE. On peut
     préparer son clone avant d'avoir enregistré sa voix ; simplement, aucune
     vidéo ne partira tant qu'elle manque — et l'écran l'annonce. */
  const activable = avatarId !== null && cloneEntraine && valide;
  const actif = config?.active === true;
  const voixRetenue = voix.find((v) => v.id === (config?.userVoiceId ?? null)) ?? null;

  /** Une seule écriture pour l'interrupteur ET le choix de voix. */
  const enregistrer = async (jumeau: { active: boolean; userVoiceId: string | null }) => {
    if (etat === 'envoi') return;
    setEtat('envoi');
    setErreur(null);
    try {
      const res = await fetch('/api/autopilot/jumeau', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jumeau: {
            active: jumeau.active,
            avatarId,
            avatarVersion: config?.avatarVersion ?? null,
            userVoiceId: jumeau.userVoiceId,
          },
        }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) {
        setErreur(j?.error ?? 'Votre choix n’a pas pu être enregistré.');
        return;
      }
      setConfig(j.jumeau as ConfigJumeauNumerique);
      // Les panneaux voisins (prononciation) renomment la voix sans recharger.
      window.dispatchEvent(new Event(EVENEMENT_VOIX_JUMEAU));
    } catch {
      setErreur('Votre choix n’a pas pu être envoyé. Vérifiez votre connexion.');
    } finally {
      setEtat('pret');
    }
  };

  const basculer = async () => {
    if (!activable) return;
    await enregistrer({ active: !actif, userVoiceId: voixChoisie });
  };

  const choisirVoix = async (id: string) => {
    const retenue = id.length > 0 ? id : null;
    setVoixChoisie(retenue);
    /* Le choix est persisté tout de suite, avec l'état courant de
       l'interrupteur : il survit au rechargement et au prochain cycle. */
    if (avatarId !== null) await enregistrer({ active: actif, userVoiceId: retenue });
  };

  /** Ce qui manque, dit avec le geste qui débloque. */
  const empechement = (): string | null => {
    if (avatarId === null) return 'Créez et validez votre clone avant de l’utiliser dans Autopilote.';
    if (statut === ETAT_SOURCE_PRETE || !cloneChezFournisseur) {
      return 'Votre vidéo est prête, mais votre clone n’est pas encore entraîné.';
    }
    if (!cloneEntraine) return 'Votre clone est encore en cours de création.';
    if (!valide) return 'Regardez et validez votre clone avant de l’activer.';
    return null;
  };
  const bloquant = empechement();

  return (
    <div className="card-base p-6 space-y-4" data-jumeau>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
          <Bot className="w-5 h-5 text-cyan-300" />
        </div>
        <div className="min-w-0">
          <h2 className="font-semibold">Utilisation dans Autopilote</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            Autopilote peut produire vos vidéos avec votre clone. Cette option
            est désactivée tant que vous ne l’activez pas vous-même.
          </p>
        </div>
      </div>

      {erreur && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {erreur}
        </div>
      )}

      {etat === 'chargement' ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Chargement…
        </div>
      ) : (
        <>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={actif}
              disabled={!activable || etat === 'envoi'}
              onChange={basculer}
              data-jumeau-toggle
              className="mt-0.5 accent-cyan-600 disabled:opacity-40"
            />
            <span className={activable ? 'text-gray-200' : 'text-gray-500'}>
              Utiliser mon clone dans Autopilote
            </span>
          </label>

          {bloquant && (
            <p className="text-xs text-gray-500" data-jumeau-empechement>{bloquant}</p>
          )}

          {/* ── MA VOIX — A_8g ────────────────────────────────────────────
              Uniquement les voix clonées DU COMPTE, désignées par leur nom.
              Aucune voix de catalogue, aucun identifiant de fournisseur. */}
          {voixPrete && (
            <div className="space-y-1.5" data-jumeau-voix>
              <label className="block text-sm font-medium" htmlFor="jumeau-voix">Ma voix</label>
              <select
                id="jumeau-voix"
                value={voixChoisie ?? ''}
                onChange={(e) => { void choisirVoix(e.target.value); }}
                disabled={etat === 'envoi'}
                data-jumeau-voix-choix
                className="w-full rounded-xl bg-gray-900 border border-gray-800 focus:border-cyan-500 outline-none p-2.5 text-sm disabled:opacity-50"
              >
                {voix.length > 1 && <option value="">Choisir ma voix</option>}
                {voix.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500">
                Autopilote fera parler votre clone avec cette voix — la vôtre,
                clonée par vous. Aucune autre voix ne sera utilisée à sa place.
              </p>
            </div>
          )}

          {/* ⚠️ ACTIVÉ SANS VOIX : ON LE DIT, ET ON DIT LA CONSÉQUENCE. */}
          {activable && !voixPrete && (
            <div
              className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
              data-jumeau-voix-manquante
            >
              <Mic className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
              <div className="text-amber-100/80">
                <div className="font-medium text-amber-200">Voix à configurer</div>
                Configurez votre voix avant d’utiliser votre clone. Autopilote
                utilisera votre clone uniquement lorsque votre voix sera prête.{' '}
                <a href="#ma-voix" className="underline text-amber-200">Enregistrer ma voix</a>
              </div>
            </div>
          )}

          {activable && voixPrete && voixChoisie === null && (
            <p className="text-xs text-amber-200/80" data-jumeau-voix-a-choisir>
              Choisissez votre voix : Autopilote ne produira rien avec votre
              clone tant qu’aucune voix n’est retenue.
            </p>
          )}

          {actif && voixRetenue && (
            <div
              className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm"
              data-jumeau-pret
            >
              <Check className="w-4 h-4 text-emerald-300 flex-shrink-0 mt-0.5" />
              <div className="text-emerald-100/80">
                <div className="font-medium text-emerald-200">Prêt pour Autopilote</div>
                Vos prochaines vidéos automatiques utiliseront votre clone et
                votre voix « {voixRetenue.name} ».
              </div>
            </div>
          )}

          {/* ⚠️ CE QUI N'EST PAS ENCORE LÀ EST DIT, PAS SUGGÉRÉ. */}
          {actif && (
            <div
              className="flex items-start gap-3 rounded-xl border border-gray-700 bg-gray-900/60 p-3 text-xs text-gray-400"
              data-jumeau-attente-integration
            >
              <AlertTriangle className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
              <span>
                La génération avec votre clone sera activée prochainement. D’ici
                là, Autopilote ne produira pas de vidéo à votre place plutôt que
                d’en produire une sans vous.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
