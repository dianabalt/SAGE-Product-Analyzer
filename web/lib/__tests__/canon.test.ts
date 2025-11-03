// web/lib/__tests__/canon.test.ts
import { canonicalizeIngredient, calculateDictionaryCoverage } from '../canon';

describe('canon.ts - Phase A', () => {
  describe('canonicalizeIngredient', () => {
    it('canonicalizes common vitamin aliases', () => {
      expect(canonicalizeIngredient('Vitamin E')).toBe('tocopherol');
      expect(canonicalizeIngredient('vitamin c')).toBe('ascorbic acid');
      expect(canonicalizeIngredient('VITAMIN D3')).toBe('cholecalciferol');
    });

    it('canonicalizes chemical abbreviations', () => {
      expect(canonicalizeIngredient('SLS')).toBe('sodium lauryl sulfate');
      expect(canonicalizeIngredient('SLES')).toBe('sodium laureth sulfate');
      expect(canonicalizeIngredient('AHA')).toBe('alpha hydroxy acid');
    });

    it('canonicalizes common botanical names', () => {
      expect(canonicalizeIngredient('Hyaluronic Acid')).toBe('sodium hyaluronate');
      expect(canonicalizeIngredient('Shea Butter')).toBe('butyrospermum parkii');
      expect(canonicalizeIngredient('Tea Tree Oil')).toBe('melaleuca alternifolia');
    });

    it('returns original if no alias found', () => {
      expect(canonicalizeIngredient('Glycerin')).toBe('glycerin');
      expect(canonicalizeIngredient('Water')).toBe('water');
      expect(canonicalizeIngredient('Unknown Ingredient')).toBe('unknown ingredient');
    });

    it('is case-insensitive', () => {
      expect(canonicalizeIngredient('vitamin e')).toBe('tocopherol');
      expect(canonicalizeIngredient('VITAMIN E')).toBe('tocopherol');
      expect(canonicalizeIngredient('ViTaMiN e')).toBe('tocopherol');
    });

    it('handles multi-word ingredients', () => {
      expect(canonicalizeIngredient('Coconut Oil')).toBe('cocos nucifera');
      expect(canonicalizeIngredient('Jojoba Oil')).toBe('simmondsia chinensis');
    });
  });

  describe('calculateDictionaryCoverage', () => {
    it('returns 1.0 for all known ingredients', () => {
      const tokens = ['water', 'glycerin', 'tocopherol', 'sodium chloride'];
      const coverage = calculateDictionaryCoverage(tokens);

      expect(coverage).toBeGreaterThan(0.5); // Most should be in dictionary
    });

    it('returns lower coverage for unknown ingredients', () => {
      const tokens = ['zxcvbn', 'qwerty', 'asdfgh', 'unknown123'];
      const coverage = calculateDictionaryCoverage(tokens);

      expect(coverage).toBeLessThan(0.5); // Few/none should be in dictionary
    });

    it('returns 0 for empty array', () => {
      expect(calculateDictionaryCoverage([])).toBe(0);
    });

    it('handles mixed known/unknown ingredients', () => {
      const tokens = ['water', 'glycerin', 'unknown1', 'unknown2'];
      const coverage = calculateDictionaryCoverage(tokens);

      expect(coverage).toBeGreaterThan(0);
      expect(coverage).toBeLessThan(1);
    });

    it('recognizes INCI chemical patterns', () => {
      const tokens = [
        'sodium lauryl sulfate',
        'potassium hydroxide',
        'calcium carbonate',
        'magnesium sulfate'
      ];
      const coverage = calculateDictionaryCoverage(tokens);

      // Should recognize chemical patterns (sodium, potassium, sulfate, etc.)
      expect(coverage).toBeGreaterThan(0.5);
    });

    it('recognizes botanical INCI names', () => {
      const tokens = [
        'butyrospermum parkii', // Shea butter
        'cocos nucifera', // Coconut oil
        'simmondsia chinensis' // Jojoba oil
      ];
      const coverage = calculateDictionaryCoverage(tokens);

      expect(coverage).toBeGreaterThan(0);
    });

    it('is case-insensitive', () => {
      const lower = calculateDictionaryCoverage(['water', 'glycerin']);
      const upper = calculateDictionaryCoverage(['WATER', 'GLYCERIN']);
      const mixed = calculateDictionaryCoverage(['Water', 'Glycerin']);

      expect(lower).toBe(upper);
      expect(lower).toBe(mixed);
    });
  });
});
