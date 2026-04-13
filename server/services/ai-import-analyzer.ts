/**
 * AI Import Analyzer — category assignment and allergen inference for import preview.
 *
 * Called during the import preview step to enrich rows before the operator reviews:
 *   1. suggestCategories — AI batch-assigns food service categories to items missing one
 *   2. parseAllergensFromIngredients — keyword-scans ingredient text for Big 9 allergens
 *
 * No async job processing, no ImportJob progress tracking. Synchronous enrichment
 * that runs inline during POST /api/v1/import/preview.
 */

import { anthropic } from '../lib/anthropic';
import { log } from '../utils/logger';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CategoryInput {
  index: number;
  name: string;
  category?: string | null;
}

export interface CategorySuggestion {
  index: number;
  category: string;
  confidence: number;
}

export interface IngredientInput {
  itemName: string;
  ingredients: string;
}

export interface InferredAllergen {
  itemName: string;
  allergen: string;
  source: 'ingredient_parse';
  ingredient: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FOOD_SERVICE_CATEGORIES = [
  'Proteins',
  'Dairy',
  'Produce',
  'Bread & Bakery',
  'Canned & Dry Goods',
  'Frozen Foods',
  'Condiments & Sauces',
  'Beverages',
  'Snacks',
  'Spices & Seasonings',
  'Paper & Supplies',
  'Cleaning Supplies',
  'Other',
];

// Quick keyword heuristics — avoid AI call for obvious items
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Proteins': ['chicken', 'beef', 'pork', 'turkey', 'fish', 'salmon', 'tuna', 'shrimp', 'lamb', 'veal', 'bacon', 'sausage', 'ham', 'steak', 'patty', 'patties', 'ground beef', 'tilapia', 'cod'],
  'Dairy': ['milk', 'cheese', 'butter', 'cream', 'yogurt', 'sour cream', 'whipping cream', 'ice cream', 'margarine', 'half and half', 'creamer', 'cheddar', 'mozzarella', 'parmesan'],
  'Produce': ['lettuce', 'tomato', 'onion', 'potato', 'carrot', 'broccoli', 'spinach', 'apple', 'banana', 'orange', 'pepper', 'cucumber', 'celery', 'mushroom', 'garlic', 'lemon', 'lime', 'avocado'],
  'Bread & Bakery': ['bread', 'bun', 'roll', 'muffin', 'bagel', 'croissant', 'tortilla', 'pita', 'wrap', 'biscuit', 'waffle', 'pancake', 'cake', 'pie', 'cookie', 'brownie', 'donut'],
  'Canned & Dry Goods': ['beans', 'rice', 'pasta', 'flour', 'sugar', 'oats', 'cereal', 'soup', 'broth', 'stock', 'tomato sauce', 'canned', '#10 can', 'dried', 'lentil', 'chickpea'],
  'Frozen Foods': ['frozen', 'iqf', 'fz', 'concentrate'],
  'Condiments & Sauces': ['ketchup', 'mustard', 'mayo', 'mayonnaise', 'ranch', 'bbq', 'hot sauce', 'soy sauce', 'vinegar', 'oil', 'dressing', 'marinade', 'sauce', 'syrup', 'jam', 'jelly'],
  'Beverages': ['juice', 'water', 'coffee', 'tea', 'soda', 'lemonade', 'milk carton', 'drink', 'beverage', 'gatorade', 'orange juice', 'apple juice'],
  'Snacks': ['chips', 'crackers', 'pretzels', 'popcorn', 'granola', 'trail mix', 'nuts', 'fruit cup', 'pudding cup', 'jello', 'snack'],
  'Spices & Seasonings': ['salt', 'pepper', 'spice', 'herb', 'seasoning', 'garlic powder', 'onion powder', 'cumin', 'oregano', 'basil', 'thyme', 'rosemary', 'paprika', 'cinnamon'],
  'Paper & Supplies': ['napkin', 'towel', 'glove', 'wrap', 'foil', 'container', 'cup', 'plate', 'tray', 'bag', 'liner', 'can liner', 'tissue'],
  'Cleaning Supplies': ['cleaner', 'sanitizer', 'soap', 'detergent', 'bleach', 'degreaser', 'disinfect'],
};

const INGREDIENT_ALLERGEN_MAP: Record<string, string[]> = {
  wheat: ['flour', 'wheat', 'bread', 'pasta', 'breadcrumbs', 'breading', 'bun', 'roll', 'cracker', 'semolina', 'durum'],
  gluten: ['flour', 'wheat', 'barley', 'rye', 'malt', 'bread', 'pasta', 'breadcrumbs'],
  milk: ['milk', 'cream', 'butter', 'cheese', 'yogurt', 'whey', 'casein', 'lactose', 'dairy', 'ice cream', 'sour cream'],
  eggs: ['egg', 'eggs', 'mayo', 'mayonnaise', 'meringue', 'custard', 'albumin'],
  peanut: ['peanut', 'peanut butter', 'peanuts'],
  treenut: ['almond', 'walnut', 'pecan', 'cashew', 'pistachio', 'hazelnut', 'macadamia', 'brazil nut', 'pine nut'],
  soy: ['soy', 'soybean', 'tofu', 'edamame', 'soy sauce', 'soya', 'tempeh', 'miso'],
  shellfish: ['shrimp', 'crab', 'lobster', 'crawfish', 'crayfish', 'prawn', 'scallop'],
  fish: ['salmon', 'tuna', 'cod', 'tilapia', 'fish', 'anchovy', 'sardine', 'bass', 'trout', 'halibut'],
  sesame: ['sesame', 'tahini'],
};

