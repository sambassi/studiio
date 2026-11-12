'use client';

/**
 * Tarifs & crédits — `/admin/tarifs`.
 *
 * Écran de la grille tarifaire (`lib/tarifs`). La garde est côté serveur
 * (`/api/admin/tarifs` → `requireAdmin`, 401/403) ; le layout admin ne fait
 * que masquer l'écran. Rien n'est écrit sans la confirmation explicite qui
 * liste chaque changement, et seuls les champs modifiés sont envoyés.
 *
 * ⚠️ « Valeur du crédit » et « coût fournisseur » sont INFORMATIFS : ils ne
 * touchent ni Stripe ni aucun prix débité.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ChevronDown, Coins, Gift, History, Loader2, RefreshCw, Save, Sparkles,
  ShieldAlert, TrendingUp, X,
} from 'lucide-react';
import {
  CATALOGUE_TARIFS, LIBELLE_CATEGORIE, TARIF_MAX, TARIFS_GRATUITS,
  type CategorieTarif, type CleTarif, type CoutFournisseur, type EntreeCatalogue,
} from '@/lib/tarifs/catalogue';
import { ETAT_INTERACTIF_SANS_FOND } from '@/lib/ui/etats';
import type { LigneRentabilite, ResumeRentabilite } from '@/lib/tarifs/rentabilite';
import type { TauxChange } from '@/lib/tarifs/change';

interface LigneHistorique { cle: string; ancien: unknown; nouveau: unknown; admin: string; le: string }

interface ReponseTarifs {
  catalogue?: EntreeCatalogue[];
  gratuits?: ReadonlyArray<{ libelle: string; prix: string }>;
  max?: number;
  prix: Record<string, number>;
  valeurCreditChf: number | null;
  coutsFournisseur: Partial<Record<string, CoutFournisseur>>;
  source: 'configuration' | 'defaut';
  historique?: LigneHistorique[];
  /** Taux USD → CHF enregistré, daté. `null` = marges en USD non calculées. */
  change?: TauxChange | null;
  /** Rentabilité de la grille ENREGISTRÉE (pas de la saisie en cours). */
  rentabilite?: LigneRentabilite[];
  resumeRentabilite?: ResumeRentabilite;
  /** Marge visée, en fraction (0,4 = 40 %). */
  margeCible?: number;
  changeLibelle?: string;
  changePerime?: boolean;
}

interface CoutSaisi { chf: string; unite: string }

const ORDRE_CATEGORIES: CategorieTarif[] = ['audio', 'video', 'avatar', 'ia', 'autres'];
const VALEUR_CREDIT_MAX_CHF = 100;
const COUT_MAX_CHF = 10_000;
const CHAMP_VALEUR_CREDIT = 'valeurCreditChf';
const CHAMP_CHANGE = 'change';
const TAUX_MIN = 0.1;
const TAUX_MAX = 10;

