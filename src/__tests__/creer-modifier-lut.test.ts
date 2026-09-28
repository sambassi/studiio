/**
 * Le filtre couleur (LUT) dans Modifier : rechargé depuis la metadata du post,
 * enregistré quand il change — et un changement PÉRIME le montage, pour que
 * le Calendrier propose « Régénérer » (#454).
 */
import { describe, it, expect } from 'vitest';
import {
  metadataPourEnregistrement, montageEstPerime, type ValeursWizard,
} from '@/lib/creer/postMetadata/from-wizard';
import { toWizardDraft } from '@/lib/creer/postMetadata/to-wizard';

const E1 = 'a'.repeat(64);
const E2 = 'b'.repeat(64);
const REF1 = { empreinte: E1, nom: 'teal', intensite: 0.8 };
const REF2 = { empreinte: E2, nom: 'warm', intensite: 0.8 };

describe('enregistrer dans Modifier — le filtre', () => {
  const existante = { type: 'infographic', lut: REF1, renderedVideoUrl: 'https://cdn/v.webm' };

  it('⚠️ changer de LUT l’écrit ET pose montagePerime', () => {
    const envoi = metadataPourEnregistrement(existante, { lut: REF2 }, { lut: REF1 });
    expect(envoi.lut).toEqual(REF2);
    expect(montageEstPerime(envoi)).toBe(true);
  });

  it('changer seulement l’intensité périme aussi le montage', () => {
    const envoi = metadataPourEnregistrement(existante, { lut: { ...REF1, intensite: 0.3 } }, { lut: REF1 });
    expect(envoi.lut).toEqual({ ...REF1, intensite: 0.3 });
    expect(montageEstPerime(envoi)).toBe(true);
  });

  it('retirer le filtre envoie `null` (la fusion l’efface) et périme le montage', () => {
    const envoi = metadataPourEnregistrement(existante, { lut: null }, { lut: REF1 });
    expect(envoi).toHaveProperty('lut', null);
    expect(montageEstPerime(envoi)).toBe(true);
  });

  it('ajouter un filtre à un post qui n’en avait pas', () => {
    const envoi = metadataPourEnregistrement({ type: 'infographic' }, { lut: REF1 }, { lut: null });
    expect(envoi.lut).toEqual(REF1);
    expect(montageEstPerime(envoi)).toBe(true);
  });

  it('default safe : filtre inchangé → rien n’est envoyé, pas même le drapeau', () => {
    expect(metadataPourEnregistrement(existante, { lut: REF1 }, { lut: REF1 })).toEqual({});
  });

  it('default safe : post sans filtre, écran sans filtre → rien n’est envoyé', () => {
    const vals: ValeursWizard = { lut: null };
    expect(metadataPourEnregistrement({ type: 'infographic' }, vals, { lut: null })).toEqual({});
    // Référence de chargement ABSENTE (appelant qui ne la fournit pas) : `null` vaut `null`.
    expect(metadataPourEnregistrement({ type: 'infographic' }, vals, {})).toEqual({});
  });

  it('la référence seule part : ni table, ni clé de stockage, ni URL', () => {
    const envoi = metadataPourEnregistrement(existante, { lut: REF2 }, { lut: REF1 });
    expect(Object.keys(envoi.lut as object).sort()).toEqual(['empreinte', 'intensite', 'nom']);
  });
});

describe('rouvrir dans Modifier — le filtre est réhydraté', () => {
  it('la référence de la metadata revient dans le brouillon', () => {
    const d = toWizardDraft({ title: 'T', metadata: { lut: REF1 } } as never);
    expect(d.lut).toEqual(REF1);
  });

  it('post sans filtre : aucun filtre (comportement d’avant)', () => {
    const d = toWizardDraft({ title: 'T', metadata: {} } as never);
    expect(d.lut).toBeUndefined();
  });

  it('référence abîmée : écartée, jamais une empreinte invalide à l’écran', () => {
    const d = toWizardDraft({ title: 'T', metadata: { lut: { empreinte: '../x', nom: 'x', intensite: 1 } } } as never);
    expect(d.lut).toBeUndefined();
  });
});
