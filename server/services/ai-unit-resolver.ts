/**
 * AI-Powered Unit Conversion System v2
 *
 * Resolves vendor purchase descriptions to canonical base units:
 *   oz  (weight ounces)
 *   floz (fluid ounces)
 *   each (discrete countable items)
 *
 * Handles Sysco / US Foods / GFS compound pack formats:
 *   "4/5 LB", "6/#10 CAN", "12/15 OZ", "8/12 CT", etc.
 *
 * Parse path (fastest first):
 *   1. Compound pack regex (parseCompoundPack) — handles N/SIZE UNIT formats
 *   2. Simple regex (trySimpleParse) — handles common single-pattern descriptions
 *   3. AI call (claude-haiku) — fallback for anything complex
 *   4. Hard fallback — 1 each at full cost
 */

import { anthropic as client } from "../lib/anthropic";
import { log } from "../utils/logger";

// Timeout for AI calls (30 seconds)
const AI_TIMEOUT_MS = 30000;

/**
 * Strip markdown code fences from AI response and extract JSON
 */
function extractJsonFromResponse(text: string): string {
  let jsonStr = text.trim();

  // Handle markdown code blocks (```json ... ``` or ``` ... ```)
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // If still wrapped in code block markers, try to extract
  if (jsonStr.startsWith('```')) {
    const lines = jsonStr.split('\n');
    if (lines[0].startsWith('```')) lines.shift();
    if (lines[lines.length - 1]?.trim() === '```') lines.pop();
    jsonStr = lines.join('\n').trim();
  }

  // Try to find JSON object in the response
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  return jsonStr;
}

/**
 * Execute AI call with timeout
 */
async function callAIWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = AI_TIMEOUT_MS
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`AI call timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

// Canonical base units - everything normalizes to these
export type BaseUnit = 'oz' | 'floz' | 'each';

export interface InventoryParseResult {
  baseUnit: BaseUnit;
  baseQtyPerPurchase: number;
  costPerBaseUnit: number;
  confidence: 'high' | 'medium' | 'low';
  notes: string;
  needsClarification?: boolean;
  clarificationQuestion?: string;
}

export interface RecipeIngredientParseResult {
  baseQty: number;
  displayQty: string;
  displayUnit: string;
  lineCost: number;
  confidence: 'high' | 'medium' | 'low';
  notes: string;
}

// Standard conversions to base units
const WEIGHT_TO_OZ: Record<string, number> = {
  'oz': 1,
  'ounce': 1,
  'lb': 16,
  'lbs': 16,
  'pound': 16,
  'pounds': 16,
  'g': 0.035274,
  'gram': 0.035274,
  'grams': 0.035274,
  'kg': 35.274,
  'kilogram': 35.274,
};

const VOLUME_TO_FLOZ: Record<string, number> = {
  'floz': 1,
  'fl oz': 1,
  'fluid ounce': 1,
  'cup': 8,
  'cups': 8,
  'c': 8,
  'tbsp': 0.5,
  'tablespoon': 0.5,
  'tsp': 0.1667,
  'teaspoon': 0.1667,
  'pt': 16,
  'pint': 16,
  'qt': 32,
  'quart': 32,
  'gal': 128,
  'gallon': 128,
  'ml': 0.033814,
  'milliliter': 0.033814,
  'l': 33.814,
  'liter': 33.814,
};

// Standard food service container sizes in ounces
const CONTAINER_SIZES_OZ: Record<string, number> = {
  '#10 can': 109,
  '#10': 109,
  '#5 can': 56,
  '#5': 56,
  '#2.5 can': 28,
  '#2.5': 28,
  '#2 can': 20,
  '#2': 20,
  '#303 can': 16,
  '#303': 16,
  '#300 can': 14,
  '#300': 14,
  '#1 can': 11,
  '#1': 11,
};

// Keywords indicating a liquid product
const LIQUID_KEYWORDS = /\b(sauce|marinara|salsa|broth|stock|juice|oil|vinegar|syrup|soup|puree|paste|ketchup|mustard|dressing|gravy|milk|cream|water|beverage|drink|tea|coffee|concentrate|extract)\b/i;

/**
 * Detect if an item name suggests a liquid product
 */
function isLikelyLiquid(name: string): boolean {
  return LIQUID_KEYWORDS.test(name);
}

/**
 * Check if the source text explicitly specifies fluid ounces.
 */
function sourceExplicitlyFluid(text: string): boolean {
  return /\bfl\.?\s*oz\b|floz|\bfluid\b/i.test(text);
}

/**
 * Parse an inventory purchase description using compound pack formats and AI
 *
 * Examples:
 * - "50 lb bag" → 800 oz, $0.03125/oz
 * - "case of 12×15oz cans" → 180 oz
 * - "gallon jug" → 128 floz
 */
export async function parseInventoryPurchase(
  name: string,
  purchaseDescription: string,
  cost: number,
  packField?: string  // Optional explicit Pack column value (highest priority)
): Promise<InventoryParseResult> {
  // PRIORITY 0: Check for compound pack formats (e.g., "4/5 LB") regardless of description
  if (packField) {
    const compoundResult = parseCompoundPack(packField);
    if (compoundResult) {
      // Compound weight format: "4/5 LB" = 4 packs × 5 lb = 20 lb = 320 oz
      if (compoundResult.type === 'compound-weight' && compoundResult.totalBaseUnits) {
        const explicitFluid = sourceExplicitlyFluid(packField || '') || sourceExplicitlyFluid(purchaseDescription);
        const unit = explicitFluid && compoundResult.unit === 'oz' ? 'floz' : 'oz';
        return {
          baseUnit: unit,
          baseQtyPerPurchase: compoundResult.totalBaseUnits,
          costPerBaseUnit: Number((cost / compoundResult.totalBaseUnits).toFixed(6)),
          confidence: 'high',
          notes: `Pack: ${compoundResult.packQty} × ${compoundResult.itemSize} ${compoundResult.unit} = ${compoundResult.totalBaseUnits} ${unit}`,
        };
      }

      // Compound count format: "8/12 CT" = 8 packs × 12 count = 96 each
      if (compoundResult.type === 'compound-count' && compoundResult.totalBaseUnits) {
        return {
          baseUnit: 'each',
          baseQtyPerPurchase: compoundResult.totalBaseUnits,
          costPerBaseUnit: Number((cost / compoundResult.totalBaseUnits).toFixed(6)),
          confidence: 'high',
          notes: `Pack: ${compoundResult.packQty} × ${compoundResult.itemSize} ct = ${compoundResult.totalBaseUnits} each`,
        };
      }

      // Simple pack format: "24" = 24 each (fall through to let trySimpleParse handle)
    }
  }

  // Handle empty/simple cases without AI
  if (!purchaseDescription || purchaseDescription.trim() === '') {
    if (packField) {
      const packNum = parseInt(packField);
      if (!isNaN(packNum) && packNum >= 1 && packNum <= 1000) {
        return {
          baseUnit: 'each',
          baseQtyPerPurchase: packNum,
          costPerBaseUnit: cost / packNum,
          confidence: 'high',
          notes: `${packNum} items (from Pack column)`,
        };
      }
    }
    return {
      baseUnit: 'each',
      baseQtyPerPurchase: 1,
      costPerBaseUnit: cost,
      confidence: 'medium',
      notes: 'No purchase description provided, assuming 1 each',
    };
  }

  const normalizedDesc = purchaseDescription.toLowerCase().trim();

  // Try simple regex parsing first for common patterns
  const simpleResult = trySimpleParse(normalizedDesc, cost, packField);
  if (simpleResult) {
    if (simpleResult.baseUnit === 'oz' && sourceExplicitlyFluid(purchaseDescription)) {
      simpleResult.baseUnit = 'floz';
      if (simpleResult.notes) {
        simpleResult.notes = simpleResult.notes.replace(/\boz\b/g, 'floz');
      }
    }
    return simpleResult;
  }

  // Use AI for complex patterns
  const prompt = `Parse this inventory item's purchase description to calculate base units for costing.

