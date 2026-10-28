'use client';

/**
 * ADMIN — CE QUE CHAQUE FORMULE INCLUT DE CINEMA IA.
 *
 * Le prix CHF est affiche, jamais edite ici : il se modifie dans Tarification, ou chaque
 * changement cree un prix Stripe. Cet ecran n'ecrit que `cinema_formules`.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Check, Info, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import {
  FONCTIONNALITES_CINEMA, QUALITES_CINEMA, type FormuleCinema,
} from '@/lib/cinema/abonnement/formules';

interface Ligne { planKey: string; nom: string; prixMensuelCentimes: number | null; configuree: boolean; formule: FormuleCinema }
interface Reponse { migrationAppliquee: boolean; message?: string; invalides?: string[]; formules: Ligne[] }

const LIBELLES_FONCTIONNALITES: Record<string, string> = {
  image_ia: 'Images IA', animation_video: 'Animation video', voix: 'Voix',
};

const chf = (c: number | null) => (c === null ? '—' : `${(c / 100).toFixed(2).replace('.', ',')} CHF`);

function Champ({ libelle, aide, children }: { libelle: string; aide?: string; children: React.ReactNode }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <label className="block text-xs text-gray-400">
      <span className="flex items-center gap-1">
        {libelle}
        {aide && (
          <button type="button" onClick={() => setOuvert((v) => !v)} aria-label={`Aide : ${libelle}`} className="text-gray-500 hover:text-gray-300">
            <Info className="w-3.5 h-3.5" />
          </button>
        )}
      </span>
      {ouvert && aide && <span className="mt-1 block text-[11px] text-gray-500">{aide}</span>}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

const champNombre = 'w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-white';

function CarteFormule({ ligne, active, surEnregistre }: { ligne: Ligne; active: boolean; surEnregistre: (f: FormuleCinema) => void }) {
  const [f, setF] = useState<FormuleCinema>(ligne.formule);
  const [etat, setEtat] = useState<'repos' | 'envoi' | 'ok'>('repos');
  const [erreurs, setErreurs] = useState<string[]>([]);
  const maj = (p: Partial<FormuleCinema>) => { setF((x) => ({ ...x, ...p })); setEtat('repos'); };
  const minutes = (s: number) => Math.round((s / 60) * 100) / 100;
  const basculer = <T extends string>(liste: T[], v: T) => (liste.includes(v) ? liste.filter((x) => x !== v) : [...liste, v]);

  const enregistrer = async () => {
    setEtat('envoi'); setErreurs([]);
    const r = await fetch('/api/admin/cinema-formules', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
    }).then((x) => x.json()).catch(() => ({ success: false, erreurs: ['Enregistrement impossible'] }));
    if (r.success) { setEtat('ok'); surEnregistre(r.formule); } else { setEtat('repos'); setErreurs(r.erreurs ?? ['Enregistrement impossible']); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
          <span>{ligne.nom}</span>
          <span className="text-sm font-normal text-gray-400">{chf(ligne.prixMensuelCentimes)} / mois</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.inclus} onChange={(e) => maj({ inclus: e.target.checked })} disabled={!active} />
          Cinema IA inclus dans cette formule
        </label>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Champ libelle="Films / mois" aide="Films distincts commences dans la periode. Une regeneration d’un film deja commence n’en consomme pas.">
            <input type="number" min={0} step={1} value={f.filmsParMois} disabled={!active} className={champNombre}
              onChange={(e) => maj({ filmsParMois: Math.trunc(Number(e.target.value)) })} />
          </Champ>
          <Champ libelle="Minutes / mois" aide="Duree de FILM FINAL. L’utilisateur la repartit librement entre ses films.">
            <input type="number" min={0} step={0.5} value={minutes(f.secondesParMois)} disabled={!active} className={champNombre}
              onChange={(e) => maj({ secondesParMois: Math.round(Number(e.target.value) * 60) })} />
          </Champ>
          <Champ libelle="Duree max d’un film (min)" aide="Plafond d’un seul film, dans la limite de ce que la generation supporte reellement.">
            <input type="number" min={0} step={0.5} value={minutes(f.dureeMaxFilmS)} disabled={!active} className={champNombre}
              onChange={(e) => maj({ dureeMaxFilmS: Math.round(Number(e.target.value) * 60) })} />
          </Champ>
          <Champ libelle="Budget fournisseur / mois (USD)" aide="Cout fournisseur maximal engage pour UN abonne dans la periode, tentatives et regenerations comprises. Les plafonds de depense par compte et global continuent de s’appliquer en plus.">
            <input type="number" min={0} step={0.01} value={f.budgetUsdParMois} disabled={!active} className={champNombre}
              onChange={(e) => maj({ budgetUsdParMois: Number(e.target.value) })} />
          </Champ>
        </div>

        <div className="flex flex-wrap gap-6 text-sm">
          <fieldset>
            <legend className="mb-1 text-xs text-gray-400">Qualites autorisees</legend>
            <div className="flex gap-3">
              {QUALITES_CINEMA.map((q) => (
                <label key={q} className="flex items-center gap-1">
                  <input type="checkbox" checked={f.qualites.includes(q)} disabled={!active} onChange={() => maj({ qualites: basculer(f.qualites, q) })} />{q}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-xs text-gray-400">Fonctionnalites</legend>
            <div className="flex gap-3">
              {FONCTIONNALITES_CINEMA.map((x) => (
                <label key={x} className="flex items-center gap-1">
                  <input type="checkbox" checked={f.fonctionnalites.includes(x)} disabled={!active} onChange={() => maj({ fonctionnalites: basculer(f.fonctionnalites, x) })} />
                  {LIBELLES_FONCTIONNALITES[x]}
                </label>
              ))}
            </div>
          </fieldset>
          <Champ libelle="Renouvellement des quotas">
            <select value={f.renouvellement} disabled={!active} className={champNombre}
              onChange={(e) => maj({ renouvellement: e.target.value as FormuleCinema['renouvellement'] })}>
              <option value="periode_abonnement">A chaque periode de l’abonnement</option>
              <option value="mois_civil">Le 1er de chaque mois</option>
            </select>
          </Champ>
        </div>

        {erreurs.length > 0 && (
          <ul className="space-y-0.5 text-xs text-red-400">{erreurs.map((e) => <li key={e}>{e}</li>)}</ul>
        )}
        <div className="flex items-center gap-3">
          <button type="button" onClick={enregistrer} disabled={!active || etat === 'envoi'}
            className="inline-flex items-center gap-2 rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {etat === 'envoi' ? <Loader2 className="w-4 h-4 animate-spin" /> : etat === 'ok' ? <Check className="w-4 h-4" /> : null}
            Enregistrer
          </button>
          {!ligne.configuree && etat !== 'ok' && <span className="text-xs text-gray-500">Jamais configuree : Cinema n’est pas inclus.</span>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function CinemaFormulesPage() {
  const [data, setData] = useState<Reponse | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/cinema-formules')
      .then((r) => r.json())
      .then((j) => (j.success ? setData(j.data) : setErreur(j.error || 'Lecture impossible')))
      .catch(() => setErreur('Lecture impossible'));
  }, []);

  if (erreur) return <div className="p-6 text-red-400 flex gap-2"><AlertCircle className="w-5 h-5" />{erreur}</div>;
  if (!data) return <div className="p-6"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cinema IA — formules</h1>
        <p className="mt-1 text-sm text-gray-400">
          Ce que chaque abonnement inclut. Les prix se modifient dans <Link href="/admin/pricing" className="underline">Tarification</Link>.
        </p>
      </div>
      {!data.migrationAppliquee && (
        <p className="flex items-center gap-2 text-sm text-amber-300">
          <AlertCircle className="w-4 h-4" />
          Migration 2026-11-01-cinema-abonnements.sql non appliquee : lecture seule, rien ne peut etre enregistre.
        </p>
      )}
      {data.invalides && data.invalides.length > 0 && (
        <p className="text-sm text-red-400">Formules illisibles en base, traitees comme non incluses : {data.invalides.join(', ')}</p>
      )}
      <p className="text-xs text-gray-500">
        Les quotas ne s’appliquent pas encore aux generations : ils seront branches apres validation des valeurs.
        L’administrateur n’est jamais soumis aux quotas : il paie le cout fournisseur reel.
      </p>
      {data.formules.map((l) => (
        <CarteFormule key={l.planKey} ligne={l} active={data.migrationAppliquee}
          surEnregistre={(f) => setData((d) => d && ({ ...d, formules: d.formules.map((x) => (x.planKey === f.planKey ? { ...x, formule: f, configuree: true } : x)) }))} />
      ))}
    </div>
  );
}
