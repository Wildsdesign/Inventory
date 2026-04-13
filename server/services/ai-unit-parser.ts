/**
 * AI Unit Parser — purchase description → cost per base unit.
 *
 * Accepts a vendor purchase description (e.g. "12/15 oz", "50 lb bag"),
 * extracts total unit count, divides case cost by units → cost per base unit.
 *
 * Parse path (fastest first):
 *   1. Deterministic regex (deterministicPackSizeParse) — handles 90%+ of formats
 *   2. AI call (claude-haiku) — fallback for complex descriptions
 *   3. Hard fallback — returns 1 each at full cost
 *
 * Confidence classification:
 *   HIGH   — deterministic regex match, or AI + math validates
 *   MEDIUM — AI parse with inconclusive math, or ambiguous description
 *   LOW    — AI failed/fallback used, or AI low confidence
 */

import { anthropic as client } from "../lib/anthropic";
import { log } from "../utils/logger";

export interface UnitParseResult {
  packSize: number;           // Number of containers (e.g., 12 cans)
  unitSize: number;           // Size of each container in recipe units (e.g., 15 oz per can)
  baseUnit: string;           // Recipe unit (e.g., "oz")
  unitsPerPurchase: number;   // Total recipe units per purchase = packSize × unitSize (e.g., 180 oz)
  unitCost: number;           // Cost per recipe unit (e.g., $0.122/oz)
  confidence: number;
  rawInput: string;
  autoConfidence?: 'high' | 'medium' | 'low';
  confidenceReason?: string;
  alternatives?: AlternativeParse[];
  usedFallback?: boolean;
}

export interface AlternativeParse {
  unitsPerPurchase: number;
  baseUnit: string;
  unitCost: number;
  label?: string;
}

/**
 * Confidence classification for unit parse results.
 */
export function classifyConfidence(
  result: UnitParseResult,
  cost: number,
  source: 'cache' | 'ai' | 'fallback' | 'regex',
  description: string,
): { level: 'high' | 'medium' | 'low'; reason: string } {
  // Deterministic regex match → HIGH
  if (source === 'regex' || (source === 'fallback' && result.confidence >= 1)) {
    return { level: 'high', reason: 'Deterministic pattern match' };
  }

  // Math validation: does unitCost * unitsPerPurchase ≈ original cost?
  const reconstructedCost = result.unitCost * result.unitsPerPurchase;
  const costDiff = Math.abs(reconstructedCost - cost) / cost;
  const mathValidates = costDiff <= 0.02;
  const mathFails = costDiff > 0.05;

  const portionedNouns = /\b(patties?|slices?|portions?|pieces?|buns?|bars?|cups?|bottles?|cans?|rolls?|packets?)\b/i;
  const hasPortionedNoun = portionedNouns.test(description);

  const hasWeight = /\b\d+(?:\.\d+)?\s*(lb|oz|kg|g|gal)\b/i.test(description);
  const hasCount = /\b\d+\s*(slices?|patties?|bottles?|cans?|portions?|pieces?|ct|count)\b/i.test(description);
  const isAmbiguous = hasWeight && hasCount && !hasPortionedNoun;

  // Fallback parse used → LOW
  if (source === 'fallback' && result.confidence < 1) {
    return { level: 'low', reason: 'AI failed, used fallback parse' };
  }

  // AI parse with failed math → LOW
  if (source === 'ai' && mathFails) {
    return { level: 'low', reason: 'AI parse math does not validate (>5% cost difference)' };
  }

  // AI returned low confidence → LOW
  if (source === 'ai' && result.confidence < 0.6) {
    return { level: 'low', reason: 'AI reported low confidence' };
  }

  // Portioned noun + math validates → HIGH
  if (hasPortionedNoun && mathValidates && (source === 'ai' || source === 'cache')) {
    return { level: 'high', reason: 'Portioned item, count-based parse, math validates' };
  }

  // Ambiguous description (both weight AND count, no portioned noun) → MEDIUM
  if (isAmbiguous) {
    return { level: 'medium', reason: 'Description contains both weight and count units' };
  }

  // AI parse with math validation → HIGH
  if (source === 'ai' && mathValidates) {
    return { level: 'high', reason: 'AI parse, math validates, unambiguous description' };
  }

  // Default → MEDIUM
  return { level: 'medium', reason: 'AI parse, math inconclusive' };
}

