// web/lib/__tests__/looksLikeIngredients.test.ts
import { v2Checks } from '../looksLikeIngredients';

describe('looksLikeIngredients.ts - Validator V2 (Phase A)', () => {
  describe('v2Checks', () => {
    it('validates comma density (≥1 comma per 25 chars)', () => {
      const goodText = 'Water, Glycerin, Sodium Chloride, Tocopherol, Retinol'; // ~55 chars, 4 commas
      const tokens = goodText.split(',').map(t => t.trim());
      const result = v2Checks(goodText, tokens);

      expect(result.commaDensityOk).toBe(true);
    });

    it('rejects low comma density', () => {
      const badText = 'This is a long sentence with very few commas and many words that should fail validation because it lacks proper delimiter density';
      const tokens = badText.split(',').map(t => t.trim());
      const result = v2Checks(badText, tokens);

      expect(result.commaDensityOk).toBe(false);
    });

    it('validates max length (≤120 tokens)', () => {
      const tokens = Array(100).fill('ingredient'); // 100 tokens
      const text = tokens.join(', ');
      const result = v2Checks(text, tokens);

      expect(result.maxLenOk).toBe(true);
    });

    it('rejects excessive token count', () => {
      const tokens = Array(150).fill('ingredient'); // 150 tokens
      const text = tokens.join(', ');
      const result = v2Checks(text, tokens);

      expect(result.maxLenOk).toBe(false);
    });

    it('detects bad phrases', () => {
      const badText = 'Water, Glycerin, key ingredients for healthy skin, Sodium Chloride';
      const tokens = badText.split(',').map(t => t.trim());
      const result = v2Checks(badText, tokens);

      expect(result.hasBadPhrases).toBe(true);
    });

    it('passes clean ingredient lists', () => {
      const cleanText = 'Water, Glycerin, Sodium Chloride, Tocopherol, Retinol, Niacinamide, Panthenol, Allantoin';
      const tokens = cleanText.split(',').map(t => t.trim());
      const result = v2Checks(cleanText, tokens);

      expect(result.hasBadPhrases).toBe(false);
    });

    it('extracts "may contain" items', () => {
      const text = 'Water, Glycerin. May contain: Limonene, Linalool';
      const tokens = text.split(/[,.]/).map(t => t.trim()).filter(Boolean);
      const result = v2Checks(text, tokens);

      expect(result.mayContain.length).toBeGreaterThan(0);
    });

    it('calculates dictionary coverage', () => {
      const text = 'Water, Glycerin, Sodium Chloride, Tocopherol';
      const tokens = text.split(',').map(t => t.trim());
      const result = v2Checks(text, tokens);

      expect(result.dictCoverage).toBeGreaterThan(0);
      expect(result.dictCoverage).toBeLessThanOrEqual(1);
    });

    it('handles edge case: empty tokens', () => {
      const result = v2Checks('', []);

      expect(result.commaDensityOk).toBe(false); // No commas
      expect(result.maxLenOk).toBe(true); // 0 tokens < 120
      expect(result.hasBadPhrases).toBe(false);
      expect(result.dictCoverage).toBe(0);
    });

    it('validates typical cosmetic ingredient list', () => {
      const text = 'Aqua (Water), Glycerin, Cetearyl Alcohol, Caprylic/Capric Triglyceride, Cetyl Alcohol, Dimethicone, Phenoxyethanol, Polyglyceryl-3 Diisostearate, Sodium Hyaluronate, Ceramide NP, Cholesterol, Phytosphingosine, Tocopherol';
      const tokens = text.split(',').map(t => t.trim());
      const result = v2Checks(text, tokens);

      expect(result.commaDensityOk).toBe(true);
      expect(result.maxLenOk).toBe(true);
      expect(result.hasBadPhrases).toBe(false);
      expect(result.dictCoverage).toBeGreaterThan(0.3);
    });

    it('validates typical supplement ingredient list', () => {
      const text = 'Vitamin D3 (Cholecalciferol), Calcium Carbonate, Magnesium Oxide, Zinc Gluconate, Cellulose, Stearic Acid, Silicon Dioxide, Magnesium Stearate';
      const tokens = text.split(',').map(t => t.trim());
      const result = v2Checks(text, tokens);

      expect(result.commaDensityOk).toBe(true);
      expect(result.maxLenOk).toBe(true);
      expect(result.hasBadPhrases).toBe(false);
    });

    it('rejects marketing copy', () => {
      const marketingText = 'Our herbal supplements are designed to support your healthy lifestyle and unlock your full potential with powerful ingredients';
      const tokens = marketingText.split(',').map(t => t.trim());
      const result = v2Checks(marketingText, tokens);

      expect(result.commaDensityOk).toBe(false); // No commas
      expect(result.hasBadPhrases).toBe(true); // Contains "powered by" or similar
    });
  });
});