// ── Category assignment ───────────────────────────────────────────────────────

/**
 * Fast heuristic category assignment — no AI call.
 * Returns null if the item name doesn't match any keyword.
 */
function assignCategoryHeuristic(name: string): string | null {
  const nameLower = name.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => nameLower.includes(kw))) {
      return category;
    }
  }
  return null;
}

/**
 * AI batch category assignment.
 * Takes items missing a category, returns suggested categories.
 * Falls back to 'Other' if AI fails.
 */
export async function suggestCategories(
  items: CategoryInput[]
): Promise<CategorySuggestion[]> {
  if (items.length === 0) return [];

  // First pass: heuristic (instant)
  const results: CategorySuggestion[] = [];
  const needsAI: CategoryInput[] = [];

  for (const item of items) {
    if (item.category) {
      // Already has a category — skip
      continue;
    }
    const heuristic = assignCategoryHeuristic(item.name);
    if (heuristic) {
      results.push({ index: item.index, category: heuristic, confidence: 0.8 });
    } else {
      needsAI.push(item);
    }
  }

  if (needsAI.length === 0) return results;

  // Second pass: AI for items the heuristic couldn't classify
  const itemsList = needsAI.map((item, i) => `[${i}] "${item.name}"`).join('\n');

  const prompt = `You are categorizing hospital cafeteria inventory items. Assign each item to ONE category from this list:
${FOOD_SERVICE_CATEGORIES.map(c => `- ${c}`).join('\n')}

Items:
${itemsList}

Return ONLY a JSON array with one entry per item in order:
[{"index": <original index>, "category": "<category>", "confidence": 0.0-1.0}, ...]

Rules:
- Choose the most specific matching category
- "Other" only when nothing else fits
- Proteins = any meat, poultry, seafood
- Dairy = milk, cheese, butter, cream products
- Produce = fresh fruits and vegetables`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return [...results, ...needsAI.map(item => ({ index: item.index, category: 'Other', confidence: 0.3 }))];
    }

    const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [...results, ...needsAI.map(item => ({ index: item.index, category: 'Other', confidence: 0.3 }))];
    }

    const parsed: Array<{ index: number; category: string; confidence: number }> = JSON.parse(jsonMatch[0]);

    // Map AI results back using original index from needsAI
    const aiResults: CategorySuggestion[] = parsed.map((r, i) => ({
      index: needsAI[i]?.index ?? r.index,
      category: r.category || 'Other',
      confidence: r.confidence || 0.7,
    }));

    return [...results, ...aiResults];
  } catch (error) {
    log.error(error, { operation: 'suggestCategories', count: needsAI.length });
    return [...results, ...needsAI.map(item => ({ index: item.index, category: 'Other', confidence: 0.3 }))];
  }
}

// ── Allergen inference from ingredients ──────────────────────────────────────

/**
 * Keyword-scan ingredient text for known allergens.
 * Pure JS — no AI call, no database queries.
 * Results are informational; always requires human review before persisting.
 */
export function parseAllergensFromIngredients(
  items: IngredientInput[]
): InferredAllergen[] {
  const results: InferredAllergen[] = [];

  for (const item of items) {
    if (!item.ingredients) continue;

    const ingredientsLower = item.ingredients.toLowerCase();

    for (const [allergen, keywords] of Object.entries(INGREDIENT_ALLERGEN_MAP)) {
      for (const keyword of keywords) {
        if (ingredientsLower.includes(keyword)) {
          const alreadyFound = results.some(
            r => r.itemName === item.itemName && r.allergen === allergen
          );
          if (!alreadyFound) {
            results.push({
              itemName: item.itemName,
              allergen,
              source: 'ingredient_parse',
              ingredient: keyword,
            });
          }
          break;
        }
      }
    }
  }

  return results;
}

// ── Preview row analysis ──────────────────────────────────────────────────────

export interface PreviewRowInput {
  index: number;
  name: string;
  category?: string | null;
  ingredients?: string | null;
}

export interface PreviewAnalysisResult {
  categorySuggestions: CategorySuggestion[];
  inferredAllergens: InferredAllergen[];
}

/**
 * Analyze import preview rows — suggest categories and infer allergens.
 * Called inline during POST /api/v1/import/preview after column mapping.
 */
export async function analyzeImportPreview(
  rows: PreviewRowInput[]
): Promise<PreviewAnalysisResult> {
  const itemsForCategories: CategoryInput[] = rows
    .filter(r => !r.category)
    .map(r => ({ index: r.index, name: r.name, category: r.category }));

  const itemsForAllergens: IngredientInput[] = rows
    .filter(r => r.ingredients && r.ingredients.trim().length > 0)
    .map(r => ({ itemName: r.name, ingredients: r.ingredients! }));

  const [categorySuggestions, inferredAllergens] = await Promise.all([
    suggestCategories(itemsForCategories),
    Promise.resolve(parseAllergensFromIngredients(itemsForAllergens)),
  ]);

  return { categorySuggestions, inferredAllergens };
}
