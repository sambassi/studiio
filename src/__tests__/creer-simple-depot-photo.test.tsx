import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PHOTO_DND_TYPE, readDroppedPhoto } from '@/app/dashboard/creer/AssistantWizard';

/**
 * Glisser-déposer d'une photo d'affiche — Mode simple.
 *
 * Il ne fonctionnait pas, pour deux raisons distinctes :
 *
 * 1. Le plateau est couvert d'enfants absolus — cartes, titre, CTA, éléments —
 *    qui recevaient l'événement **sans autoriser le dépôt**. Faute d'un
 *    `dragover` avec `preventDefault` sur eux, `drop` ne se déclenchait jamais.
 * 2. La lecture retombait sur `text/plain`, dont se sert déjà le
 *    **réordonnancement des séquences** : les deux gestes se confondaient.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'),
  'utf-8',
);

/** `DataTransfer` minimal — jsdom n'en fournit pas d'utilisable. */
const dt = (donnees: Record<string, string>) =>
  ({ getData: (type: string) => donnees[type] ?? '' }) as unknown as DataTransfer;

describe('readDroppedPhoto — un type à nous, pas text/plain', () => {
  it('lit d abord le type dédié', () => {
    expect(readDroppedPhoto(dt({ [PHOTO_DND_TYPE]: 'https://a/1.jpg' }))).toBe('https://a/1.jpg');
  });

  it('accepte une image glissée depuis un autre onglet', () => {
    expect(readDroppedPhoto(dt({ 'text/uri-list': 'https://a/2.jpg' }))).toBe('https://a/2.jpg');
  });

  it('IGNORE text/plain — c est le réordonnancement des séquences', () => {
    // Sans ça, glisser une séquence posait sa clé (« cards ») comme fond.
    expect(readDroppedPhoto(dt({ 'text/plain': 'cards' }))).toBeNull();
    expect(readDroppedPhoto(dt({ 'text/plain': 'https://a/3.jpg' }))).toBeNull();
  });

  it('refuse une valeur qui n est pas une URL http(s)', () => {
    expect(readDroppedPhoto(dt({ 'text/uri-list': 'cards' }))).toBeNull();
    expect(readDroppedPhoto(dt({ 'text/uri-list': 'javascript:alert(1)' }))).toBeNull();
  });

  it('le type dédié prime sur tout le reste', () => {
    expect(readDroppedPhoto(dt({
      [PHOTO_DND_TYPE]: 'https://a/bon.jpg',
      'text/uri-list': 'https://a/autre.jpg',
      'text/plain': 'cards',
    }))).toBe('https://a/bon.jpg');
  });

  it('sans transfert, rien', () => {
    expect(readDroppedPhoto(null)).toBeNull();
    expect(readDroppedPhoto(undefined)).toBeNull();
  });
});

describe('Câblage', () => {
  it('la surface de dépôt couvre tout le plateau, au-dessus de ses enfants', () => {
    const bloc = wizard.slice(wizard.indexOf('data-photo-drop'), wizard.indexOf('data-photo-drop') + 900);
    expect(bloc).toContain('inset: 0');
    expect(bloc).toContain('zIndex: 20');
    expect(bloc).toContain("e.dataTransfer.dropEffect = 'copy'");
    expect(bloc).toContain('e.preventDefault();');
  });

  it("elle n'apparaît que pendant un glissement, et jamais à la capture", () => {
    // Permanente, elle bloquerait tous les autres gestes de l'aperçu ; visible
    // à la capture, elle serait photographiée.
    expect(wizard).toContain('{photoDragging && onPhotoDrop && !capturing && (');
  });

  it('elle dit ce qui va se passer, selon l onglet', () => {
    expect(wizard).toContain('Déposez la photo ici');
    expect(wizard).toContain("focus === 'all' ? 'pour l’affiche globale' : 'pour la séquence affichée'");
  });

  it('le glissement se signale au début et se termine à la fin', () => {
    expect(wizard).toContain('setPhotoDragging(true);');
    expect(wizard).toContain('onDragEnd={() => setPhotoDragging(false)}');
    // Et aussi au dépôt : `dragend` n'arrive pas toujours après un drop.
    expect(wizard).toContain('onPhotoDrop={(url) => { setPhotoDragging(false); applyPhoto(url); }}');
  });

  it('le réordonnancement des séquences garde son text/plain', () => {
    expect(wizard).toContain("e.dataTransfer.setData('text/plain', seq.key);");
  });

  it('la grille de photos a son propre ascenseur', () => {
    // Sans lui, la parcourir faisait défiler toute la page et l'aperçu — ce
    // qu'on regarde en choisissant une photo — sortait de l'écran.
    expect(wizard).toContain('grid grid-cols-4 gap-1.5 max-h-64 overflow-y-auto pr-1');
  });
});