Item Name: "${name}"
Purchase Description: "${purchaseDescription}"
Purchase Cost: $${cost.toFixed(2)}

TASK: Determine how many BASE UNITS are in one purchase.

**CRITICAL: DISTINGUISH PACK QUANTITY vs ITEM SIZE**
- PACK QUANTITY = How many items in the case/pack (e.g., "24" in "case of 24 bottles")
- ITEM SIZE = Size of each individual item (e.g., "16oz" in "16oz bottles")

LOOK FOR PACK QUANTITY INDICATORS:
- "case of X", "pack of X", "box of X", "X per case", "X count", "X ct"
- "X/Yoz" format → X is pack quantity, Y is item size
- "Pack: X", "Qty: X" → X is pack quantity
- Words like "case", "pack", "carton", "flat", "box" suggest multiple items

DO NOT CONFUSE ITEM SIZE WITH PACK QUANTITY:
- "Bottled Water 16oz" → 16 is ITEM SIZE, not quantity (need pack qty separately)
- "Coca-Cola 20oz" → 20 is ITEM SIZE, not quantity
- "Beef Patties 4oz" → 4 is ITEM SIZE per patty
- "Milk 8oz carton" → 8 is ITEM SIZE

BASE UNITS (normalize to these):
- oz (ounces) — DEFAULT for anything described in oz, lb, or by weight. Sauces, condiments, and other items described in "oz" are WEIGHT ounces, not fluid.
- floz (fluid ounces) — ONLY when the source text explicitly says "fl oz", "floz", or "fluid", OR for gallon/quart/pint/cup measures.
- each for discrete countable items

CRITICAL: "6x32oz BBQ Sauce" → oz (weight), NOT floz. Only use floz if the text literally contains "fl" or "fluid".

STANDARD CONVERSIONS:
- 1 lb = 16 oz
- 1 gallon = 128 fl oz
- 1 cup = 8 fl oz
- #10 can = 109 oz
- #5 can = 56 oz
- #2.5 can = 28 oz

Return ONLY valid JSON:
{
  "baseUnit": "oz" | "floz" | "each",
  "baseQtyPerPurchase": <total base units in one purchase>,
  "confidence": "high" | "medium" | "low",
  "notes": "<brief explanation of calculation>"
}

