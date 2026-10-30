import { describe, expect, it } from 'vitest';
import { FREE_MEMBER_LIMIT, PLANS, isActive, memberLimit } from '../src/plans';

describe('plans (B9 v2.4)', () => {
  it('a group without a plan is capped at 15; Group Pro lifts it to 100; the most generous plan wins', () => {
    expect(FREE_MEMBER_LIMIT).toBe(15);
    expect(memberLimit([])).toBe(15);
    expect(memberLimit(['group_pro'])).toBe(100);
    expect(memberLimit(['group_pro', 'community'])).toBe(2000);
    expect(memberLimit(['plus'])).toBe(15); // a personal plan doesn't change a group's cap
    expect(memberLimit(['nonsense'])).toBe(15);
  });

  it('an entitlement is active from its start until it expires or is revoked', () => {
    const now = new Date('2026-11-02T08:00:00Z');
    expect(isActive({ plan: 'plus', startsAt: '2026-11-01T00:00:00Z', expiresAt: null, revokedAt: null }, now)).toBe(true);
    expect(isActive({ plan: 'plus', startsAt: '2026-11-03T00:00:00Z', expiresAt: null, revokedAt: null }, now)).toBe(false);
    expect(isActive({ plan: 'plus', startsAt: '2026-10-01T00:00:00Z', expiresAt: '2026-11-02T08:00:00Z', revokedAt: null }, now)).toBe(false);
    expect(isActive({ plan: 'plus', startsAt: '2026-10-01T00:00:00Z', expiresAt: null, revokedAt: '2026-10-15T00:00:00Z' }, now)).toBe(false);
  });

  it('prices are integer minor units; only Plus and Group Pro are sold in v2.4', () => {
    for (const p of Object.values(PLANS)) {
      expect(Number.isInteger(p.price.egp) && Number.isInteger(p.price.usd)).toBe(true);
    }
    expect(Object.values(PLANS).filter((p) => p.sold).map((p) => p.id).sort()).toEqual(['group_pro', 'plus']);
  });
});