const CONTAINER_MULTIPLIERS: Record<string, number> = {
  doz: 12, dozen: 12, gross: 144, pair: 2,
};

function applyContainerExpansionHeuristic(result: UnitParseResult, itemName?: string | null): void {
  if (!result.alternatives || !itemName) return;
  const baseUnitLower = result.baseUnit.toLowerCase();
  const multiplier = CONTAINER_MULTIPLIERS[baseUnitLower];
  if (!multiplier || multiplier <= 1) return;

  if ((baseUnitLower === 'doz' || baseUnitLower === 'dozen') && !/\bEGGS?\b/i.test(itemName)) return;
  if (baseUnitLower !== 'doz' && baseUnitLower !== 'dozen') return;

  const expandedIdx = result.alternatives.findIndex(a =>
    a.baseUnit === 'each' && a.unitsPerPurchase === result.unitsPerPurchase * multiplier
  );
  if (expandedIdx < 0) return;

  const expanded = result.alternatives[expandedIdx];
  result.alternatives[expandedIdx] = {
    unitsPerPurchase: result.unitsPerPurchase,
    baseUnit: result.baseUnit,
    unitCost: result.unitCost,
    label: `${result.unitsPerPurchase} ${result.baseUnit} @ $${result.unitCost.toFixed(3)}/${result.baseUnit}`,
  };
  result.unitsPerPurchase = expanded.unitsPerPurchase;
  result.baseUnit = expanded.baseUnit;
  result.unitCost = expanded.unitCost;
}

/**
 * Generate deterministic alternative interpretations from a description.
 * Uses regex extraction + arithmetic — NO AI calls.
 * Only generated for medium and low confidence items.
 */
export function generateAlternatives(
  description: string,
  cost: number,
  primaryParse: { unitsPerPurchase: number; baseUnit: string; unitCost: number },
  itemName?: string | null,
): AlternativeParse[] {
  const alternatives: AlternativeParse[] = [];

  const isSameAs = (alt: { unitsPerPurchase: number; baseUnit: string }) =>
    alt.unitsPerPurchase === primaryParse.unitsPerPurchase &&
    alt.baseUnit.toLowerCase() === primaryParse.baseUnit.toLowerCase();

  const containerMultiplier = CONTAINER_MULTIPLIERS[primaryParse.baseUnit.toLowerCase()];
  if (containerMultiplier && containerMultiplier > 1) {
    const expandedQty = primaryParse.unitsPerPurchase * containerMultiplier;
    const expandedUnitCost = Number((cost / expandedQty).toFixed(4));
    const expandedAlt = {
      unitsPerPurchase: expandedQty,
      baseUnit: 'each',
      unitCost: expandedUnitCost,
      label: `${expandedQty} each @ $${expandedUnitCost.toFixed(3)}/each ← expanded to individual units`,
    };
    if (!isSameAs(expandedAlt)) {
      alternatives.push(expandedAlt);
    }
  }

  const weightMatch = description.match(/(\d+(?:\.\d+)?)\s*(lb|oz|kg|g|gal)\b/i);
  if (weightMatch) {
    const qty = parseFloat(weightMatch[1]);
    const unit = weightMatch[2].toLowerCase();
    if (qty > 0) {
      const alt = { unitsPerPurchase: qty, baseUnit: unit, unitCost: Number((cost / qty).toFixed(4)) };
      if (!isSameAs(alt)) {
        alternatives.push({ ...alt, label: `${qty} ${unit} @ $${alt.unitCost.toFixed(3)}/${unit}` });
      }
    }
  }

  const countMatch = description.match(/(\d+)\s*(slices?|patties?|bottles?|cans?|packs?|bags?|portions?|bars?|cups?|pieces?|ct|count)\b/i);
  if (countMatch) {
    const qty = parseInt(countMatch[1]);
    const rawUnit = countMatch[2].toLowerCase().replace(/s$/, '').replace(/ie$/, 'y');
    const unit = rawUnit === 'ct' || rawUnit === 'count' ? 'each' : rawUnit;
    if (qty > 0) {
      const alt = { unitsPerPurchase: qty, baseUnit: unit, unitCost: Number((cost / qty).toFixed(4)) };
      if (!isSameAs(alt)) {
        alternatives.push({ ...alt, label: `${qty} ${unit} @ $${alt.unitCost.toFixed(3)}/${unit}` });
      }
    }
  }

  const multiMatch = description.match(/(\d+)\s*[x×]\s*(\d+)/i)
    || description.match(/(\d+)\s*packs?\s*of\s*(\d+)/i);
  if (multiMatch) {
    const total = parseInt(multiMatch[1]) * parseInt(multiMatch[2]);
    if (total > 0) {
      const alt = { unitsPerPurchase: total, baseUnit: "each", unitCost: Number((cost / total).toFixed(4)) };
      if (!isSameAs(alt)) {
        alternatives.push({ ...alt, label: `${total} each @ $${alt.unitCost.toFixed(3)}/each` });
      }
    }
  }

  const packAlt = { unitsPerPurchase: 1, baseUnit: "each", unitCost: cost };
  if (!isSameAs(packAlt)) {
    alternatives.push({ ...packAlt, label: `1 pack @ $${cost.toFixed(2)}/each` });
  }

  return alternatives.slice(0, 4);
}