EXAMPLES:
- "50 lb bag" → {"baseUnit": "oz", "baseQtyPerPurchase": 800, "confidence": "high", "notes": "50 lb × 16 oz/lb = 800 oz"}
- "case of 12×15oz cans" → {"baseUnit": "oz", "baseQtyPerPurchase": 180, "confidence": "high", "notes": "12 cans × 15 oz = 180 oz"}
- "24/16oz bottles" → {"baseUnit": "oz", "baseQtyPerPurchase": 384, "confidence": "high", "notes": "24 bottles × 16 oz = 384 oz (24 is pack qty, 16oz is item size)"}
- "40 count box, 4oz each" → {"baseUnit": "oz", "baseQtyPerPurchase": 160, "confidence": "high", "notes": "40 items × 4 oz = 160 oz"}
- "6×5lb bags" → {"baseUnit": "oz", "baseQtyPerPurchase": 480, "confidence": "high", "notes": "6 bags × 5 lb × 16 oz/lb = 480 oz"}
- "gallon jug" → {"baseUnit": "floz", "baseQtyPerPurchase": 128, "confidence": "high", "notes": "1 gallon = 128 fl oz"}
- "24 ct flat" → {"baseUnit": "each", "baseQtyPerPurchase": 24, "confidence": "high", "notes": "24 discrete items"}
- "Bottled Water" (no qty info) → {"baseUnit": "each", "baseQtyPerPurchase": 1, "confidence": "low", "notes": "No pack quantity specified"}
- "case" → {"baseUnit": "each", "baseQtyPerPurchase": 1, "confidence": "low", "notes": "Ambiguous - need case size"}

If ambiguous (no pack quantity found), use confidence: "low" and explain what's missing.`;

  try {
    const response = await callAIWithTimeout(
      client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      })
    );

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return fallbackParse(purchaseDescription, cost);
    }

    const jsonStr = extractJsonFromResponse(textBlock.text);

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      log.warn("JSON parse failed for AI response", { operation: 'parseInventoryPurchase', response: textBlock.text });
      return fallbackParse(purchaseDescription, cost);
    }
    const baseUnit = validateBaseUnit(parsed.baseUnit);
    const baseQtyPerPurchase = Math.max(parsed.baseQtyPerPurchase || 1, 0.0001);
    const costPerBaseUnit = cost / baseQtyPerPurchase;

    const result: InventoryParseResult = {
      baseUnit,
      baseQtyPerPurchase: Number(baseQtyPerPurchase.toFixed(4)),
      costPerBaseUnit: Number(costPerBaseUnit.toFixed(6)),
      confidence: validateConfidence(parsed.confidence),
      notes: parsed.notes || `Parsed from: ${purchaseDescription}`,
    };

    if (result.confidence === 'low') {
      result.needsClarification = true;
      result.clarificationQuestion = generateClarificationQuestion(purchaseDescription, baseUnit);
    }

    return result;
  } catch (error) {
    log.error(error, { operation: 'parseInventoryPurchase', purchaseDescription });
    return fallbackParse(purchaseDescription, cost);
  }
}

/**
 * Re-parse with user correction/clarification
 */
export async function parseWithClarification(
  name: string,
  purchaseDescription: string,
  cost: number,
  clarification: string
): Promise<InventoryParseResult> {
  const combinedDescription = `${purchaseDescription} (${clarification})`;
  return parseInventoryPurchase(name, combinedDescription, cost);
}

// ============================================================
// Helper Functions
// ============================================================

function isMeasurementNumber(text: string, number: number): boolean {
  const measurementPatterns = [
    new RegExp(`\\b${number}(\\.\\d+)?\\s*oz\\b`, 'i'),
    new RegExp(`\\b${number}(\\.\\d+)?\\s*fl\\s*oz\\b`, 'i'),
    new RegExp(`\\b${number}(\\.\\d+)?\\s*ounces?\\b`, 'i'),
    new RegExp(`\\b${number}(\\.\\d+)?\\s*(?:lb|lbs)\\b`, 'i'),
    new RegExp(`\\b${number}(\\.\\d+)?\\s*pounds?\\b`, 'i'),
    new RegExp(`\\b${number}(\\.\\d+)?\\s*(?:ml|milliliters?)\\b`, 'i'),
    new RegExp(`\\b${number}(\\.\\d+)?\\s*(?:l|liters?)\\b`, 'i'),
    new RegExp(`\\b${number}(\\.\\d+)?\\s*(?:g|grams?)\\b`, 'i'),
    new RegExp(`\\b${number}(\\.\\d+)?\\s*(?:kg|kilograms?)\\b`, 'i'),
    new RegExp(`\\b${number}(\\.\\d+)?\\s*(?:gal|gallons?)\\b`, 'i'),
  ];

  return measurementPatterns.some(pattern => pattern.test(text));
}

interface CompoundPackResult {
  type: 'compound-weight' | 'compound-count' | 'simple';
  packQty: number;
  itemSize?: number;
  unit?: 'lb' | 'oz' | 'each' | 'gal' | 'liter';
  totalBaseUnits?: number;
}