/** Miroir de `normaliserTaux` côté serveur : un taux sans date n'est pas un taux. */
function erreurTaux(chfParUsd: string, le: string): string | null {
  const brut = chfParUsd.trim();
  if (brut === '' && le.trim() === '') return null;
  if (brut === '') return 'Taux requis (ou efface la date).';
  const n = Number(brut.replace(',', '.'));
  if (!Number.isFinite(n) || n < TAUX_MIN || n > TAUX_MAX) return `Taux entre ${TAUX_MIN} et ${TAUX_MAX} attendu.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(le.trim())) return 'Date du taux requise (AAAA-MM-JJ).';
  return null;
}

const CHAMP_MARGE = 'margeCible';

/** Marge saisie en POURCENTAGE à l'écran, stockée en fraction côté serveur. */
function erreurMarge(saisie: string): string | null {
  const t = saisie.trim();
  if (t === '') return null;
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 1000) return 'Pourcentage entre 0 et 1000 attendu.';
  return null;
}

const STYLE_VERDICT: Record<LigneRentabilite['verdict'], { classe: string; texte: string }> = {
  perte: { classe: 'border-red-500/40 bg-red-500/10 text-red-300', texte: 'Vendu à perte' },
  inconnu: { classe: 'border-amber-500/40 bg-amber-500/10 text-amber-300', texte: 'Rentabilité inconnue' },
  rentable: { classe: 'border-green-500/40 bg-green-500/10 text-green-300', texte: 'Rentable' },
};

const champCout = (cle: string) => `cout:${cle}`;

/** Entier ≥ 0 ≤ max — miroir de `tarifValide` côté serveur. */
function erreurPrix(saisie: string, max: number): string | null {
  const t = saisie.trim();
  if (t === '') return 'Valeur requise.';
  if (!/^-?\d+$/.test(t)) return 'Nombre entier attendu.';
  const n = Number(t);
  if (n < 0) return 'Le tarif ne peut pas être négatif.';
  if (n > max) return `Maximum ${max.toLocaleString('fr-CH')} crédits.`;
  return null;
}

function lireDecimal(saisie: string): number | null {
  const t = saisie.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function erreurValeurCredit(saisie: string): string | null {
  const n = lireDecimal(saisie);
  if (n === null) return null; // vide = non renseignée
  if (Number.isNaN(n) || n <= 0 || n > VALEUR_CREDIT_MAX_CHF) return `Montant entre 0 et ${VALEUR_CREDIT_MAX_CHF} CHF attendu.`;
  return null;
}

function erreurCout(saisie: string): string | null {
  const n = lireDecimal(saisie);
  if (n === null) return null;
  if (Number.isNaN(n) || n < 0 || n > COUT_MAX_CHF) return 'Coût fournisseur invalide.';
  return null;
}

const chf = (n: number) => `${n.toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} CHF`;
const credits = (n: number) => `${n} crédit${n > 1 ? 's' : ''}`;

function libelleCle(cle: string): string {
  if (cle === 'credit.value_chf') return 'Valeur du crédit';
  if (cle.startsWith('cost.')) {
    const e = CATALOGUE_TARIFS.find((x) => x.cle === cle.slice(5));
    return `Coût fournisseur — ${e?.libelle ?? cle.slice(5)}`;
  }
  return CATALOGUE_TARIFS.find((e) => e.cle === cle)?.libelle ?? cle;
}

function valeurHistorique(cle: string, v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') {
    const c = v as { chf?: unknown; unite?: unknown };
    return typeof c.chf === 'number' ? `${chf(c.chf)}${c.unite ? ` / ${c.unite}` : ''}` : '—';
  }
  if (typeof v === 'number') return cle === 'credit.value_chf' ? chf(v) : String(v);
  return String(v);
}

function dateFr(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fr-CH', { dateStyle: 'short', timeStyle: 'short' });
}

function uniteAffichee(e: EntreeCatalogue): string {
  return e.cle === 'audio.full_1000_chars' ? 'crédit(s) par 1000 caractères' : e.unite;
}

interface Changement { champ: string; phrase: string }

// ─────────────────────────────────────────────────────────────────────────
// Dialogue de confirmation
// ─────────────────────────────────────────────────────────────────────────

function DialogueConfirmation({
  changements, envoi, onAnnuler, onConfirmer,
}: { changements: Changement[]; envoi: boolean; onAnnuler: () => void; onConfirmer: () => void }) {
  const boutonAnnuler = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    boutonAnnuler.current?.focus();
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape' && !envoi) onAnnuler(); };
    window.addEventListener('keydown', echap);
    return () => window.removeEventListener('keydown', echap);
  }, [envoi, onAnnuler]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !envoi) onAnnuler(); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="titre-confirmation-tarifs"
        data-testid="confirmation-tarifs"
        className="w-full max-w-md card-base flex flex-col"
        style={{ maxHeight: '85vh', padding: 0 }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-5 py-4">
          <h2 id="titre-confirmation-tarifs" className="text-lg font-bold text-white">Confirmer les nouveaux tarifs</h2>
          <button
            type="button"
            onClick={onAnnuler}
            disabled={envoi}
            aria-label="Fermer"
            className={`rounded-md text-gray-400 hover:text-white ${ETAT_INTERACTIF_SANS_FOND}`}
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 text-sm text-gray-400">
            Les nouveaux prix s’appliquent dès la prochaine opération, sans redéploiement. Une opération déjà lancée garde son prix.
          </p>
          <ul className="space-y-2">
            {changements.map((c) => (
              <li key={c.champ} className="rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-2 text-sm text-gray-200">
                {c.phrase}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-800 px-5 py-4">
          <button
            ref={boutonAnnuler}
            type="button"
            onClick={onAnnuler}
            disabled={envoi}
            className="rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-300 hover:text-white disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirmer}
            disabled={envoi}
            className="flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
          >
            {envoi ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Confirmer
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

export default function TarifsAdminPage() {
  const [donnees, setDonnees] = useState<ReponseTarifs | null>(null);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);

  const [prix, setPrix] = useState<Record<string, string>>({});
  const [valeurCredit, setValeurCredit] = useState('');
  const [couts, setCouts] = useState<Record<string, CoutSaisi>>({});
  const [taux, setTaux] = useState({ chfParUsd: '', le: '' });
  const [sourceTaux, setSourceTaux] = useState<string>('');
  const [margeCible, setMargeCible] = useState('');
  const [lectureTaux, setLectureTaux] = useState(false);

  const [fermees, setFermees] = useState<Partial<Record<CategorieTarif, boolean>>>({});
  const [confirmation, setConfirmation] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreursServeur, setErreursServeur] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ texte: string; type: 'succes' | 'erreur' } | null>(null);

  const catalogue = CATALOGUE_TARIFS;
  const max = donnees?.max ?? TARIF_MAX;

  const appliquerDonnees = useCallback((d: ReponseTarifs) => {
    setDonnees(d);
    setPrix(Object.fromEntries(CATALOGUE_TARIFS.map((e) => [e.cle, String(d.prix?.[e.cle] ?? e.defaut)])));
    setValeurCredit(d.valeurCreditChf === null || d.valeurCreditChf === undefined ? '' : String(d.valeurCreditChf));
    setCouts(Object.fromEntries(CATALOGUE_TARIFS.map((e) => {
      const c = d.coutsFournisseur?.[e.cle];
      return [e.cle, { chf: c ? String(c.chf) : '', unite: c?.unite ?? '' }];
    })));
    setTaux({ chfParUsd: d.change ? String(d.change.chfParUsd) : '', le: d.change?.le ?? '' });
    setMargeCible(d.margeCible === undefined || d.margeCible === null ? '' : String(Math.round(d.margeCible * 100)));
    setSourceTaux(d.change?.source ?? '');
    setErreursServeur({});
  }, []);

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/tarifs', { cache: 'no-store' });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.prix) { setErreurChargement(j?.error || 'Lecture des tarifs impossible.'); return; }
      setErreurChargement(null);
      appliquerDonnees(j as ReponseTarifs);
    } catch {
      setErreurChargement('Lecture des tarifs impossible.');
    }
  }, [appliquerDonnees]);

  useEffect(() => { charger(); }, [charger]);

  /**
   * Lit le taux de référence et REMPLIT le champ, sans rien enregistrer :
   * l'admin voit la valeur et sa date, puis confirme comme n'importe quel
   * autre changement.
   */
  const lireTauxReference = useCallback(async () => {
    setLectureTaux(true);
    setMessage(null);
    try {
      const r = await fetch('/api/admin/tarifs/taux', { cache: 'no-store' });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.change) {
        setMessage({ texte: j?.error || 'Taux de référence indisponible.', type: 'erreur' });
        return;
      }
      const c = j.change as TauxChange;
      setTaux({ chfParUsd: String(c.chfParUsd), le: c.le });
      setSourceTaux(c.source);
      setErreursServeur((e) => { const { [CHAMP_CHANGE]: _, ...r2 } = e; return r2; });
    } catch {
      setMessage({ texte: 'Taux de référence indisponible.', type: 'erreur' });
    } finally {
      setLectureTaux(false);
    }
  }, []);

  /** Rentabilité enregistrée, indexée par clé de tarif. */
  const rentabiliteParCle = useMemo(
    () => new Map((donnees?.rentabilite ?? []).map((l) => [l.cle as string, l])),
    [donnees],
  );

  // ── Validation (miroir serveur) ────────────────────────────────────────
  const erreursClient = useMemo(() => {
    const out: Record<string, string> = {};
    for (const e of catalogue) {
      const m = erreurPrix(prix[e.cle] ?? '', max);
      if (m) out[e.cle] = m;
      const mc = erreurCout(couts[e.cle]?.chf ?? '');
      if (mc) out[champCout(e.cle)] = mc;
    }
    const mv = erreurValeurCredit(valeurCredit);
    if (mv) out[CHAMP_VALEUR_CREDIT] = mv;
    const mt = erreurTaux(taux.chfParUsd, taux.le);
    if (mt) out[CHAMP_CHANGE] = mt;
    const mm = erreurMarge(margeCible);
    if (mm) out[CHAMP_MARGE] = mm;
    return out;
  }, [catalogue, prix, couts, valeurCredit, taux, margeCible, max]);

  // ── Ce qui a changé ────────────────────────────────────────────────────
  const diff = useMemo(() => {
    const corps: {
      prix?: Record<string, number>;
      valeurCreditChf?: number | null;
      coutsFournisseur?: Record<string, CoutFournisseur | null>;
      change?: TauxChange | null;
      margeCible?: number;
    } = {};
    const lignes: Changement[] = [];
    if (!donnees) return { corps, lignes };
    for (const e of catalogue) {
      const saisie = (prix[e.cle] ?? '').trim();
      const avant = donnees.prix?.[e.cle] ?? e.defaut;
      if (saisie !== '' && /^-?\d+$/.test(saisie) && Number(saisie) !== avant) {
        const apres = Number(saisie);
        (corps.prix ??= {})[e.cle] = apres;
        lignes.push({ champ: e.cle, phrase: `Passer ${e.libelle} de ${avant} à ${credits(apres)} ?` });
      }
      const c = couts[e.cle] ?? { chf: '', unite: '' };
      const ancien = donnees.coutsFournisseur?.[e.cle] ?? null;
      const n = lireDecimal(c.chf);
      const nouveau: CoutFournisseur | null = n === null || Number.isNaN(n) ? null : { chf: n, unite: c.unite.trim().slice(0, 40) };
      const egal = (ancien === null && nouveau === null)
        || (ancien !== null && nouveau !== null && ancien.chf === nouveau.chf && (ancien.unite ?? '') === nouveau.unite);
      if (!egal && !(n !== null && Number.isNaN(n))) {
        (corps.coutsFournisseur ??= {})[e.cle] = nouveau;
        lignes.push({
          champ: champCout(e.cle),
          phrase: nouveau
            ? `Coût fournisseur estimé de ${e.libelle} : ${ancien ? valeurHistorique('', ancien) : 'non renseigné'} → ${valeurHistorique('', nouveau)} ?`
            : `Effacer le coût fournisseur estimé de ${e.libelle} ?`,
        });
      }
    }
    const v = lireDecimal(valeurCredit);
    const avantV = donnees.valeurCreditChf ?? null;
    if (!(v !== null && Number.isNaN(v)) && v !== avantV) {
      corps.valeurCreditChf = v;
      lignes.push({
        champ: CHAMP_VALEUR_CREDIT,
        phrase: v === null
          ? 'Effacer la valeur indicative du crédit ?'
          : `Passer la valeur du crédit de ${avantV === null ? 'non renseignée' : chf(avantV)} à ${chf(v)} ?`,
      });
    }
    const nTaux = lireDecimal(taux.chfParUsd);
    const avantTaux = donnees.change ?? null;
    const apresTaux: TauxChange | null = nTaux === null || Number.isNaN(nTaux) || !/^\d{4}-\d{2}-\d{2}$/.test(taux.le.trim())
      ? null
      : { chfParUsd: nTaux, le: taux.le.trim(), source: sourceTaux || 'Saisie administrateur' };
    const tauxEgal = (avantTaux === null && apresTaux === null)
      || (avantTaux !== null && apresTaux !== null && avantTaux.chfParUsd === apresTaux.chfParUsd && avantTaux.le === apresTaux.le);
    if (!tauxEgal && !erreurTaux(taux.chfParUsd, taux.le)) {
      corps.change = apresTaux;
      lignes.push({
        champ: CHAMP_CHANGE,
        phrase: apresTaux === null
          ? 'Effacer le taux de change ? Les marges en USD ne seront plus calculées.'
          : `Enregistrer le taux 1 USD = ${apresTaux.chfParUsd} CHF (${apresTaux.le}) ?`,
      });
    }
    const nMarge = lireDecimal(margeCible);
    const apresMarge = nMarge === null || Number.isNaN(nMarge) ? null : Math.round(nMarge) / 100;
    const avantMarge = donnees.margeCible ?? null;
    if (apresMarge !== null && apresMarge !== avantMarge && !erreurMarge(margeCible)) {
      corps.margeCible = apresMarge;
      lignes.push({
        champ: CHAMP_MARGE,
        phrase: `Passer la marge visée de ${avantMarge === null ? 'non définie' : `${Math.round(avantMarge * 100)} %`} à ${Math.round(apresMarge * 100)} % ?`,
      });
    }
    return { corps, lignes };
  }, [donnees, catalogue, prix, couts, valeurCredit, taux, sourceTaux, margeCible]);

  const modifie = diff.lignes.length > 0;
  const bloque = Object.keys(erreursClient).length > 0;

  const ouvrirConfirmation = () => {
    if (!modifie || bloque) return;
    setMessage(null);
    setConfirmation(true);
  };

  const enregistrer = async () => {
    setEnvoi(true);
    try {
      const r = await fetch('/api/admin/tarifs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(diff.corps),
      });
      const j = await r.json().catch(() => null);
      setConfirmation(false);
      if (r.status === 400 && Array.isArray(j?.erreurs)) {
        setErreursServeur(Object.fromEntries((j.erreurs as Array<{ champ: string; message: string }>).map((e) => [e.champ, e.message])));
        setMessage({ texte: 'Certains tarifs ont été refusés. Corrigez les champs signalés.', type: 'erreur' });
        return;
      }
      if (!r.ok || !j?.success) {
        setMessage({ texte: j?.error || 'Les tarifs n’ont pas pu être enregistrés.', type: 'erreur' });
        return;
      }
      setMessage({ texte: 'Tarifs enregistrés — en vigueur dès la prochaine opération.', type: 'succes' });
      await charger();
    } catch {
      setConfirmation(false);
      setMessage({ texte: 'Les tarifs n’ont pas pu être enregistrés.', type: 'erreur' });
    } finally {
      setEnvoi(false);
    }
  };

  const annulerConfirmation = useCallback(() => setConfirmation(false), []);

  /**
   * Remplit les champs avec les prix CONSEILLÉS calculés (plancher + marge),
   * sans rien enregistrer : la confirmation habituelle liste ensuite chaque
   * changement. Ces montants viennent du coût fournisseur réel et du taux
   * daté — plus d'un chiffre figé dans le catalogue, qui pouvait vendre à
   * perte sans que personne le voie.
   */
  const appliquerConseilles = (cles: readonly string[]) => {
    const conseils = donnees?.resumeRentabilite?.grilleConseillee ?? {};
    setPrix((p) => {
      const suite = { ...p };
      for (const cle of cles) {
        const v = (conseils as Record<string, number | undefined>)[cle];
        if (typeof v === 'number') suite[cle] = String(v);
      }
      return suite;
    });
  };

  const changerPrix = (cle: CleTarif, v: string) => {
    setPrix((p) => ({ ...p, [cle]: v }));
    setErreursServeur((s) => { const { [cle]: _, ...reste } = s; return reste; });
  };
  const changerCout = (cle: CleTarif, champ: keyof CoutSaisi, v: string) => {
    setCouts((c) => ({ ...c, [cle]: { ...(c[cle] ?? { chf: '', unite: '' }), [champ]: v } }));
    setErreursServeur((s) => { const { [champCout(cle)]: _, ...reste } = s; return reste; });
  };

  if (erreurChargement && !donnees) {
    return (
      <div className="flex items-center gap-2 p-6 text-red-400">
        <AlertTriangle size={20} /> {erreurChargement}
      </div>
    );
  }
  if (!donnees) {
    return <div className="flex h-[50vh] items-center justify-center"><Loader2 className="animate-spin text-orange-400" size={32} /></div>;
  }

  const valeurCreditNum = (() => { const n = lireDecimal(valeurCredit); return n !== null && !Number.isNaN(n) && n > 0 ? n : null; })();
  const grilleConseillee = (donnees.resumeRentabilite?.grilleConseillee ?? {}) as Record<string, number | undefined>;
  const erreurDe = (champ: string) => erreursClient[champ] ?? erreursServeur[champ];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white md:text-3xl">
          <Coins className="text-orange-400" size={28} /> Tarifs &amp; crédits
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          Combien de crédits coûte chaque opération. Les écrans et le débit lisent cette même grille.
        </p>
      </div>

      {donnees.source === 'defaut' && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300">
          <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
          <span>Configuration illisible — prix de repli affichés.</span>
        </div>
      )}

      {message && (
        <div
          role="status"
          className={`rounded-xl border p-3 text-sm ${message.type === 'succes' ? 'border-green-500/30 bg-green-500/5 text-green-300' : 'border-red-500/30 bg-red-500/5 text-red-300'}`}
        >
          {message.texte}
        </div>
      )}

      {/* ── Valeur du crédit ─────────────────────────────────────────── */}
      <section className="card-base space-y-2" style={{ padding: 16 }}>
        <label htmlFor="valeur-credit" className="block text-base font-semibold text-white">Valeur du crédit</label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="valeur-credit"
            type="number"
            inputMode="decimal"
            min={0}
            max={VALEUR_CREDIT_MAX_CHF}
            step="0.01"
            value={valeurCredit}
            onChange={(e) => { setValeurCredit(e.target.value); setErreursServeur((s) => { const { [CHAMP_VALEUR_CREDIT]: _, ...r } = s; return r; }); }}
            placeholder="0.10"
            aria-invalid={!!erreurDe(CHAMP_VALEUR_CREDIT)}
            className="w-32 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-orange-500 focus:outline-none"
          />
          <span className="text-sm text-gray-400">CHF par crédit</span>
        </div>
        {erreurDe(CHAMP_VALEUR_CREDIT) && <p className="text-xs text-red-400">{erreurDe(CHAMP_VALEUR_CREDIT)}</p>}
        <p className="text-xs text-gray-500">Valeur indicative — ne modifie pas les packs de paiement Stripe.</p>
      </section>

      {/* ── Rentabilité & taux de change ──────────────────────────────── */}
      <section className="card-base space-y-3" style={{ padding: 16 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <TrendingUp size={16} className="text-gray-400" /> Rentabilité
          </h2>
          {donnees?.resumeRentabilite && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {donnees.resumeRentabilite.pertes > 0 && (
                <span className={`rounded-full border px-2 py-0.5 ${STYLE_VERDICT.perte.classe}`}>
                  {donnees.resumeRentabilite.pertes} à perte
                </span>
              )}
              {donnees.resumeRentabilite.inconnus > 0 && (
                <span className={`rounded-full border px-2 py-0.5 ${STYLE_VERDICT.inconnu.classe}`}>
                  {donnees.resumeRentabilite.inconnus} inconnues
                </span>
              )}
              <span className={`rounded-full border px-2 py-0.5 ${STYLE_VERDICT.rentable.classe}`}>
                {donnees.resumeRentabilite.rentables} rentables
              </span>
            </div>
          )}
        </div>

        {donnees?.resumeRentabilite && donnees.resumeRentabilite.pertes > 0 && (
          <p
            role="alert"
            data-testid="alerte-vente-a-perte"
            className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300"
          >
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            <span>
              {donnees.resumeRentabilite.pertes === 1 ? 'Un tarif est vendu' : `${donnees.resumeRentabilite.pertes} tarifs sont vendus`}
              {' '}sous leur coût fournisseur. Chaque génération creuse la marge.
            </span>
          </p>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="taux-chf-usd" className="block text-xs font-medium text-gray-300">1 USD en CHF</label>
            <input
              id="taux-chf-usd"
              type="number"
              inputMode="decimal"
              min={TAUX_MIN}
              max={TAUX_MAX}
              step="0.00001"
              value={taux.chfParUsd}
              onChange={(e) => { setTaux((t) => ({ ...t, chfParUsd: e.target.value })); setErreursServeur((s2) => { const { [CHAMP_CHANGE]: _, ...r } = s2; return r; }); }}
              placeholder="0.83"
              aria-invalid={!!erreurDe(CHAMP_CHANGE)}
              className="w-28 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="taux-date" className="block text-xs font-medium text-gray-300">Daté du</label>
            <input
              id="taux-date"
              type="date"
              value={taux.le}
              onChange={(e) => { setTaux((t) => ({ ...t, le: e.target.value })); setErreursServeur((s2) => { const { [CHAMP_CHANGE]: _, ...r } = s2; return r; }); }}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="marge-cible" className="block text-xs font-medium text-gray-300">Marge visée</label>
            <div className="flex items-center gap-1">
              <input
                id="marge-cible"
                type="number"
                inputMode="numeric"
                min={0}
                max={1000}
                step={5}
                value={margeCible}
                onChange={(e) => { setMargeCible(e.target.value); setErreursServeur((s2) => { const { [CHAMP_MARGE]: _, ...r } = s2; return r; }); }}
                placeholder="40"
                aria-invalid={!!erreurDe(CHAMP_MARGE)}
                className="w-20 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-orange-500 focus:outline-none"
              />
              <span className="text-sm text-gray-400">%</span>
            </div>
          </div>
          <button
            type="button"
            onClick={lireTauxReference}
            disabled={lectureTaux}
            className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-200 disabled:opacity-50 ${ETAT_INTERACTIF_SANS_FOND}`}
          >
            {lectureTaux ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Lire le taux de référence
          </button>
        </div>
        {erreurDe(CHAMP_CHANGE) && <p className="text-xs text-red-400">{erreurDe(CHAMP_CHANGE)}</p>}
        {erreurDe(CHAMP_MARGE) && <p className="text-xs text-red-400">{erreurDe(CHAMP_MARGE)}</p>}
        <p className={`text-xs ${donnees?.changePerime ? 'text-amber-400' : 'text-gray-500'}`} data-testid="etat-taux">
          {donnees?.changeLibelle ?? 'Taux non chargé.'}
          {sourceTaux && <span className="text-gray-600"> · {sourceTaux}</span>}
        </p>
        <p className="text-xs text-gray-500">
          Sans taux enregistré, aucune marge en USD n’est calculée : la rentabilité reste affichée comme inconnue plutôt que supposée bonne.
        </p>
      </section>

      {/* ── Catégories ───────────────────────────────────────────────── */}
      {ORDRE_CATEGORIES.map((cat) => {
        const entrees = catalogue.filter((e) => e.categorie === cat);
        if (entrees.length === 0) return null;
        const ouverte = !fermees[cat];
        const idCorps = `categorie-${cat}`;
        return (
          <section key={cat} className="card-base" style={{ padding: 0 }} data-testid={`section-${cat}`}>
            <button
              type="button"
              aria-expanded={ouverte}
              aria-controls={idCorps}
              onClick={() => setFermees((f) => ({ ...f, [cat]: ouverte }))}
              className={`flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left ${ETAT_INTERACTIF_SANS_FOND}`}
            >
              <h2 className="text-base font-semibold text-white">{LIBELLE_CATEGORIE[cat]}</h2>
              <ChevronDown size={18} className="text-gray-400 transition-transform" style={{ transform: ouverte ? 'rotate(180deg)' : 'none' }} />
            </button>
            {ouverte && (
              <div id={idCorps} className="space-y-3 border-t border-gray-800 px-4 py-3">
                {(() => {
                  const aRelever = entrees.filter((e) => typeof grilleConseillee[e.cle] === 'number');
                  if (aRelever.length === 0) return null;
                  return (
                    <div className="space-y-2 rounded-lg border border-orange-500/20 bg-orange-500/5 p-3" data-testid={`conseil-${cat}`}>
                      <p className="text-xs text-orange-200/90">
                        Sous le prix conseillé : {aRelever.map((e) => `${e.libelle} ${donnees.prix?.[e.cle] ?? e.defaut} → ${grilleConseillee[e.cle]}`).join(' · ')} crédits.
                      </p>
                      <button
                        type="button"
                        onClick={() => appliquerConseilles(aRelever.map((e) => e.cle))}
                        className="flex items-center gap-1.5 rounded-lg border border-orange-500/40 px-3 py-1.5 text-xs font-semibold text-orange-300 hover:bg-orange-500/10"
                      >
                        <Sparkles size={14} /> Appliquer les prix conseillés
                      </button>
                    </div>
                  );
                })()}
                {entrees.map((e) => {
                  const erreur = erreurDe(e.cle);
                  const erreurC = erreurDe(champCout(e.cle));
                  const cout = couts[e.cle] ?? { chf: '', unite: '' };
                  const coutNum = lireDecimal(cout.chf);
                  const prixNum = /^\d+$/.test((prix[e.cle] ?? '').trim()) ? Number(prix[e.cle]) : null;
                  const estimation = valeurCreditNum !== null && prixNum !== null && coutNum !== null && !Number.isNaN(coutNum)
                    ? { client: prixNum * valeurCreditNum, marge: prixNum * valeurCreditNum - coutNum }
                    : null;
                  const idPrix = `prix-${e.cle}`;
                  return (
                    <div key={e.cle} className="space-y-2 border-b border-gray-800/60 pb-3 last:border-b-0 last:pb-0" data-testid={`ligne-${e.cle}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label htmlFor={idPrix} className="min-w-0 flex-1 text-sm font-medium text-gray-200">
                          {e.libelle}
                          {e.propose !== undefined && <span className="ml-2 text-xs font-normal text-gray-500">proposé : {e.propose}</span>}
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            id={idPrix}
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={max}
                            step={1}
                            value={prix[e.cle] ?? ''}
                            onChange={(ev) => changerPrix(e.cle, ev.target.value)}
                            aria-invalid={!!erreur}
                            aria-describedby={erreur ? `${idPrix}-erreur` : undefined}
                            className={`w-24 rounded-lg border bg-gray-800 px-3 py-2 text-right text-white focus:outline-none ${erreur ? 'border-red-500' : 'border-gray-700 focus:border-orange-500'}`}
                          />
                          <span className="text-xs text-gray-400" style={{ maxWidth: 150 }}>{uniteAffichee(e)}</span>
                        </div>
                      </div>
                      {erreur && <p id={`${idPrix}-erreur`} className="text-xs text-red-400">{erreur}</p>}
                      {e.aide && <p className="text-xs text-gray-500">{e.aide}</p>}
                      <details className="text-xs text-gray-500" open={!!(cout.chf || erreurC)}>
                        <summary className="cursor-pointer select-none">Coût fournisseur estimé (facultatif)</summary>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="0.0001"
                            aria-label={`Coût fournisseur estimé de ${e.libelle} (CHF)`}
                            value={cout.chf}
                            onChange={(ev) => changerCout(e.cle, 'chf', ev.target.value)}
                            placeholder="CHF"
                            className="w-24 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-gray-200 focus:border-orange-500 focus:outline-none"
                          />
                          <input
                            type="text"
                            maxLength={40}
                            aria-label={`Unité du coût fournisseur de ${e.libelle}`}
                            value={cout.unite}
                            onChange={(ev) => changerCout(e.cle, 'unite', ev.target.value)}
                            placeholder="unité (ex. / génération)"
                            className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-gray-200 focus:border-orange-500 focus:outline-none"
                          />
                        </div>
                        {erreurC && <p className="mt-1 text-red-400">{erreurC}</p>}
                      </details>
                      {estimation && (
                        <p className="text-xs text-gray-500">
                          ≈ {chf(estimation.client)} client · marge ≈ <span className={estimation.marge < 0 ? 'text-red-400' : ''}>{chf(estimation.marge)}</span>
                        </p>
                      )}
                      {(() => {
                        const r = rentabiliteParCle.get(e.cle);
                        if (!r) return null;
                        const st = STYLE_VERDICT[r.verdict];
                        return (
                          <p className="flex flex-wrap items-center gap-2 text-xs" data-testid={`verdict-${e.cle}`}>
                            <span className={`rounded-full border px-2 py-0.5 ${st.classe}`}>{st.texte}</span>
                            {r.prixPlancherCredits !== null && (
                              <span className="text-gray-400">plancher {r.prixPlancherCredits}{r.prixConseilleCredits !== null ? ` · conseillé ${r.prixConseilleCredits}` : ''}</span>
                            )}
                            <span className="min-w-0 flex-1 text-gray-500">{r.motif}</span>
                          </p>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {/* ── Gratuit ──────────────────────────────────────────────────── */}
      <section className="card-base space-y-2" style={{ padding: 16 }}>
        <h2 className="flex items-center gap-2 text-base font-semibold text-white"><Gift size={18} className="text-green-400" /> Gratuit</h2>
        <ul className="space-y-1">
          {(donnees.gratuits ?? TARIFS_GRATUITS).map((g) => (
            <li key={g.libelle} className="flex items-center justify-between gap-3 text-sm text-gray-300">
              <span className="min-w-0">{g.libelle}</span>
              <span className="flex-shrink-0 text-xs font-semibold text-green-400">{g.prix}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Historique ───────────────────────────────────────────────── */}
      <section className="card-base space-y-2" style={{ padding: 16 }}>
        <h2 className="flex items-center gap-2 text-base font-semibold text-white"><History size={18} className="text-gray-400" /> Historique</h2>
        {(donnees.historique ?? []).length === 0 ? (
          <p className="text-sm text-gray-500">Aucun changement enregistré.</p>
        ) : (
          <ul className="space-y-2" data-testid="historique-tarifs">
            {(donnees.historique ?? []).slice(0, 20).map((h, i) => (
              <li key={`${h.cle}-${h.le}-${i}`} className="rounded-lg bg-gray-800/40 px-3 py-2 text-sm">
                <div className="text-gray-200">
                  {libelleCle(h.cle)} : <span className="text-gray-400">{valeurHistorique(h.cle, h.ancien)}</span> → <span className="font-semibold text-white">{valeurHistorique(h.cle, h.nouveau)}</span>
                </div>
                <div className="break-all text-xs text-gray-500">{h.admin} · {dateFr(h.le)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Enregistrer ──────────────────────────────────────────────── */}
      <div className="sticky bottom-0 z-10 -mx-1 border-t border-gray-800 bg-studiio-dark/95 px-1 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-gray-400">
            {bloque ? 'Corrigez les champs en erreur.' : modifie ? `${diff.lignes.length} modification(s) en attente` : 'Aucune modification'}
          </span>
          <button
            type="button"
            onClick={ouvrirConfirmation}
            disabled={!modifie || bloque || envoi}
            data-testid="enregistrer-tarifs"
            className="flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save size={16} /> Enregistrer les modifications
          </button>
        </div>
      </div>

      {confirmation && (
        <DialogueConfirmation
          changements={diff.lignes}
          envoi={envoi}
          onAnnuler={annulerConfirmation}
          onConfirmer={enregistrer}
        />
      )}
    </div>
  );
}