/**
 * Synthesize a purchase description from available columns.
 * If Pack=12 and Size="15 OZ", builds "12/15 oz" for the AI.
 */
export function synthesizePurchaseDescription(
  purchaseDescription: string | null,
  packSize: number | null,
  itemSize: string | number | null,
  itemName?: string | null,
  rawPackSize?: string | null,
): string {
  if (purchaseDescription && purchaseDescription.trim() !== '') {
    return purchaseDescription.trim();
  }

  if (rawPackSize && /\d+\//.test(rawPackSize) && /[a-zA-Z]/.test(rawPackSize)) {
    return rawPackSize.trim();
  }

  const parts: string[] = [];

  if (packSize && packSize > 1) {
    parts.push(String(packSize));
  }

  if (itemSize) {
    const sizeStr = String(itemSize).trim();
    const isJunk = /^[A-Za-z]$/.test(sizeStr) || !/\d/.test(sizeStr);
    if (sizeStr && !isJunk) {
      if (parts.length > 0) {
        parts.push('/');
      }
      parts.push(sizeStr);
    }
  }

  if (parts.length > 0) {
    const synthesized = parts.join('');
    if (/[a-zA-Z]/.test(synthesized) || (packSize && packSize > 1)) {
      return synthesized;
    }
  }

  if (itemName) {
    const namePackMatch = itemName.match(/(\d+)\s*(?:pk|pack|ct|count)/i);
    const nameSizeMatch = itemName.match(/(\d+(?:\.\d+)?)\s*(oz|lb|gal|ml|l|fl\s*oz)/i);
    if (namePackMatch || nameSizeMatch) {
      const extractedParts: string[] = [];
      if (namePackMatch) extractedParts.push(namePackMatch[1]);
      if (nameSizeMatch) {
        if (extractedParts.length > 0) extractedParts.push('/');
        extractedParts.push(`${nameSizeMatch[1]} ${nameSizeMatch[2]}`);
      }
      if (extractedParts.length > 0) {
        return extractedParts.join('');
      }
    }
  }

  return '';
}

/**
 * Parse a purchase description using deterministic regex + AI fallback.
 */
