// web/lib/flags.ts
/**
 * SAGE v2 Feature Flags - Centralized Configuration
 * All feature flag reads go through this module for testability and consistency.
 *
 * Phase A (Shadow Mode):
 * - All flags default to FALSE
 * - When enabled, new features run in shadow mode (log decisions, don't block)
 * - SAGE_ENFORCE_GATE controls whether gates actually block requests
 *
 * Usage:
 *   import { flags } from './flags';
 *   if (flags.identityGate) { ... }
 */

export const flags = {
  /**
   * Enable identity scoring to validate product matches
   * Checks: brand (hard gate), name tokens, size, form, scent, GTIN
   */
  identityGate: process.env.SAGE_FEATURE_IDENTITY_GATE === 'true',

  /**
   * Enable JSON-LD structured data extraction as first-pass candidate
   * Extracts: product name, brand, GTIN, ingredients from <script type="application/ld+json">
   */
  jsonldFirst: process.env.SAGE_FEATURE_JSONLD_FIRST === 'true',

  /**
   * Enable enhanced validation v2 with structural checks
   * Checks: comma density, max length, bad phrases, dictionary coverage
   */
  validatorV2: process.env.SAGE_FEATURE_VALIDATOR_V2 === 'true',

  /**
   * Actually enforce gates (block requests that fail validation)
   * When FALSE: gates run in shadow mode (log only, don't block)
   * When TRUE: gates block invalid requests
   */
  enforceGate: process.env.SAGE_ENFORCE_GATE === 'true',

  /**
   * Minimum identity score required to pass (default: 4.0)
   * Scoring:
   * - Brand match (hard gate): 3.0 base points
   * - Domain boost (manufacturer site): +0.5
   * - Name token matches: +0.0 to +1.0
   * - Size match: +1.0
   * - Form match: +0.5
   * - Scent match: +0.75
   * - GTIN exact match: +5.0 (decisive)
   */
  identityThreshold: Number(process.env.SAGE_IDENTITY_THRESHOLD ?? 4.0)
};

/**
 * Override flags for testing (unit tests only)
 * DO NOT use in production code
 */
export function setTestFlags(overrides: Partial<typeof flags>): void {
  Object.assign(flags, overrides);
}

/**
 * Get current flag state as JSON (for debugging/logging)
 */
export function getFlagState(): Record<string, boolean | number> {
  return {
    identityGate: flags.identityGate,
    jsonldFirst: flags.jsonldFirst,
    validatorV2: flags.validatorV2,
    enforceGate: flags.enforceGate,
    identityThreshold: flags.identityThreshold
  };
}
