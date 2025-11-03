// web/lib/__tests__/jsonld.test.ts
import { parseJsonLdIdentity, extractJsonLdProduct } from '../jsonld';
import type { PageSignals } from '../identity';

describe('jsonld.ts - Phase A', () => {
  describe('parseJsonLdIdentity', () => {
    it('extracts brand and name from Product node', () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Moisturizing Cream",
              "brand": {
                "@type": "Brand",
                "name": "CeraVe"
              },
              "gtin13": "0123456789012"
            }
            </script>
          </head>
        </html>
      `;

      const result = parseJsonLdIdentity(html);

      expect(result.brand).toBe('CeraVe');
      expect(result.name).toBe('Moisturizing Cream');
      expect(result.gtin).toBe('0123456789012');
    });

    it('handles brand as string', () => {
      const html = `
        <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "Test Product",
          "brand": "TestBrand"
        }
        </script>
      `;

      const result = parseJsonLdIdentity(html);

      expect(result.brand).toBe('TestBrand');
    });

    it('handles missing JSON-LD', () => {
      const html = '<html><body>No JSON-LD here</body></html>';

      const result = parseJsonLdIdentity(html);

      expect(result.brand).toBe('');
      expect(result.name).toBe('');
      expect(result.gtin).toBeNull();
    });

    it('extracts GTIN from various formats', () => {
      const html = `
        <script type="application/ld+json">
        {
          "@type": "Product",
          "gtin14": "10012345678902"
        }
        </script>
      `;

      const result = parseJsonLdIdentity(html);

      expect(result.gtin).toBe('10012345678902');
    });

    it('handles invalid JSON gracefully', () => {
      const html = `
        <script type="application/ld+json">
        { invalid json here
        </script>
      `;

      const result = parseJsonLdIdentity(html);

      expect(result).toEqual({ brand: '', name: '', gtin: null });
    });
  });

  describe('extractJsonLdProduct', () => {
    it('extracts ingredients from Product node', () => {
      const html = `
        <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "Moisturizing Cream",
          "brand": "CeraVe",
          "ingredients": "Water, Glycerin, Cetearyl Alcohol, Ceramide NP"
        }
        </script>
      `;

      const pageSignals: PageSignals = {
        title: 'CeraVe Moisturizing Cream',
        h1: 'Moisturizing Cream',
        breadcrumbs: [],
        urlHost: 'cerave.com'
      };

      const result = extractJsonLdProduct(html, pageSignals);

      expect(result.ingredients).toContain('Water');
      expect(result.ingredients).toContain('Glycerin');
      expect(result.warnings.length).toBe(0);
    });

    it('validates brand name matches page signals', () => {
      const html = `
        <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "Moisturizing Cream",
          "brand": "WrongBrand",
          "ingredients": "Water, Glycerin"
        }
        </script>
      `;

      const pageSignals: PageSignals = {
        title: 'CeraVe Moisturizing Cream',
        h1: 'CeraVe Moisturizing Cream',
        breadcrumbs: ['CeraVe'],
        urlHost: 'cerave.com'
      };

      const result = extractJsonLdProduct(html, pageSignals);

      // Should detect brand mismatch
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('brand'))).toBe(true);
    });

    it('handles missing ingredients field', () => {
      const html = `
        <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "Test Product",
          "brand": "TestBrand"
        }
        </script>
      `;

      const pageSignals: PageSignals = {
        title: 'Test Product',
        h1: '',
        breadcrumbs: [],
        urlHost: 'test.com'
      };

      const result = extractJsonLdProduct(html, pageSignals);

      expect(result.ingredients).toBeNull();
    });

    it('validates product name matches page signals', () => {
      const html = `
        <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "Completely Different Product",
          "brand": "CeraVe",
          "ingredients": "Water, Glycerin"
        }
        </script>
      `;

      const pageSignals: PageSignals = {
        title: 'CeraVe Moisturizing Cream',
        h1: 'Moisturizing Cream',
        breadcrumbs: [],
        urlHost: 'cerave.com'
      };

      const result = extractJsonLdProduct(html, pageSignals);

      // Should detect name mismatch
      expect(result.warnings.some(w => w.includes('name'))).toBe(true);
    });

    it('handles multiple JSON-LD nodes', () => {
      const html = `
        <script type="application/ld+json">
        [
          {
            "@type": "BreadcrumbList"
          },
          {
            "@type": "Product",
            "name": "Moisturizing Cream",
            "brand": "CeraVe",
            "ingredients": "Water, Glycerin"
          }
        ]
        </script>
      `;

      const pageSignals: PageSignals = {
        title: 'CeraVe Moisturizing Cream',
        h1: '',
        breadcrumbs: [],
        urlHost: 'cerave.com'
      };

      const result = extractJsonLdProduct(html, pageSignals);

      expect(result.ingredients).toContain('Water');
    });
  });
});