export async function parseUnitWithAI(
  purchaseUnit: string,
  purchaseCost: number,
  extraContext?: {
    packSize?: number | null;
    rawPackSize?: string | null;
    itemSize?: string | number | null;
    itemName?: string | null;
    costType?: 'case_price' | 'unit_price' | 'split_price';
  },
): Promise<UnitParseResult> {
  const synthesized = synthesizePurchaseDescription(
    purchaseUnit,
    extraContext?.packSize ?? null,
    extraContext?.itemSize ?? null,
    extraContext?.itemName ?? null,
    extraContext?.rawPackSize ?? null,
  );
  const rawInput = purchaseUnit || synthesized;

  if (!synthesized || synthesized.trim() === "") {
    return {
      packSize: 1,
      unitSize: 1,
      baseUnit: "each",
      unitsPerPurchase: 1,
      unitCost: purchaseCost,
      confidence: 1,
      rawInput,
      autoConfidence: 'high',
      confidenceReason: 'No description — default to each',
    };
  }

  // ─── Tier 1: Deterministic regex parse ──────────────────────────────────
  const deterministicResult = deterministicPackSizeParse(synthesized, purchaseCost, extraContext?.itemName, extraContext?.costType);
  if (deterministicResult) {
    log.event(`Deterministic parse: "${synthesized}" → ${deterministicResult.unitsPerPurchase} ${deterministicResult.baseUnit}, $${deterministicResult.unitCost.toFixed(4)}/unit`, {
      operation: "deterministicParse",
    });
    return buildFinalResult(deterministicResult, purchaseCost, synthesized, 'regex', extraContext?.itemName);
  }

  // ─── Tier 2: AI call ─────────────────────────────────────────────────────
  let contextLine = '';
  if (extraContext?.packSize) {
    contextLine += `\nPack/Case Size column value: ${extraContext.packSize}`;
  }
  if (extraContext?.itemSize) {
    contextLine += `\nItem Size column value: ${extraContext.itemSize}`;
  }
  if (extraContext?.itemName) {
    contextLine += `\nItem Name: "${extraContext.itemName}"`;
  }

  const prompt = `Parse this purchase unit to calculate total recipe units and cost per unit.

Purchase Unit: "${synthesized}"
Purchase Cost: $${purchaseCost.toFixed(2)}${contextLine}

Return ONLY valid JSON (no markdown, no explanation):
{
  "packSize": <number of containers in purchase>,
  "unitSize": <size of each container in recipe units>,
  "baseUnit": "<recipe unit in lowercase (oz, lb, gal, each, etc.)>",
  "unitsPerPurchase": <total recipe units = packSize × unitSize>,
  "unitCost": <cost per recipe unit = purchaseCost / unitsPerPurchase>,
  "confidence": <0-1>
}

IMPORTANT: For recipe costing, we need the TOTAL amount in the smallest usable unit (oz, lb, gal, each).

Examples:
- "12/15 oz" = 12 cans × 15 oz each = {packSize: 12, unitSize: 15, baseUnit: "oz", unitsPerPurchase: 180}
- "Case (4x1gal)" = 4 × 1 gal = {packSize: 4, unitSize: 1, baseUnit: "gal", unitsPerPurchase: 4}
- "Bag (25lb)" = 1 bag × 25 lb = {packSize: 1, unitSize: 25, baseUnit: "lb", unitsPerPurchase: 25}
- "Box (12ct)" = 12 × 1 each = {packSize: 12, unitSize: 1, baseUnit: "each", unitsPerPurchase: 12}
- "6/#10 can" = 6 cans × ~106 oz each = {packSize: 6, unitSize: 106, baseUnit: "oz", unitsPerPurchase: 636}
- "Case of 40 patties 4oz each" = 40 patties = {packSize: 40, unitSize: 4, baseUnit: "oz", unitsPerPurchase: 160}
- "50 lb bag" = 1 × 50 = {packSize: 1, unitSize: 50, baseUnit: "lb", unitsPerPurchase: 50}

UNIT INTERPRETATION RULES:
1. If the description contains PORTIONED NOUNS (patties, slices, portions, pieces, buns, bars, cups, bottles, cans, rolls, packets), prefer COUNT over weight.
2. For BULK ingredients with no portion count (bags, cases of raw product), prefer weight (lb, oz, kg, g).
3. Volume items: "gallon jug" = 1 gal. "12 quarts per case" = 12 qt.
4. "#10 can" = 1 unit. "6/#10 cans" = 6 units per purchase.

If you cannot parse it, return packSize: 1, unitSize: 1, baseUnit: "each", unitsPerPurchase: 1, confidence: 0.5`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return buildFinalResult(fallbackParse(synthesized, purchaseCost, rawInput), purchaseCost, synthesized, 'fallback', extraContext?.itemName);
    }

    let jsonStr = textBlock.text.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    const packSize = parsed.packSize || 1;
    const unitSize = parsed.unitSize || 1;
    const unitsPerPurchase = parsed.unitsPerPurchase || (packSize * unitSize);
    let unitCost: number;
    if (extraContext?.costType === 'unit_price') {
      unitCost = purchaseCost;
    } else if (extraContext?.costType === 'split_price') {
      unitCost = unitSize > 0 ? purchaseCost / unitSize : purchaseCost;
    } else {
      unitCost = unitsPerPurchase > 0 ? purchaseCost / unitsPerPurchase : purchaseCost;
    }

    const result: UnitParseResult = {
      packSize,
      unitSize,
      baseUnit: (parsed.baseUnit || "each").toLowerCase(),
      unitsPerPurchase,
      unitCost: Number(unitCost.toFixed(4)),
      confidence: parsed.confidence || 0.5,
      rawInput,
    };

    return buildFinalResult(result, purchaseCost, synthesized, 'ai', extraContext?.itemName);
  } catch (error) {
    log.error(error, { operation: 'parseUnitWithAI', purchaseUnit: synthesized });
    return buildFinalResult(fallbackParse(synthesized, purchaseCost, rawInput), purchaseCost, synthesized, 'fallback', extraContext?.itemName);
  }
}

