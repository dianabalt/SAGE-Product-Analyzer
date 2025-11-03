// web/lib/__tests__/identity.test.ts
import { identityScore, isValidGTIN14, normalizeSize } from '../identity';
import type { ProductIdentity } from '../identity';

describe('identity.ts - Phase A', () => {
  describe('isValidGTIN14', () => {
    it('validates UPC-12 (GTIN-12) correctly', () => {
      expect(isValidGTIN14('012345678905')).toBe(true); // Valid UPC
      expect(isValidGTIN14('012345678906')).toBe(false); // Invalid check digit
    });

    it('validates EAN-13 correctly', () => {
      expect(isValidGTIN14('5901234123457')).toBe(true); // Valid EAN-13
      expect(isValidGTIN14('5901234123458')).toBe(false); // Invalid check digit
    });

    it('validates GTIN-14 correctly', () => {
      expect(isValidGTIN14('10012345678902')).toBe(true); // Valid GTIN-14
      expect(isValidGTIN14('10012345678903')).toBe(false); // Invalid check digit
    });

    it('rejects invalid formats', () => {
      expect(isValidGTIN14('123')).toBe(false); // Too short
      expect(isValidGTIN14('abcdefghijkl')).toBe(false); // Non-numeric
      expect(isValidGTIN14('')).toBe(false); // Empty
    });
  });

  describe('normalizeSize', () => {
    it('normalizes fluid ounces to ml', () => {
      const result = normalizeSize('8 fl oz');
      expect(result).not.toBeNull();
      expect(result?.unit).toBe('ml');
      expect(result?.value).toBeCloseTo(236.59, 1); // 8 * 29.5735
    });

    it('normalizes weight ounces to grams', () => {
      const result = normalizeSize('4 oz');
      expect(result).not.toBeNull();
      expect(result?.unit).toBe('g');
      expect(result?.value).toBeCloseTo(113.4, 1); // 4 * 28.3495
    });

    it('handles ml and grams directly', () => {
      expect(normalizeSize('100ml')).toEqual({ value: 100, unit: 'ml' });
      expect(normalizeSize('50g')).toEqual({ value: 50, unit: 'g' });
      expect(normalizeSize('250 grams')).toEqual({ value: 250, unit: 'g' });
    });

    it('returns null for invalid input', () => {
      expect(normalizeSize('invalid')).toBeNull();
      expect(normalizeSize('')).toBeNull();
      expect(normalizeSize(null)).toBeNull();
    });

    it('separates fluid vs weight channels correctly', () => {
      const flOz = normalizeSize('1 fl oz');
      const oz = normalizeSize('1 oz');

      expect(flOz?.unit).toBe('ml');
      expect(oz?.unit).toBe('g');
      expect(flOz?.value).not.toBe(oz?.value); // Different conversions
    });
  });

  describe('identityScore', () => {
    it('scores exact brand match', () => {
      const want: Partial<ProductIdentity> = { brand: 'CeraVe', name: 'Moisturizing Cream' };
      const page: Partial<ProductIdentity> = { brand: 'CeraVe', name: 'Moisturizing Cream' };

      const result = identityScore(want, page);

      expect(result.breakdown.brand).toBe(3.0); // Brand exact match
      expect(result.total).toBeGreaterThanOrEqual(3.0);
    });

    it('scores GTIN-14 validation', () => {
      const want: Partial<ProductIdentity> = { gtin: '012345678905' }; // Valid UPC
      const page: Partial<ProductIdentity> = { gtin: '012345678905' };

      const result = identityScore(want, page);

      expect(result.breakdown.gtin).toBe(5.0); // GTIN match
      expect(result.total).toBeGreaterThanOrEqual(5.0);
    });

    it('scores manufacturer domain boost', () => {
      const want: Partial<ProductIdentity> = { brand: 'CeraVe' };
      const page: Partial<ProductIdentity> = { brand: 'CeraVe' };

      const result = identityScore(want, page, 'cerave.com');

      expect(result.breakdown.domainBoost).toBe(0.5); // Manufacturer domain
      expect(result.total).toBeGreaterThanOrEqual(3.5); // Brand + domain
    });

    it('scores size matching with tolerance', () => {
      const want: Partial<ProductIdentity> = { size: '8 fl oz' };
      const page: Partial<ProductIdentity> = { size: '236ml' }; // ~8 fl oz

      const result = identityScore(want, page);

      expect(result.breakdown.size).toBeGreaterThan(0); // Should match with tolerance
    });

    it('scores scent matching', () => {
      const want: Partial<ProductIdentity> = { scent: 'Lavender' };
      const page: Partial<ProductIdentity> = { scent: 'Lavender' };

      const result = identityScore(want, page);

      expect(result.breakdown.scent).toBe(0.75); // Scent match
    });

    it('rejects invalid GTIN', () => {
      const want: Partial<ProductIdentity> = { gtin: '012345678906' }; // Invalid check digit
      const page: Partial<ProductIdentity> = { gtin: '012345678906' };

      const result = identityScore(want, page);

      expect(result.warnings).toContain('Invalid GTIN-14 check digit');
      expect(result.breakdown.gtin).toBe(0); // No score for invalid GTIN
    });

    it('handles missing brand gracefully', () => {
      const want: Partial<ProductIdentity> = { name: 'Moisturizing Cream' };
      const page: Partial<ProductIdentity> = { name: 'Moisturizing Cream' };

      const result = identityScore(want, page);

      expect(result.breakdown.brand).toBe(0); // No brand match
      expect(result.breakdown.nameTokens).toBeGreaterThan(0); // Name tokens should match
    });

    it('calculates total score correctly', () => {
      const want: Partial<ProductIdentity> = {
        brand: 'CeraVe',
        name: 'Moisturizing Cream',
        size: '8 fl oz',
        gtin: '012345678905'
      };
      const page: Partial<ProductIdentity> = {
        brand: 'CeraVe',
        name: 'Moisturizing Cream',
        size: '236ml',
        gtin: '012345678905'
      };

      const result = identityScore(want, page, 'cerave.com');

      // Should have: brand (3.0) + nameTokens (1.0) + size (1.0) + gtin (5.0) + domainBoost (0.5)
      expect(result.total).toBeGreaterThanOrEqual(9.0);
    });
  });
});
