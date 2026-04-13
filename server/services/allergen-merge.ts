/**
 * Allergen merge decision helper.
 * Source priority: MANUAL > USDA_VERIFIED > AI_SUGGESTED > ROLLUP
 * Severity never downgrades: CONTAINS is never downgraded to MAY_CONTAIN.
 */

export type AllergenSource = 'USDA_VERIFIED' | 'AI_SUGGESTED' | 'MANUAL' | 'ROLLUP';
export type AllergenSeverity = 'CONTAINS' | 'MAY_CONTAIN';

export interface AllergenRecord {
  source: AllergenSource;
  severity: AllergenSeverity;
  confidence?: number | null;
}

export type MergeAction =
  | { action: 'insert'; data: AllergenRecord; reason: 'no-existing' }
  | { action: 'update'; data: AllergenRecord; reason: string }
  | { action: 'skip'; reason: 'existing-stronger'; existingSource: AllergenSource };

const SOURCE_STRENGTH: Record<AllergenSource, number> = {
  MANUAL: 4,
  USDA_VERIFIED: 3,
  AI_SUGGESTED: 2,
  ROLLUP: 1,
};

const SEVERITY_STRENGTH: Record<AllergenSeverity, number> = {
  CONTAINS: 2,
  MAY_CONTAIN: 1,
};

function maxSeverity(a: AllergenSeverity, b: AllergenSeverity): AllergenSeverity {
  return SEVERITY_STRENGTH[a] >= SEVERITY_STRENGTH[b] ? a : b;
}

export function mergeAllergenDecision(
  existing: AllergenRecord | null,
  proposed: AllergenRecord,
): MergeAction {
  if (!existing) {
    return { action: 'insert', data: proposed, reason: 'no-existing' };
  }

  const existingStrength = SOURCE_STRENGTH[existing.source];
  const proposedStrength = SOURCE_STRENGTH[proposed.source];

  if (existingStrength > proposedStrength) {
    return { action: 'skip', reason: 'existing-stronger', existingSource: existing.source };
  }

  const mergedSeverity = maxSeverity(existing.severity, proposed.severity);
  const mergedSource: AllergenSource =
    proposedStrength >= existingStrength ? proposed.source : existing.source;

  return {
    action: 'update',
    data: {
      source: mergedSource,
      severity: mergedSeverity,
      confidence:
        mergedSource === proposed.source ? proposed.confidence : existing.confidence,
    },
    reason: 'merge',
  };
}