function buildFinalResult(
  result: UnitParseResult,
  cost: number,
  description: string,
  source: 'ai' | 'fallback' | 'regex',
  itemName?: string | null,
): UnitParseResult {
  const classification = classifyConfidence(result, cost, source, description);
  result.autoConfidence = classification.level;
  result.confidenceReason = classification.reason;
  result.usedFallback = source === 'fallback';

  if (classification.level !== 'high') {
    result.alternatives = generateAlternatives(description, cost, {
      unitsPerPurchase: result.unitsPerPurchase,
      baseUnit: result.baseUnit,
      unitCost: result.unitCost,
    }, itemName);
    applyContainerExpansionHeuristic(result, itemName);
  }

  return result;
}

// ─── Industry Standard Institutional Can Sizes (oz) ─────────────────────────
const CAN_SIZES: Record<string, number> = {
  '10': 106,
  '5': 56,
  '3': 33,
  '2.5': 28,
  '2': 20,
  '1': 11,
  '300': 15,
  '303': 16,
};

/**
 * Deterministic pack/size parser — no AI, regex-only.
 * Handles 90%+ of real vendor invoice formats (Sysco, US Foods, GFS).
 * Returns null if no pattern matches (falls through to AI).
 */
export function deterministicPackSizeParse(
  description: string,
  cost: number,
  itemName?: string | null,
  costType?: string,
): UnitParseResult | null {
  let desc = description.trim();
  if (!desc) return null;

  // Single-serve items are always "each"
  const singleServePattern = /\b(single\s*serve|pkt|packet|packets|portion|portions|cup|cups|bowl\s*pak|bowl\s*pack|individual|indiv)\b/i;
  if (itemName && singleServePattern.test(itemName)) {
    const packMatch = desc.match(/^(\d+)\s*[\/x×]/i);
    const packCount = packMatch ? parseInt(packMatch[1]) : 1;
    const unitCost = packCount > 1 ? Number((cost / packCount).toFixed(4)) : cost;
    return {
      packSize: packCount,
      unitSize: 1,
      baseUnit: 'each',
      unitsPerPurchase: packCount,
      unitCost,
      confidence: 0.9,
      rawInput: desc,
    };
  }

  // # AFTER a digit = pounds (Sysco/GFS shorthand: 5#, 10#)
  desc = desc.replace(/(\d)#/g, '$1 lb').trim();

  // CS/ prefix = "case of"
  desc = desc.replace(/^CS\s*\/\s*/i, '1/');

  // Spelled-out unit aliases → abbreviations
  const SPELLED_UNITS: [RegExp, string][] = [
    [/\bpounds?\b/gi, 'lb'],
    [/\bounces?\b/gi, 'oz'],
    [/\bgallons?\b/gi, 'gal'],
    [/\bquarts?\b/gi, 'qt'],
    [/\bpints?\b/gi, 'pt'],
    [/\bliters?\b/gi, 'l'],
    [/\blitres?\b/gi, 'l'],
  ];

  for (const [pattern, replacement] of SPELLED_UNITS) {
    desc = desc.replace(pattern, replacement);
  }

  // Dash as separator: 6-1lb → 6/1lb (GFS format)
  desc = desc.replace(/^(\d+)\s*-\s*(\d)/, '$1/$2');

  desc = desc.trim();

  // Helper to build result
  const result = (pack: number, unitSz: number, unit: string, conf: number): UnitParseResult => {
    const total = pack * unitSz;
    let unitCost: number;
    if (costType === 'unit_price') {
      unitCost = cost;
    } else if (costType === 'split_price') {
      unitCost = unitSz > 0 ? Number((cost / unitSz).toFixed(4)) : cost;
    } else {
      unitCost = total > 0 ? Number((cost / total).toFixed(4)) : cost;
    }
    return {
      packSize: pack,
      unitSize: unitSz,
      baseUnit: unit.toLowerCase(),
      unitsPerPurchase: total,
      unitCost,
      confidence: conf,
      rawInput: desc,
    };
  };

  // ── Count detection (item name + purchase description) ─────────────────
  const countSources = [itemName, desc].filter(Boolean) as string[];
  for (const source of countSources) {
    const text = source.toUpperCase();
    const hasCountSuffix = /\d+\s*(?:CT|COUNT|PK|PACK|SLICES?)\b/i.test(text);

    if (hasCountSuffix) {
      const rangeCtMatch = text.match(/(\d+)\s*\/\s*(\d+)\s*(?:CT|COUNT)\b/i);
      if (rangeCtMatch) {
        const low = parseInt(rangeCtMatch[1]);
        const high = parseInt(rangeCtMatch[2]);
        const mid = Math.round((low + high) / 2);
        return result(mid, 1, 'each', 1);
      }

      const ctMatch = text.match(/(\d+)\s*(?:CT|COUNT)\b/i);
      if (ctMatch) {
        const count = parseInt(ctMatch[1]);
        if (count >= 2) {
          return result(count, 1, 'each', 1);
        }
      }

      const pkMatch = text.match(/(\d+)\s*(?:PK|PACK)\b/i);
      if (pkMatch) {
        const count = parseInt(pkMatch[1]);
        if (count >= 2) {
          return result(count, 1, 'each', 1);
        }
      }

      const sliceMatch = text.match(/(\d+)\s*SLICES?\b/i);
      if (sliceMatch) {
        const count = parseInt(sliceMatch[1]);
        if (count >= 2) {
          return result(count, 1, 'each', 1);
        }
      }
    }
  }

  // Pattern 1: N/#CAN_SIZE can — "6/#10 can", "6/#10"
  // Institutional cans tracked as "each" (you open a can, you use a can)
  const canMatch = desc.match(/^(\d+)\s*\/\s*#(\d+(?:\.\d+)?)\s*(?:can|cans?)?\b/i);
  if (canMatch) {
    const pack = parseInt(canMatch[1]);
    const canNum = canMatch[2];
    const canOz = CAN_SIZES[canNum];
    if (canOz) {
      return result(pack, 1, 'each', 1);
    }
  }

  // Pattern 2: N/SIZE UNIT — "12/15 oz", "6/1 gal", "4/5 lb", "12/15.5 oz"
  const slashUnit = desc.match(/^(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*(oz|lb|lbs?|gal|gallon|qt|quart|ml|l|fl\s*oz|kg|g)\b/i);
  if (slashUnit) {
    const pack = parseInt(slashUnit[1]);
    const unitSz = parseFloat(slashUnit[2]);
    const unit = normalizeUnit(slashUnit[3]);
    return result(pack, unitSz, unit, 1);
  }

  // Pattern 3: NxM UNIT — "4x1 gal", "2x5 lb"
  const multiUnit = desc.match(/^(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(oz|lb|lbs?|gal|gallon|qt|quart|ml|l|fl\s*oz|kg|g)\b/i);
  if (multiUnit) {
    const pack = parseInt(multiUnit[1]);
    const unitSz = parseFloat(multiUnit[2]);
    const unit = normalizeUnit(multiUnit[3]);
    return result(pack, unitSz, unit, 1);
  }

  // Pattern 4: N ct / N count — "24 ct", "50 count", "120ct"
  const ctMatch = desc.match(/^(\d+)\s*(?:ct|count)\s*$/i);
  if (ctMatch) {
    const count = parseInt(ctMatch[1]);
    return result(count, 1, 'each', 1);
  }

  // Pattern 5: N lb/oz/gal bag/case/box — "50 lb bag", "25 lb case", "10 oz box"
  const bulkMatch = desc.match(/^(\d+(?:\.\d+)?)\s*(lb|lbs?|oz|gal|gallon|qt|quart|pt|pint|ml|l|kg|g)\s*(?:bag|case|box|pail|bucket|jug|drum|tub|sack)?$/i);
  if (bulkMatch) {
    const unitSz = parseFloat(bulkMatch[1]);
    const unit = normalizeUnit(bulkMatch[2]);
    return result(1, unitSz, unit, 1);
  }

  // Pattern 6: Simple unit names — "lb", "each", "oz", "gal", "ea"
  const simpleUnit = desc.match(/^(each|ea|lb|lbs?|oz|gal|gallon|qt|quart|pt|pint|ml|l|kg|g|fl\s*oz)$/i);
  if (simpleUnit) {
    const unit = normalizeUnit(simpleUnit[1]);
    return result(1, 1, unit, 1);
  }

  return null;
}

function normalizeUnit(raw: string): string {
  const u = raw.toLowerCase().trim();
  if (u === 'lbs' || u === 'pound' || u === 'pounds') return 'lb';
  if (u === 'ounce' || u === 'ounces' || u === 'fl oz') return 'oz';
  if (u === 'gallon' || u === 'gallons') return 'gal';
  if (u === 'quart' || u === 'quarts') return 'qt';
  if (u === 'pint' || u === 'pints') return 'pt';
  if (u === 'ea') return 'each';
  return u;
}

function fallbackParse(
  purchaseUnit: string,
  purchaseCost: number,
  rawInput: string
): UnitParseResult {
  const unit = purchaseUnit.toLowerCase().trim();

  if (unit === "each" || unit === "ea" || unit === "") {
    return { packSize: 1, unitSize: 1, baseUnit: "each", unitsPerPurchase: 1, unitCost: purchaseCost, confidence: 1, rawInput };
  }
  if (unit === "lb" || unit === "pound" || unit === "lbs") {
    return { packSize: 1, unitSize: 1, baseUnit: "lb", unitsPerPurchase: 1, unitCost: purchaseCost, confidence: 1, rawInput };
  }
  if (unit === "oz" || unit === "ounce") {
    return { packSize: 1, unitSize: 1, baseUnit: "oz", unitsPerPurchase: 1, unitCost: purchaseCost, confidence: 1, rawInput };
  }
  if (unit === "gal" || unit === "gallon") {
    return { packSize: 1, unitSize: 1, baseUnit: "gal", unitsPerPurchase: 1, unitCost: purchaseCost, confidence: 1, rawInput };
  }

  return {
    packSize: 1,
    unitSize: 1,
    baseUnit: unit || "each",
    unitsPerPurchase: 1,
    unitCost: purchaseCost,
    confidence: 0.5,
    rawInput,
  };
}
