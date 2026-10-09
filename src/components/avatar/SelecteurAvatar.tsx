'use client';

/**
 * Choisir QUEL avatar utiliser (Créer, Autopilote), et la qualité du rendu.
 *
 * Ne montre que les avatars UTILISABLES (une version active). L'écran ne
 * reçoit et ne renvoie que l'identifiant LOGIQUE de l'avatar — jamais un
 * identifiant fournisseur. `null` = l'avatar par défaut du compte.
 * Invisible tant qu'il n'y a qu'un seul avatar utilisable.
 */
import { useEffect, useState } from 'react';

export interface AvatarChoisissable { id: string; nom: string; parDefaut: boolean; version: number | null }
export interface QualiteProposee { qualite: 'standard' | 'qualite' | 'premium'; libelle: string; ouverte: boolean }

/** Lit `GET /api/avatars` et rend les avatars utilisables + les qualités. */
export async function lireAvatarsChoisissables(fetchImpl: typeof fetch = fetch): Promise<{ avatars: AvatarChoisissable[]; qualites: QualiteProposee[] } | null> {
  try {
    const r = await fetchImpl('/api/avatars', { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok || !j?.success) return null;
    const avatars = (j.data.avatars as Array<{ id: string; nom: string; parDefaut: boolean; utilisable: boolean; versionActive: { version: number } | null }>)
      .filter((a) => a.utilisable)
      .map((a) => ({ id: a.id, nom: a.nom, parDefaut: a.parDefaut, version: a.versionActive?.version ?? null }));
    return { avatars, qualites: (j.data.qualites ?? []) as QualiteProposee[] };
  } catch {
    return null;
  }
}

export default function SelecteurAvatar(props: {
  avatarId: string | null;
  onChange: (avatarId: string | null) => void;
  qualite?: QualiteProposee['qualite'];
  onQualiteChange?: (q: QualiteProposee['qualite']) => void;
  className?: string;
}) {
  const [donnees, setDonnees] = useState<{ avatars: AvatarChoisissable[]; qualites: QualiteProposee[] } | null>(null);
  useEffect(() => {
    let vivant = true;
    void lireAvatarsChoisissables().then((d) => { if (vivant) setDonnees(d); });
    return () => { vivant = false; };
  }, []);
  if (!donnees) return null;
  const { avatars, qualites } = donnees;
  // Un avatar choisi qui n'est plus utilisable retombe sur le défaut, sans bruit.
  const valeur = props.avatarId && avatars.some((a) => a.id === props.avatarId) ? props.avatarId : '';
  const plusieursQualites = !!props.onQualiteChange && qualites.filter((q) => q.ouverte).length > 1;
  if (avatars.length < 2 && !plusieursQualites) return null;
  return (
    <div data-selecteur-avatar className={`space-y-2 ${props.className ?? ''}`}>
      {avatars.length >= 2 && (
        <label className="block text-xs text-gray-400">
          Avatar utilisé
          <select
            data-selecteur-avatar-choix
            value={valeur}
            onChange={(e) => props.onChange(e.target.value || null)}
            className="mt-1 w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-white"
          >
            <option value="">Avatar par défaut</option>
            {avatars.map((a) => (
              <option key={a.id} value={a.id}>{a.nom}{a.version ? ` · v${a.version}` : ''}{a.parDefaut ? ' (par défaut)' : ''}</option>
            ))}
          </select>
        </label>
      )}
      {plusieursQualites && (
        <div className="flex gap-2" role="radiogroup" aria-label="Qualité du rendu">
          {qualites.map((q) => (
            <button
              key={q.qualite}
              type="button"
              role="radio"
              aria-checked={(props.qualite ?? 'standard') === q.qualite}
              disabled={!q.ouverte}
              data-qualite={q.qualite}
              onClick={() => props.onQualiteChange?.(q.qualite)}
              className={`flex-1 rounded-lg px-2 py-1.5 text-xs ${!q.ouverte ? 'opacity-40 cursor-not-allowed bg-gray-900' : (props.qualite ?? 'standard') === q.qualite ? 'bg-purple-600/30 ring-1 ring-purple-500/50 text-white' : 'bg-gray-900 text-gray-300'}`}
            >
              {q.libelle}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
