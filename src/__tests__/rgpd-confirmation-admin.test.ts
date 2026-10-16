import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PHRASE_SUPPRESSION_ADMIN, confirmationSuppressionAdminValide, saisieConfirmationValide,
} from '@/lib/rgpd/confirmation-admin';

/** Confirmation forte de la suppression définitive (admin) — interface ET serveur. */
const ID = '11111111-1111-4111-8111-111111111111';

describe('confirmation de suppression définitive', () => {
  it('phrase exacte', () => {
    expect(PHRASE_SUPPRESSION_ADMIN).toBe('SUPPRIMER DÉFINITIVEMENT');
    expect(PHRASE_SUPPRESSION_ADMIN.normalize('NFC')).toBe(PHRASE_SUPPRESSION_ADMIN);
  });

  it('serveur : phrase ET même id exigés, comparaison stricte', () => {
    expect(confirmationSuppressionAdminValide({ confirmation: PHRASE_SUPPRESSION_ADMIN, userId: ID }, ID)).toBe(true);
    for (const corps of [null, undefined, 'x', {}, { confirmation: PHRASE_SUPPRESSION_ADMIN },
      { confirmation: PHRASE_SUPPRESSION_ADMIN.toLowerCase(), userId: ID },
      { confirmation: `${PHRASE_SUPPRESSION_ADMIN} `, userId: ID },
      { confirmation: PHRASE_SUPPRESSION_ADMIN.normalize('NFD'), userId: ID },
      { confirmation: PHRASE_SUPPRESSION_ADMIN, userId: ID.replace(/1$/, '2') },
      { confirmation: PHRASE_SUPPRESSION_ADMIN, userId: 42 }]) {
      expect(confirmationSuppressionAdminValide(corps, ID), JSON.stringify(corps)).toBe(false);
    }
  });

  it('interface : bouton actif seulement sur la phrase exacte (forme Unicode normalisée, casse stricte)', () => {
    expect(saisieConfirmationValide(PHRASE_SUPPRESSION_ADMIN)).toBe(true);
    expect(saisieConfirmationValide(PHRASE_SUPPRESSION_ADMIN.normalize('NFD'))).toBe(true);
    expect(saisieConfirmationValide('supprimer définitivement')).toBe(false);
    expect(saisieConfirmationValide('SUPPRIMER')).toBe(false);
    expect(saisieConfirmationValide('')).toBe(false);
  });

  it('page admin : plus de confirm() pour la suppression, modale + phrase envoyée au serveur', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/admin/users/page.tsx'), 'utf-8');
    expect(src).not.toMatch(/confirm\(t\('users\.confirmDelete'/);
    expect(src).toMatch(/body: JSON\.stringify\(\{ confirmation: PHRASE_SUPPRESSION_ADMIN, userId: user\.id \}\)/);
    expect(src).toMatch(/disabled=\{actionLoading \|\| !saisieConfirmationValide\(deleteSaisie\)\}/);
    expect(src).toMatch(/t\('users\.actions\.deletePermanently'\)/);
  });

  it('libellés fr/en/de présents et distincts (Bloquer ≠ Supprimer définitivement)', () => {
    for (const l of ['fr', 'en', 'de']) {
      const u = JSON.parse(readFileSync(join(process.cwd(), `messages/${l}.json`), 'utf-8')).admin.users;
      for (const k of ['ban', 'unban', 'banHint', 'unbanHint', 'deletePermanently']) expect(u.actions[k], `${l}.${k}`).toBeTruthy();
      for (const k of ['title', 'account', 'name', 'email', 'id', 'effects', 'banInstead', 'typeToConfirm', 'confirm']) expect(u.deleteModal[k], `${l}.${k}`).toBeTruthy();
      expect(u.deleteModal.typeToConfirm).toContain('{phrase}');
      expect(u.userDeletedExternes).toContain('{fournisseurs}');
      expect(u.actions.ban).not.toBe(u.actions.deletePermanently);
    }
    const fr = JSON.parse(readFileSync(join(process.cwd(), 'messages/fr.json'), 'utf-8')).admin.users;
    expect(fr.actions.ban).toBe('Bloquer');
    expect(fr.actions.deletePermanently).toBe('Supprimer définitivement');
  });
});
