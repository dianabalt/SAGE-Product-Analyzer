// web/lib/debugContext.ts
// Structured debug context for concise JSON logging

export type DebugContext = {
  scanId?: string;
  productName?: string;
  productUrl?: string;

  // Pipeline stages
  pipeline: {
    domAttempted: boolean;
    domSuccess: boolean;
    domExtractor?: string; // 'dailymed' | 'incidecoder' | 'skinsort' | 'sephora' | 'ulta' | 'amazon' | 'generic'
    webResearchNeeded: boolean;
    webResearchAttempted: boolean;
    webResearchSuccess: boolean;
    webResearchSources?: string[];
  };

  // Extraction results
  extraction: {
    totalIngredients: number;
    activeIngredients?: number;
    inactiveIngredients?: number;
    confidence?: number;
    droppedTokens: Array<{ token: string; reason: string }>;
  };

  // Grading results
  grading?: {
    grade: string;
    numericGrade: number;
    issuesCount: number;
  };

  // Timing breakdown
  timing: {
    startTime: number;
    domSeconds?: number;
    researchSeconds?: number;
    gradingSeconds?: number;
    dbSeconds?: number;
    totalSeconds?: number;
  };
};

/**
 * Create a new debug context with initial values
 */
export function createDebugContext(): DebugContext {
  return {
    pipeline: {
      domAttempted: false,
      domSuccess: false,
      webResearchNeeded: false,
      webResearchAttempted: false,
      webResearchSuccess: false,
    },
    extraction: {
      totalIngredients: 0,
      droppedTokens: [],
    },
    timing: {
      startTime: Date.now(),
    },
  };
}

/**
 * Print debug context as concise JSON summary
 *
 * Example output:
 * {
 *   "product_name": "Flakes Anti-Dandruff Shampoo",
 *   "source": "https://skinsort.com/products/flakes/anti-dandruff-shampoo",
 *   "extractor_used": "skinsort",
 *   "ingredients": {
 *     "total": 16,
 *     "active": 1,
 *     "inactive": 15
 *   },
 *   "confidence": 0.85,
 *   "grade": "C",
 *   "numeric_grade": 75,
 *   "pipeline": {
 *     "dom_attempted": true,
 *     "dom_success": true,
 *     "web_research_needed": false
 *   },
 *   "dropped_tokens": [
 *     {"token": "Copy", "reason": "too short"},
 *     {"token": "Updated September 3 2024", "reason": "no ingredient hints"}
 *   ],
 *   "timing": {
 *     "total_seconds": 18.5,
 *     "research_seconds": 0,
 *     "grading_seconds": 10.1,
 *     "db_seconds": 5.7
 *   }
 * }
 */
export function printScanSummary(ctx: DebugContext): void {
  // Calculate total time
  const totalSeconds = ctx.timing.totalSeconds ??
    (Date.now() - ctx.timing.startTime) / 1000;

  const summary: Record<string, unknown> = {
    scan_id: ctx.scanId,
    product_name: ctx.productName,
    source: ctx.productUrl,
    extractor_used: ctx.pipeline.domExtractor,
  };

  // Ingredients breakdown
  summary.ingredients = {
    total: ctx.extraction.totalIngredients,
  };

  if (ctx.extraction.activeIngredients !== undefined) {
    (summary.ingredients as Record<string, unknown>).active = ctx.extraction.activeIngredients;
  }
  if (ctx.extraction.inactiveIngredients !== undefined) {
    (summary.ingredients as Record<string, unknown>).inactive = ctx.extraction.inactiveIngredients;
  }

  // Confidence and grading
  if (ctx.extraction.confidence !== undefined) {
    summary.confidence = ctx.extraction.confidence;
  }

  if (ctx.grading) {
    summary.grade = ctx.grading.grade;
    summary.numeric_grade = ctx.grading.numericGrade;
    summary.issues_count = ctx.grading.issuesCount;
  }

  // Pipeline status
  summary.pipeline = {
    dom_attempted: ctx.pipeline.domAttempted,
    dom_success: ctx.pipeline.domSuccess,
    web_research_needed: ctx.pipeline.webResearchNeeded,
  };

  if (ctx.pipeline.webResearchAttempted) {
    (summary.pipeline as Record<string, unknown>).web_research_attempted = true;
    (summary.pipeline as Record<string, unknown>).web_research_success = ctx.pipeline.webResearchSuccess;
  }

  if (ctx.pipeline.webResearchSources && ctx.pipeline.webResearchSources.length > 0) {
    (summary.pipeline as Record<string, unknown>).web_research_sources = ctx.pipeline.webResearchSources;
  }

  // Dropped tokens (limit to first 5)
  if (ctx.extraction.droppedTokens.length > 0) {
    summary.dropped_tokens = ctx.extraction.droppedTokens.slice(0, 5);
    if (ctx.extraction.droppedTokens.length > 5) {
      (summary as { dropped_tokens_truncated?: number }).dropped_tokens_truncated = ctx.extraction.droppedTokens.length - 5;
    }
  }

  // Timing breakdown
  summary.timing = {
    total_seconds: Number(totalSeconds.toFixed(1)),
  };

  if (ctx.timing.domSeconds !== undefined) {
    (summary.timing as Record<string, unknown>).dom_seconds = Number(ctx.timing.domSeconds.toFixed(1));
  }
  if (ctx.timing.researchSeconds !== undefined) {
    (summary.timing as Record<string, unknown>).research_seconds = Number(ctx.timing.researchSeconds.toFixed(1));
  }
  if (ctx.timing.gradingSeconds !== undefined) {
    (summary.timing as Record<string, unknown>).grading_seconds = Number(ctx.timing.gradingSeconds.toFixed(1));
  }
  if (ctx.timing.dbSeconds !== undefined) {
    (summary.timing as Record<string, unknown>).db_seconds = Number(ctx.timing.dbSeconds.toFixed(1));
  }

  console.log('\n=== SCAN SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('====================\n');
}

/**
 * Track dropped token in debug context (limit to first 20)
 */
export function trackDroppedToken(ctx: DebugContext, token: string, reason: string): void {
  if (ctx.extraction.droppedTokens.length < 20) {
    ctx.extraction.droppedTokens.push({ token, reason });
  }
}
