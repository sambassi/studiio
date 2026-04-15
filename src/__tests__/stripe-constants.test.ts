import { describe, it, expect } from 'vitest';
import { STRIPE_PLANS, CREDIT_PACKAGES, RENDER_COSTS, FREE_CREDITS, hasWatermark } from '@/lib/stripe/constants';

describe('Stripe Constants', () => {
  describe('STRIPE_PLANS', () => {
    it('doit avoir les 4 plans : free, starter, pro, enterprise', () => {
      expect(Object.keys(STRIPE_PLANS)).toEqual(['free', 'starter', 'pro', 'enterprise']);
    });

    it('chaque plan doit avoir les champs requis', () => {
      for (const [, plan] of Object.entries(STRIPE_PLANS)) {
        expect(plan).toHaveProperty('name');
        expect(plan).toHaveProperty('price');
        expect(plan).toHaveProperty('credits');
        expect(plan).toHaveProperty('features');
        expect(plan.credits).toBeGreaterThan(0);
        expect(plan.features.length).toBeGreaterThan(0);
      }
    });

    it('les prix doivent être croissants', () => {
      expect(STRIPE_PLANS.free.price).toBeLessThan(STRIPE_PLANS.starter.price);
      expect(STRIPE_PLANS.starter.price).toBeLessThan(STRIPE_PLANS.pro.price);
      expect(STRIPE_PLANS.pro.price).toBeLessThan(STRIPE_PLANS.enterprise.price);
    });

    it('les crédits doivent être croissants', () => {
      expect(STRIPE_PLANS.starter.credits).toBeLessThan(STRIPE_PLANS.pro.credits);
      expect(STRIPE_PLANS.pro.credits).toBeLessThan(STRIPE_PLANS.enterprise.credits);
    });

    it('les prix annuels doivent être ≤ prix mensuels', () => {
      for (const plan of Object.values(STRIPE_PLANS)) {
        expect(plan.yearlyPrice).toBeLessThanOrEqual(plan.price);
      }
    });
  });

  describe('CREDIT_PACKAGES', () => {
    it('doit avoir 4 packs', () => {
      expect(Object.keys(CREDIT_PACKAGES)).toEqual(['small', 'medium', 'large', 'xlarge']);
    });

    it('les montants de crédits doivent être croissants', () => {
      expect(CREDIT_PACKAGES.small.amount).toBeLessThan(CREDIT_PACKAGES.medium.amount);
      expect(CREDIT_PACKAGES.medium.amount).toBeLessThan(CREDIT_PACKAGES.large.amount);
      expect(CREDIT_PACKAGES.large.amount).toBeLessThan(CREDIT_PACKAGES.xlarge.amount);
    });

    it('le prix par crédit doit être dégressif', () => {
      const small = CREDIT_PACKAGES.small.price / CREDIT_PACKAGES.small.amount;
      const medium = CREDIT_PACKAGES.medium.price / CREDIT_PACKAGES.medium.amount;
      const large = CREDIT_PACKAGES.large.price / CREDIT_PACKAGES.large.amount;
      const xlarge = CREDIT_PACKAGES.xlarge.price / CREDIT_PACKAGES.xlarge.amount;
      expect(medium).toBeLessThan(small);
      expect(large).toBeLessThan(medium);
      expect(xlarge).toBeLessThan(large);
    });
  });

  describe('RENDER_COSTS', () => {
    it('un Reel (9:16) doit coûter 10 crédits', () => {
      expect(RENDER_COSTS.reel).toBe(10);
    });
    it('un TV (16:9) doit coûter 15 crédits', () => {
      expect(RENDER_COSTS.tv).toBe(15);
    });
  });

  describe('FREE_CREDITS', () => {
    it('les crédits gratuits doivent être positifs', () => {
      expect(FREE_CREDITS).toBeGreaterThan(0);
    });
  });

  describe('hasWatermark', () => {
    it('free/null/undefined → true', () => {
      expect(hasWatermark('free')).toBe(true);
      expect(hasWatermark(null)).toBe(true);
      expect(hasWatermark(undefined)).toBe(true);
    });
    it('paid plans → false', () => {
      expect(hasWatermark('starter')).toBe(false);
      expect(hasWatermark('pro')).toBe(false);
      expect(hasWatermark('enterprise')).toBe(false);
    });
  });
});
