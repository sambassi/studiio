import { describe, it, expect } from 'vitest';
import { localiserNotification, nombreRushIntrouvables } from '@/lib/notifications/affichage';
import fr from '../../messages/fr.json';

const t = (cle: string, p?: Record<string, string | number | null | undefined>) => {
  const v = cle.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], (fr as Record<string, unknown>).notifications) as string;
  return Object.entries(p || {}).reduce((s, [k, x]) => s.replace(`{${k}}`, String(x)), v ?? `?${cle}`);
};

describe('notifications — localisation à l\'affichage', () => {
  it('chaque kind connu est localisé, et le français rendu est le texte stocké par le cron', () => {
    const cas = [
      ['autopilote-credits', 'Autopilote en pause : crédits insuffisants', 'Votre solde est descendu au seuil que vous avez fixé. Rechargez vos crédits ou abaissez le seuil pour qu’il reprenne.'],
      ['autopilote-sans-rush', 'Autopilote en pause : ajoutez des rushes', 'Votre Autopilote est actif mais aucun rush de sa banque n’est utilisable (banque vide, rushes expirés ou supprimés). Ajoutez-y au moins une vidéo pour qu’il puisse produire.'],
    ] as const;
    for (const [kind, title, body] of cas) {
      expect(localiserNotification({ kind, title, body }, t)).toEqual({ title, body });
    }
  });
  it('rush introuvable : singulier, pluriel, banque vide — français identique à celui du cron', () => {
    expect(localiserNotification({ kind: 'autopilote-rush-introuvable', title: '1 rush introuvable', body: '1 vidéo a disparu du stockage et a été retirée de votre banque.' }, t))
      .toEqual({ title: '1 rush introuvable', body: '1 vidéo a disparu du stockage et a été retirée de votre banque.' });
    expect(localiserNotification({ kind: 'autopilote-rush-introuvable', title: '3 rushes introuvables', body: '3 vidéos ont disparu du stockage et ont été retirées de votre banque.' }, t))
      .toEqual({ title: '3 rushes introuvables', body: '3 vidéos ont disparu du stockage et ont été retirées de votre banque.' });
    const vide = localiserNotification({ kind: 'autopilote-rush-introuvable', title: '2 rushes introuvables', body: 'Votre banque est maintenant vide : ajoutez au moins une vidéo pour que l’Autopilote reprenne.' }, t);
    expect(vide.body).toBe('Votre banque est maintenant vide : ajoutez au moins une vidéo pour que l’Autopilote reprenne.');
  });
  it('un kind inconnu ou un titre inattendu reste TEL QUEL (jamais perdu, jamais inventé)', () => {
    expect(localiserNotification({ kind: 'autre', title: 'Titre', body: 'Corps' }, t)).toEqual({ title: 'Titre', body: 'Corps' });
    expect(localiserNotification({ kind: 'autopilote-rush-introuvable', title: 'bizarre', body: null }, t)).toEqual({ title: 'bizarre', body: null });
  });
  it('sans corps, pas de corps inventé', () => {
    expect(localiserNotification({ kind: 'autopilote-credits', title: 'x', body: null }, t).body).toBeNull();
  });
  it('nombreRushIntrouvables', () => {
    expect(nombreRushIntrouvables('12 rushes introuvables')).toBe(12);
    expect(nombreRushIntrouvables('rien')).toBeNull();
  });
});
