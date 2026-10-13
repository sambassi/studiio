/**
 * Coût HeyGen ESTIMÉ — « gratuit pour l'admin » ≠ « gratuit chez HeyGen ».
 * Rejoué sur les 4 générations RÉELLES du 2026-10-13 (avatar_generations,
 * lecture admin) : Avatar III, Digital Twin, compte admin (0 crédit Studiio).
 * Wallet lu par Studiio : 15,07 $ (07:17 UTC) → 14,33 $ (10:45 UTC) = 0,74 $.
 */
import { describe, it, expect } from 'vitest';
import { coutEstimeHeygenUsd, moteurFacture, TARIFS_HEYGEN_USD_PAR_MIN } from '@/lib/fournisseurs/tarifs-heygen';
import { economieParMois } from '@/lib/fournisseurs/economie';

const reelles = [
  { id: 'd47beab8', duration_seconds: 2.52914, created_at: '2026-10-13T07:25:33Z' },
  { id: 'ccef0abf', duration_seconds: 10.3775, created_at: '2026-10-13T09:22:56Z' },
  { id: '6190bce2', duration_seconds: 9.68088, created_at: '2026-10-13T09:25:37Z' },
  { id: '91f97a68', duration_seconds: 46.7399, created_at: '2026-10-13T09:35:48Z' },
].map((g) => ({ ...g, provider: 'heygen', status: 'completed', engine: 'avatar_iii', avatar_type: 'video', admin_usage: true, provider_cost_eur: null, studiio_price_eur: 0 }));

describe('tarifs officiels HeyGen', () => {
  it('Avatar III Digital Twin = 0,60 $/min, soit 0,01 $/s', () => {
    expect(TARIFS_HEYGEN_USD_PAR_MIN.avatar_iii.twin).toBe(0.6);
    expect(coutEstimeHeygenUsd({ engine: 'avatar_iii', avatarType: 'video', secondes: 60 })).toBe(0.6);
    expect(coutEstimeHeygenUsd({ engine: 'avatar_iii', avatarType: 'video', secondes: 15 })).toBe(0.15);
    expect(coutEstimeHeygenUsd({ engine: 'avatar_iii', avatarType: 'video', secondes: 30 })).toBe(0.3);
  });
  it('sans moteur envoyé, HeyGen applique Avatar IV (≈ 8× plus cher en Digital Twin)', () => {
    expect(moteurFacture(null)).toBe('avatar_iv');
    expect(coutEstimeHeygenUsd({ engine: null, avatarType: 'video', secondes: 60 })).toBe(4.83);
  });
  it('photo et Digital Twin n’ont pas le même tarif', () => {
    expect(coutEstimeHeygenUsd({ engine: 'avatar_iii', avatarType: 'photo', secondes: 60 })).toBe(0.99);
    expect(coutEstimeHeygenUsd({ engine: 'avatar_iv', avatarType: 'photo', secondes: 60 })).toBe(2.31);
  });
  it('durée inconnue → null, jamais 0', () => {
    expect(coutEstimeHeygenUsd({ engine: 'avatar_iii', avatarType: 'video', secondes: null })).toBeNull();
  });
});

describe('les 4 générations réelles du 13/10', () => {
  it('estimation 0,69 $ — cohérente avec la baisse du wallet (0,74 $), toute en usage ADMIN', () => {
    const [m] = economieParMois(reelles);
    expect(m.coutHeygenEstimeUsd).toBeCloseTo(0.6933, 3);
    expect(m.coutHeygenAdminEstimeUsd).toBeCloseTo(0.6933, 3);
    expect(m.secondesHeygen).toBeCloseTo(69.33, 1);
    expect(Math.abs(0.74 - m.coutHeygenEstimeUsd!)).toBeLessThan(0.05);
  });
  it('une génération en échec n’est pas comptée comme payée', () => {
    const [m] = economieParMois([...reelles, { ...reelles[0], id: 'x', status: 'failed', duration_seconds: 30 }]);
    expect(m.coutHeygenEstimeUsd).toBeCloseTo(0.6933, 3);
  });
});
