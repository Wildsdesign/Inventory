/**
 * AI Allergen Detection Service (Claude Haiku)
 *
 * Scores items against a facility's allergen catalog.
 * Returns empty map on failure — routes must detect and return 502.
 */

import { anthropic as client } from '../lib/anthropic';
import { log } from '../utils/logger';

export interface AllergenSuggestion {
  contains: string[];
  mayContain: string[];
}

export interface FacilityAllergen {
  name: string;
  aiHint?: string | null;
}

const BATCH_SIZE = 20;

export async function suggestAllergensBatch(
  items: Array<{ name: string; description: string | null }>,
  facilityAllergens: FacilityAllergen[],
): Promise<Map<string, AllergenSuggestion>> {
  const results = new Map<string, AllergenSuggestion>();

  if (facilityAllergens.length === 0) {
    log.warn('suggestAllergensBatch called with empty allergen catalog');
    return results;
  }

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    try {
      const batchResults = await suggestBatch(batch, facilityAllergens);
      batchResults.forEach((suggestion, name) => results.set(name, suggestion));
    } catch (error) {
      log.error(error, { operation: 'aiAllergenBatch', batch: Math.floor(i / BATCH_SIZE) });
    }
  }

  return results;
}

function formatAllergenList(allergens: FacilityAllergen[]): string {
  return allergens
    .map((a) => (a.aiHint?.trim() ? `- ${a.name} — ${a.aiHint.trim()}` : `- ${a.name}`))
    .join('\n');
}

async function suggestBatch(
  items: Array<{ name: string; description: string | null }>,
  facilityAllergens: FacilityAllergen[],
): Promise<Map<string, AllergenSuggestion>> {
  const allergenList = formatAllergenList(facilityAllergens);
  const allergenNameSet = new Set(facilityAllergens.map((a) => a.name));

  const itemList = items
    .map((item, idx) => {
      let desc = `${idx + 1}. "${item.name}"`;
      if (item.description) desc += ` — ${item.description}`;
      return desc;
    })
    .join('\n');

  const prompt = `You are a food allergen expert for a hospital cafeteria. Identify allergens for each food item ONLY from the facility's allergen catalog.

FACILITY ALLERGEN CATALOG (use ONLY these exact names):
${allergenList}

ITEMS TO ANALYZE:
${itemList}

RULES:
- Return allergen names EXACTLY as they appear in the catalog. Do NOT invent new names.
- "contains" = item definitively contains the allergen as a primary ingredient.
- "mayContain" = allergen is commonly added to commercial versions (max 3 per item).
- Non-food items (containers, utensils, etc.) → empty arrays.
- If uncertain, OMIT. Operators verify against product labels.

Return ONLY valid JSON: {"items":[{"itemName":"<exact name>","contains":["names"],"mayContain":["names"]}]}`;

  const estimatedMaxTokens = Math.min(4000, 1000 + items.length * 60);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: estimatedMaxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') return new Map();

  let jsonStr = textBlock.text.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  try {
    const parsed = JSON.parse(jsonStr);
    const results = new Map<string, AllergenSuggestion>();

    for (const item of parsed.items || []) {
      if (!item.itemName) continue;

      const contains = (Array.isArray(item.contains) ? item.contains : [])
        .filter((n: unknown): n is string => typeof n === 'string')
        .filter((n: string) => allergenNameSet.has(n));

      const mayContain = (Array.isArray(item.mayContain) ? item.mayContain : [])
        .filter((n: unknown): n is string => typeof n === 'string')
        .filter((n: string) => allergenNameSet.has(n))
        .filter((n: string) => !contains.includes(n));

      results.set(item.itemName, { contains, mayContain });
    }

    return results;
  } catch {
    log.error('AI allergen JSON parse failed', { operation: 'aiAllergenBatch' });
    return new Map();
  }
}