function parseCompoundPack(packValue: string): CompoundPackResult | null {
  const cleaned = packValue.toString().trim().toLowerCase();

  // Pattern: "4/5 LB" → 4 packs × 5 lb (= 320 oz)
  const compoundLbMatch = cleaned.match(/^(\d+)\s*[\/x×]\s*(\d+(?:\.\d+)?)\s*(?:lb|lbs|pound|pounds?)$/i);
  if (compoundLbMatch) {
    const packQty = parseInt(compoundLbMatch[1]);
    const itemLbs = parseFloat(compoundLbMatch[2]);
    return {
      type: 'compound-weight',
      packQty,
      itemSize: itemLbs,
      unit: 'lb',
      totalBaseUnits: packQty * itemLbs * 16,  // in oz
    };
  }

  // Pattern: "12/15 OZ" → 12 packs × 15 oz
  const compoundOzMatch = cleaned.match(/^(\d+)\s*[\/x×]\s*(\d+(?:\.\d+)?)\s*(?:oz|ounces?)$/i);
  if (compoundOzMatch) {
    const packQty = parseInt(compoundOzMatch[1]);
    const itemOz = parseFloat(compoundOzMatch[2]);
    return {
      type: 'compound-weight',
      packQty,
      itemSize: itemOz,
      unit: 'oz',
      totalBaseUnits: packQty * itemOz,
    };
  }

  // Pattern: "6/#10" or "12/#5 can" → standard food service containers
  const containerMatch = cleaned.match(/^(\d+)\s*[\/x×]\s*(#\d+(?:\.\d+)?)\s*(?:can|cans)?$/i);
  if (containerMatch) {
    const packQty = parseInt(containerMatch[1]);
    const containerType = containerMatch[2].toLowerCase();
    const ozPerContainer = CONTAINER_SIZES_OZ[containerType] || CONTAINER_SIZES_OZ[`${containerType} can`];
    if (ozPerContainer) {
      return {
        type: 'compound-weight',
        packQty,
        itemSize: ozPerContainer,
        unit: 'oz',
        totalBaseUnits: packQty * ozPerContainer,
      };
    }
  }

  // Pattern: "4/1 GAL" → 4 × 128 = 512 fl oz
  const compoundGalMatch = cleaned.match(/^(\d+)\s*[\/x×]\s*(\d+(?:\.\d+)?)\s*(?:gal|gallon|gallons?)$/i);
  if (compoundGalMatch) {
    const packQty = parseInt(compoundGalMatch[1]);
    const itemGal = parseFloat(compoundGalMatch[2]);
    return {
      type: 'compound-weight',
      packQty,
      itemSize: itemGal,
      unit: 'gal',
      totalBaseUnits: packQty * itemGal * 128,  // in fl oz
    };
  }

  // Pattern: "6/1 LITER" → 6 × 33.814 fl oz
  const compoundLitMatch = cleaned.match(/^(\d+)\s*[\/x×]\s*(\d+(?:\.\d+)?)\s*(?:lit|liter|liters?|litre|litres?|l)$/i);
  if (compoundLitMatch) {
    const packQty = parseInt(compoundLitMatch[1]);
    const itemLit = parseFloat(compoundLitMatch[2]);
    return {
      type: 'compound-weight',
      packQty,
      itemSize: itemLit,
      unit: 'liter',
      totalBaseUnits: Math.round(packQty * itemLit * 33.814),  // in fl oz
    };
  }

  // Pattern: "8/12 CT" or "6/24 count" → 8 packs × 12 count
  const compoundCountMatch = cleaned.match(/^(\d+)\s*[\/x×]\s*(\d+)\s*(?:ct|count|ea|each|pc|pcs)?$/i);
  if (compoundCountMatch) {
    const packQty = parseInt(compoundCountMatch[1]);
    const itemCount = parseInt(compoundCountMatch[2]);
    return {
      type: 'compound-count',
      packQty,
      itemSize: itemCount,
      unit: 'each',
      totalBaseUnits: packQty * itemCount,
    };
  }

  // Simple number: "24" or "24 CT"
  const simpleMatch = cleaned.match(/^(\d+)\s*(?:ct|count|ea|each|pc|pcs)?$/i);
  if (simpleMatch) {
    return {
      type: 'simple',
      packQty: parseInt(simpleMatch[1]),
    };
  }

  return null;
}

function extractPackQuantity(
  desc: string,
  packField?: string
): { quantity: number; source: 'pack-column' | 'description'; confidence: 'high' | 'medium' } | null {

  if (packField) {
    const parsed = parseCompoundPack(packField);
    if (parsed && parsed.packQty >= 1 && parsed.packQty <= 1000) {
      return { quantity: parsed.packQty, source: 'pack-column', confidence: 'high' };
    }
  }

  const quantityPatterns = [
    { pattern: /(?:case|pack|box|bag|carton|crate)\s*(?:of\s*)?(\d+)/i, name: 'case-of' },
    { pattern: /(\d+)\s*(?:count|ct)\b/i, name: 'count' },
    { pattern: /(\d+)\s*per\s*(?:case|pack|box)/i, name: 'per-case' },
    { pattern: /(\d+)\s*\/\s*(?:case|pack|box)/i, name: 'slash-case' },
  ];

  for (const { pattern } of quantityPatterns) {
    const match = desc.match(pattern);
    if (match) {
      const quantity = parseInt(match[1]);
      if (isMeasurementNumber(desc, quantity)) {
        continue;
      }
      if (quantity >= 1 && quantity <= 1000) {
        return { quantity, source: 'description', confidence: 'medium' };
      }
    }
  }

  return null;
}

function trySimpleParse(desc: string, cost: number, packField?: string): InventoryParseResult | null {
  // PRIORITY 0: Compound pack formats from packField
  if (packField) {
    const compoundResult = parseCompoundPack(packField);
    if (compoundResult) {
      if (compoundResult.type === 'compound-weight' && compoundResult.totalBaseUnits) {
        const baseUnit = compoundResult.unit === 'lb' || compoundResult.unit === 'oz' ? 'oz' : 'each';
        return {
          baseUnit,
          baseQtyPerPurchase: compoundResult.totalBaseUnits,
          costPerBaseUnit: Number((cost / compoundResult.totalBaseUnits).toFixed(6)),
          confidence: 'high',
          notes: `Pack: ${compoundResult.packQty} × ${compoundResult.itemSize} ${compoundResult.unit} = ${compoundResult.totalBaseUnits} ${baseUnit === 'oz' ? 'oz' : 'each'}`,
        };
      }
      if (compoundResult.type === 'compound-count' && compoundResult.totalBaseUnits) {
        return {
          baseUnit: 'each',
          baseQtyPerPurchase: compoundResult.totalBaseUnits,
          costPerBaseUnit: Number((cost / compoundResult.totalBaseUnits).toFixed(6)),
          confidence: 'high',
          notes: `Pack: ${compoundResult.packQty} × ${compoundResult.itemSize} ct = ${compoundResult.totalBaseUnits} each`,
        };
      }
    }
  }

  // PRIORITY 1: Pack column with item size from description
  const packResult = extractPackQuantity(desc, packField);
  if (packResult && packResult.source === 'pack-column') {
    const packQty = packResult.quantity;

    const sizeMatch = desc.match(/(\d+(?:\.\d+)?)\s*(?:oz|fl\s*oz)\b/i);
    if (sizeMatch) {
      const itemSize = parseFloat(sizeMatch[1]);
      if (itemSize !== packQty) {
        return {
          baseUnit: 'oz',
          baseQtyPerPurchase: packQty * itemSize,
          costPerBaseUnit: Number((cost / (packQty * itemSize)).toFixed(6)),
          confidence: 'high',
          notes: `Pack: ${packQty} × ${itemSize} oz = ${packQty * itemSize} oz (pack from column)`,
        };
      }
    }

    const lbSizeMatch = desc.match(/(\d+(?:\.\d+)?)\s*(?:lb|lbs|pound|pounds?)\b/i);
    if (lbSizeMatch) {
      const itemLbs = parseFloat(lbSizeMatch[1]);
      if (itemLbs !== packQty) {
        const totalOz = packQty * itemLbs * 16;
        return {
          baseUnit: 'oz',
          baseQtyPerPurchase: totalOz,
          costPerBaseUnit: Number((cost / totalOz).toFixed(6)),
          confidence: 'high',
          notes: `Pack: ${packQty} × ${itemLbs} lb = ${totalOz} oz (pack from column)`,
        };
      }
    }

    const sizeCountMatch = desc.match(/(?:size\s*[:=]?\s*)?(\d+)\s*(?:ct|count|ea|each|pc|pcs|pieces?)\b/i);
    if (sizeCountMatch) {
      const unitsPerPack = parseInt(sizeCountMatch[1]);
      if (unitsPerPack !== packQty) {
        const totalItems = packQty * unitsPerPack;
        return {
          baseUnit: 'each',
          baseQtyPerPurchase: totalItems,
          costPerBaseUnit: Number((cost / totalItems).toFixed(6)),
          confidence: 'high',
          notes: `Pack: ${packQty} × Size: ${unitsPerPack} ct = ${totalItems} each (compound)`,
        };
      }
    }

    return {
      baseUnit: 'each',
      baseQtyPerPurchase: packQty,
      costPerBaseUnit: Number((cost / packQty).toFixed(6)),
      confidence: 'high',
      notes: `${packQty} items per case (from Pack column)`,
    };
  }

  // Pattern: "case of X" or "pack of X"
  const caseOfMatch = desc.match(/(?:case|pack|box|bag|carton|crate)\s*(?:of\s*)?(\d+)/i);
  if (caseOfMatch) {
    const count = parseInt(caseOfMatch[1]);
    if (!isMeasurementNumber(desc, count)) {
      const itemSizeMatch = desc.match(/(\d+(?:\.\d+)?)\s*(?:oz|fl\s*oz)\s*(?:each|bottle|can)?/i);
      if (itemSizeMatch) {
        const itemSize = parseFloat(itemSizeMatch[1]);
        const totalOz = count * itemSize;
        return {
          baseUnit: 'oz',
          baseQtyPerPurchase: totalOz,
          costPerBaseUnit: Number((cost / totalOz).toFixed(6)),
          confidence: 'high',
          notes: `${count} items × ${itemSize} oz each = ${totalOz} oz`,
        };
      }
      return {
        baseUnit: 'each',
        baseQtyPerPurchase: count,
        costPerBaseUnit: Number((cost / count).toFixed(6)),
        confidence: 'high',
        notes: `${count} items per case`,
      };
    }
  }

  // Pattern: "X count" or "X ct" or "X per case"
  const countMatch = desc.match(/(\d+)\s*(?:count|ct|per\s*case|per\s*pack|per\s*box)\b/i);
  if (countMatch) {
    const count = parseInt(countMatch[1]);
    if (!isMeasurementNumber(desc, count)) {
      const itemSizeMatch = desc.match(/(\d+(?:\.\d+)?)\s*(?:oz|fl\s*oz)\b/i);
      if (itemSizeMatch && !desc.match(new RegExp(`${countMatch[1]}\\s*(?:oz|fl\\s*oz)`, 'i'))) {
        const itemSize = parseFloat(itemSizeMatch[1]);
        const totalOz = count * itemSize;
        return {
          baseUnit: 'oz',
          baseQtyPerPurchase: totalOz,
          costPerBaseUnit: Number((cost / totalOz).toFixed(6)),
          confidence: 'high',
          notes: `${count} items × ${itemSize} oz each = ${totalOz} oz`,
        };
      }
      return {
        baseUnit: 'each',
        baseQtyPerPurchase: count,
        costPerBaseUnit: Number((cost / count).toFixed(6)),
        confidence: 'high',
        notes: `${count} discrete items`,
      };
    }
  }

  // Pattern: "X/Yoz" or "X×Yoz" (pack/item format)
  const packItemMatch = desc.match(/(\d+)\s*[×x\/]\s*(\d+(?:\.\d+)?)\s*(?:oz|fl\s*oz)/i);
  if (packItemMatch) {
    const packSize = parseInt(packItemMatch[1]);
    const itemSize = parseFloat(packItemMatch[2]);
    const totalOz = packSize * itemSize;
    return {
      baseUnit: 'oz',
      baseQtyPerPurchase: totalOz,
      costPerBaseUnit: Number((cost / totalOz).toFixed(6)),
      confidence: 'high',
      notes: `${packSize} × ${itemSize} oz = ${totalOz} oz`,
    };
  }

  // Pattern: "X x Y ct" or "X x Y count" (compound count)
  const compoundCountMatch = desc.match(/(\d+)\s*[×x\/]\s*(\d+)\s*(?:ct|count|ea|each|pc|pcs|pieces?|per\s*pack)\b/i);
  if (compoundCountMatch) {
    const packsPerCase = parseInt(compoundCountMatch[1]);
    const unitsPerPack = parseInt(compoundCountMatch[2]);
    const totalItems = packsPerCase * unitsPerPack;
    return {
      baseUnit: 'each',
      baseQtyPerPurchase: totalItems,
      costPerBaseUnit: Number((cost / totalItems).toFixed(6)),
      confidence: 'high',
      notes: `Compound: ${packsPerCase} packs × ${unitsPerPack} items = ${totalItems} each`,
    };
  }

  // Pattern: Size column count (e.g., "12 CT", "24 count")
  const sizeCountMatch = desc.match(/(?:size\s*[:=]?\s*)?(\d+)\s*(?:ct|count|ea|each|pc|pcs|pieces?)\b/i);
  if (sizeCountMatch) {
    const packMatch = desc.match(/(?:pack\s*[:=]?\s*)(\d+)/i);
    if (packMatch) {
      const packQty = parseInt(packMatch[1]);
      const countQty = parseInt(sizeCountMatch[1]);
      const totalItems = packQty * countQty;
      return {
        baseUnit: 'each',
        baseQtyPerPurchase: totalItems,
        costPerBaseUnit: Number((cost / totalItems).toFixed(6)),
        confidence: 'high',
        notes: `Pack: ${packQty} × Size: ${countQty} ct = ${totalItems} each`,
      };
    }
    const countQty = parseInt(sizeCountMatch[1]);
    return {
      baseUnit: 'each',
      baseQtyPerPurchase: countQty,
      costPerBaseUnit: Number((cost / countQty).toFixed(6)),
      confidence: 'high',
      notes: `${countQty} count items`,
    };
  }

  // Pattern: "Pack: X" or "Pack=X"
  const packColMatch = desc.match(/pack\s*[:=]\s*(\d+)/i);
  if (packColMatch) {
    const packSize = parseInt(packColMatch[1]);
    const sizeMatch = desc.match(/size\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:oz|fl\s*oz)/i);
    if (sizeMatch) {
      const itemSize = parseFloat(sizeMatch[1]);
      const totalOz = packSize * itemSize;
      return {
        baseUnit: 'oz',
        baseQtyPerPurchase: totalOz,
        costPerBaseUnit: Number((cost / totalOz).toFixed(6)),
        confidence: 'high',
        notes: `Pack: ${packSize} × Size: ${itemSize} oz = ${totalOz} oz`,
      };
    }
    return {
      baseUnit: 'each',
      baseQtyPerPurchase: packSize,
      costPerBaseUnit: Number((cost / packSize).toFixed(6)),
      confidence: 'medium',
      notes: `Pack size: ${packSize} items`,
    };
  }

  // Pattern: "X×Ylb" or "XxYlb bags"
  const multiLbMatch = desc.match(/(\d+)\s*[×x\/]\s*(\d+(?:\.\d+)?)\s*(?:lb|lbs)\b/i);
  if (multiLbMatch) {
    const packSize = parseInt(multiLbMatch[1]);
    const itemLbs = parseFloat(multiLbMatch[2]);
    const totalOz = packSize * itemLbs * 16;
    return {
      baseUnit: 'oz',
      baseQtyPerPurchase: totalOz,
      costPerBaseUnit: Number((cost / totalOz).toFixed(6)),
      confidence: 'high',
      notes: `${packSize} × ${itemLbs} lb × 16 oz/lb = ${totalOz} oz`,
    };
  }

  // Pattern: "X lb bag" or "X lb"
  const lbMatch = desc.match(/^(\d+(?:\.\d+)?)\s*(?:lb|lbs|pound|pounds)\b/i);
  if (lbMatch) {
    const lbs = parseFloat(lbMatch[1]);
    const ozQty = lbs * 16;
    return {
      baseUnit: 'oz',
      baseQtyPerPurchase: ozQty,
      costPerBaseUnit: Number((cost / ozQty).toFixed(6)),
      confidence: 'high',
      notes: `${lbs} lb × 16 oz/lb = ${ozQty} oz`,
    };
  }

  // Pattern: "X gallon" or "X gal"
  const galMatch = desc.match(/^(\d+(?:\.\d+)?)\s*(?:gal|gallon|gallons)\b/i);
  if (galMatch) {
    const gal = parseFloat(galMatch[1]);
    const flozQty = gal * 128;
    return {
      baseUnit: 'floz',
      baseQtyPerPurchase: flozQty,
      costPerBaseUnit: Number((cost / flozQty).toFixed(6)),
      confidence: 'high',
      notes: `${gal} gal × 128 fl oz/gal = ${flozQty} fl oz`,
    };
  }

  // Pattern: "gallon jug" (singular)
  if (desc.includes('gallon') && !desc.match(/^\d/)) {
    return {
      baseUnit: 'floz',
      baseQtyPerPurchase: 128,
      costPerBaseUnit: Number((cost / 128).toFixed(6)),
      confidence: 'high',
      notes: '1 gallon = 128 fl oz',
    };
  }

  // Pattern: "X oz" at start ONLY (single item)
  const ozMatch = desc.match(/^(\d+(?:\.\d+)?)\s*oz\b/i);
  if (ozMatch) {
    const oz = parseFloat(ozMatch[1]);
    return {
      baseUnit: 'oz',
      baseQtyPerPurchase: oz,
      costPerBaseUnit: Number((cost / oz).toFixed(6)),
      confidence: 'high',
      notes: `${oz} oz`,
    };
  }

  return null;
}

function fallbackParse(purchaseDescription: string, cost: number): InventoryParseResult {
  return {
    baseUnit: 'each',
    baseQtyPerPurchase: 1,
    costPerBaseUnit: cost,
    confidence: 'low',
    notes: `Could not parse: "${purchaseDescription}"`,
    needsClarification: true,
    clarificationQuestion: `How many oz, fl oz, or units are in "${purchaseDescription}"?`,
  };
}

function validateBaseUnit(unit: string): BaseUnit {
  const normalized = (unit || '').toLowerCase().trim();
  if (normalized === 'oz' || normalized === 'ounce') return 'oz';
  if (normalized === 'floz' || normalized === 'fl oz' || normalized === 'fluid ounce') return 'floz';
  return 'each';
}

function validateConfidence(conf: string): 'high' | 'medium' | 'low' {
  const normalized = (conf || '').toLowerCase().trim();
  if (normalized === 'high') return 'high';
  if (normalized === 'medium') return 'medium';
  return 'low';
}

function generateClarificationQuestion(desc: string, baseUnit: BaseUnit): string {
  if (baseUnit === 'each') {
    return `How many items are in "${desc}"?`;
  }
  return `How many ${baseUnit === 'oz' ? 'ounces' : 'fluid ounces'} are in "${desc}"?`;
}

/**
 * Batch parse multiple inventory items in a SINGLE API call.
 * Tries deterministic regex first, calls AI only for items that need it.
 * Significantly faster than per-item calls for bulk imports.
 */
export async function parseInventoryBatch(
  items: Array<{ name: string; purchaseDescription: string; cost: number; packField?: string }>
): Promise<InventoryParseResult[]> {
  if (items.length === 0) {
    return [];
  }

  if (items.length === 1) {
    const result = await parseInventoryPurchase(
      items[0].name,
      items[0].purchaseDescription,
      items[0].cost,
      items[0].packField
    );
    return [result];
  }

  // Pre-process: try simple regex parsing first to reduce AI calls
  const results: (InventoryParseResult | null)[] = items.map((item) => {
    if (!item.purchaseDescription || item.purchaseDescription.trim() === '') {
      if (item.packField) {
        const packNum = parseInt(item.packField);
        if (!isNaN(packNum) && packNum >= 1 && packNum <= 1000) {
          return {
            baseUnit: 'each' as BaseUnit,
            baseQtyPerPurchase: packNum,
            costPerBaseUnit: item.cost / packNum,
            confidence: 'high' as const,
            notes: `${packNum} items (from Pack column)`,
          };
        }
      }
      return {
        baseUnit: 'each' as BaseUnit,
        baseQtyPerPurchase: 1,
        costPerBaseUnit: item.cost,
        confidence: 'medium' as const,
        notes: 'No purchase description provided, assuming 1 each',
      };
    }
    const simpleResult = trySimpleParse(
      item.purchaseDescription.toLowerCase().trim(),
      item.cost,
      item.packField
    );
    if (simpleResult && simpleResult.baseUnit === 'oz' && sourceExplicitlyFluid(item.purchaseDescription)) {
      simpleResult.baseUnit = 'floz';
      if (simpleResult.notes) {
        simpleResult.notes = simpleResult.notes.replace(/\boz\b/g, 'floz');
      }
    }
    return simpleResult;
  });

  const needsAI: { index: number; item: typeof items[0] }[] = [];
  items.forEach((item, index) => {
    if (results[index] === null) {
      needsAI.push({ index, item });
    }
  });

  if (needsAI.length === 0) {
    return results as InventoryParseResult[];
  }

  const itemsText = needsAI.map((entry, i) =>
    `[${i}] Name: "${entry.item.name}" | Description: "${entry.item.purchaseDescription}" | Cost: $${entry.item.cost.toFixed(2)}`
  ).join('\n');

  const prompt = `Parse these ${needsAI.length} inventory items to calculate base units for recipe costing.

ITEMS:
${itemsText}

TASK: For EACH item, determine how many BASE UNITS are in one purchase.

**CRITICAL: DISTINGUISH PACK QUANTITY vs ITEM SIZE**
- PACK QUANTITY = How many items in the case/pack (e.g., "24" in "case of 24 bottles")
- ITEM SIZE = Size of each individual item (e.g., "16oz" in "16oz bottles")

LOOK FOR PACK QUANTITY INDICATORS:
- "case of X", "pack of X", "X per case", "X count", "X ct", "X/Yoz"
- DO NOT confuse item size (16oz, 20oz, 4oz) with pack quantity!

BASE UNITS (normalize to these):
- oz (ounces) — DEFAULT for anything described in oz, lb, or by weight.
- floz (fluid ounces) — ONLY when source text says "fl oz", "floz", or "fluid", or for gallon/quart/pint/cup.
- each for discrete countable items

CRITICAL: "6x32oz BBQ Sauce" → oz (NOT floz). Only use floz if text literally says "fl" or "fluid".

CONVERSIONS: 1 lb = 16 oz, 1 gallon = 128 fl oz, #10 can = 109 oz

Return ONLY a valid JSON array with one object per item in order:
[
  {"baseUnit": "oz"|"floz"|"each", "baseQtyPerPurchase": <number>, "confidence": "high"|"medium"|"low", "notes": "<brief>"},
  ...
]

EXAMPLES:
- "50 lb bag" → {"baseUnit": "oz", "baseQtyPerPurchase": 800, "notes": "50×16=800oz"}
- "24/16oz bottles" → {"baseUnit": "oz", "baseQtyPerPurchase": 384, "notes": "24×16=384oz"}
- "40 count, 4oz each" → {"baseUnit": "oz", "baseQtyPerPurchase": 160, "notes": "40×4=160oz"}
- "6×5lb bags" → {"baseUnit": "oz", "baseQtyPerPurchase": 480, "notes": "6×5×16=480oz"}
- "gallon jug" → {"baseUnit": "floz", "baseQtyPerPurchase": 128, "notes": "1gal=128floz"}
- "24 ct flat" → {"baseUnit": "each", "baseQtyPerPurchase": 24, "notes": "24 items"}`;

  try {
    const response = await callAIWithTimeout(
      client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
      45000
    );

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      log.warn("Batch AI response missing text, falling back to individual parsing", { operation: 'parseInventoryBatch' });
      return Promise.all(items.map(item =>
        parseInventoryPurchase(item.name, item.purchaseDescription, item.cost, item.packField)
      ));
    }

    const jsonStr = extractJsonFromResponse(textBlock.text);
    // Handle JSON array (batch response)
    const jsonArrStr = jsonStr.match(/\[[\s\S]*\]/)?.[0] || jsonStr;

    let parsed: Array<{ baseUnit: string; baseQtyPerPurchase: number; confidence: string; notes: string }>;
    try {
      parsed = JSON.parse(jsonArrStr);
    } catch (parseError) {
      log.warn("Batch JSON parse failed, falling back to individual parsing", { operation: 'parseInventoryBatch', response: textBlock.text });
      return Promise.all(items.map(item =>
        parseInventoryPurchase(item.name, item.purchaseDescription, item.cost, item.packField)
      ));
    }

    parsed.forEach((aiResult, i) => {
      if (i < needsAI.length) {
        const originalIndex = needsAI[i].index;
        const item = needsAI[i].item;
        const baseUnit = validateBaseUnit(aiResult.baseUnit);
        const baseQtyPerPurchase = Math.max(aiResult.baseQtyPerPurchase || 1, 0.0001);
        const costPerBaseUnit = item.cost / baseQtyPerPurchase;

        results[originalIndex] = {
          baseUnit,
          baseQtyPerPurchase: Number(baseQtyPerPurchase.toFixed(4)),
          costPerBaseUnit: Number(costPerBaseUnit.toFixed(6)),
          confidence: validateConfidence(aiResult.confidence),
          notes: aiResult.notes || `Parsed from: ${item.purchaseDescription}`,
        };
      }
    });

    return results.map((result, index) => {
      if (result === null) {
        return fallbackParse(items[index].purchaseDescription, items[index].cost);
      }
      return result;
    });

  } catch (error) {
    log.error(error, { operation: 'parseInventoryBatch', message: 'Batch AI parsing failed, falling back to individual' });
    return Promise.all(items.map(item => parseInventoryPurchase(item.name, item.purchaseDescription, item.cost)));
  }
}
