/**
 * USDA FoodData Central integration.
 * Accepts USDA_API_KEY or USDA_FDC_API_KEY (both for compatibility).
 */

import { log } from '../utils/logger';

export interface USDAFoodNutrient {
  nutrient?: { id: number; name?: string; unitName?: string };
  nutrientId?: number;
  nutrientName?: string;
  unitName?: string;
  amount?: number;
  value?: number;
}

export interface USDASearchResult {
  fdcId: number;
  description: string;
  dataType: string;
  brandOwner?: string;
  brandName?: string;
  ingredients?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  score: number;
  foodNutrients?: USDAFoodNutrient[];
}

interface USDASearchResponse {
  foods?: USDASearchResult[];
}

export const USDA_NUTRIENT_MAP: Record<number, string> = {
  1008: 'calories',
  1003: 'protein',
  1005: 'carbohydrate',
  1004: 'totalFat',
  1258: 'saturatedFat',
  1257: 'transFat',
  1253: 'cholesterol',
  1093: 'sodium',
  1092: 'potassium',
  1087: 'calcium',
  1089: 'iron',
  1091: 'phosphorus',
  1079: 'fiber',
  2000: 'sugar',
  1235: 'addedSugar',
  1114: 'vitaminD',
};

const USDA_API_BASE = 'https://api.nal.usda.gov/fdc/v1';
const USDA_API_KEY = process.env.USDA_API_KEY || process.env.USDA_FDC_API_KEY;

if (USDA_API_KEY) {
  log.event('USDA API key loaded');
} else {
  log.warn('USDA API key not configured — set USDA_API_KEY');
}

export async function searchUSDA(
  query: string,
): Promise<{ results: USDASearchResult[]; error?: string }> {
  if (!USDA_API_KEY) {
    return { results: [], error: 'USDA_API_KEY not configured on server' };
  }

  try {
    const response = await fetch(
      `${USDA_API_BASE}/foods/search?api_key=${USDA_API_KEY}&query=${encodeURIComponent(query)}&pageSize=5`,
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return { results: [], error: `USDA API error ${response.status}: ${body || response.statusText}` };
    }

    const data = (await response.json()) as USDASearchResponse;
    return { results: data.foods || [] };
  } catch (error) {
    log.error(error, { operation: 'searchUSDA', query });
    return { results: [], error: 'Failed to search USDA database' };
  }
}

export async function getUSDANutrition(
  fdcId: number,
): Promise<{ data: Record<string, unknown> | null; error?: string }> {
  if (!USDA_API_KEY) {
    return { data: null, error: 'USDA_API_KEY not configured on server' };
  }

  try {
    const response = await fetch(`${USDA_API_BASE}/food/${fdcId}?api_key=${USDA_API_KEY}`);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return { data: null, error: `USDA API error ${response.status}: ${body || response.statusText}` };
    }

    return { data: (await response.json()) as Record<string, unknown> };
  } catch (error) {
    log.error(error, { operation: 'getUSDANutrition', fdcId });
    return { data: null, error: 'Failed to fetch USDA nutrition data' };
  }
}

export function mapUSDANutrition(
  usdaFood: Record<string, unknown>,
): Record<string, number | null> {
  const nutrition: Record<string, number | null> = {};
  const nutrients = (usdaFood.foodNutrients || []) as USDAFoodNutrient[];

  for (const n of nutrients) {
    const id = n.nutrient?.id ?? n.nutrientId ?? 0;
    const value = n.amount ?? n.value;
    const field = USDA_NUTRIENT_MAP[id];
    if (field && value != null) {
      nutrition[field] = Math.round(value * 100) / 100;
    }
  }

  return nutrition;
}

export function captureAllUSDANutrients(
  usdaFood: Record<string, unknown>,
): Record<string, { value: number; unit: string; nutrientId: number }> {
  const all: Record<string, { value: number; unit: string; nutrientId: number }> = {};
  const nutrients = (usdaFood.foodNutrients || []) as USDAFoodNutrient[];

  for (const n of nutrients) {
    const id = n.nutrient?.id ?? n.nutrientId ?? 0;
    const name = n.nutrient?.name ?? n.nutrientName;
    const unit = n.nutrient?.unitName ?? n.unitName ?? '';
    const value = n.amount ?? n.value;

    if (name && value != null) {
      all[name] = { value: Math.round(value * 100) / 100, unit, nutrientId: id };
    }
  }

  return all;
}

export interface AllergenKeywordEntry {
  name: string;
  keywords: string[];
}

export function parseAllergenKeywords(keywordsJson: string | null): string[] {
  if (!keywordsJson) return [];
  try {
    const parsed = JSON.parse(keywordsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((k): k is string => typeof k === 'string' && k.length > 0);
  } catch {
    return [];
  }
}

const MAY_CONTAIN_PATTERNS = [
  /may contain/i,
  /produced in a facility (?:that )?(?:also )?processes?/i,
  /processed (?:in|on) (?:equipment|shared|a line)/i,
  /manufactured (?:in|on) (?:equipment|a facility) (?:with|that)/i,
  /shared equipment/i,
];

export function extractAllergensFromIngredients(
  ingredientString: string,
  allergenKeywords: AllergenKeywordEntry[],
): { contains: string[]; mayContain: string[] } {
  if (!ingredientString || allergenKeywords.length === 0) {
    return { contains: [], mayContain: [] };
  }

  const lower = ingredientString.toLowerCase();
  const contains = new Set<string>();
  const mayContain = new Set<string>();

  let directPart = lower;
  let mayContainPart = '';
  for (const pattern of MAY_CONTAIN_PATTERNS) {
    const match = lower.match(pattern);
    if (match && match.index !== undefined) {
      directPart = lower.substring(0, match.index);
      mayContainPart = lower.substring(match.index);
      break;
    }
  }

  for (const entry of allergenKeywords) {
    if (entry.keywords.length === 0) continue;
    for (const kw of entry.keywords) {
      if (kw && directPart.includes(kw.toLowerCase())) {
        contains.add(entry.name);
        break;
      }
    }
  }

  if (mayContainPart) {
    for (const entry of allergenKeywords) {
      if (entry.keywords.length === 0 || contains.has(entry.name)) continue;
      for (const kw of entry.keywords) {
        if (kw && mayContainPart.includes(kw.toLowerCase())) {
          mayContain.add(entry.name);
          break;
        }
      }
    }
  }

  return { contains: Array.from(contains), mayContain: Array.from(mayContain) };
}
