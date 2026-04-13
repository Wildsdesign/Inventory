/**
 * AI Column Mapper — maps vendor file headers to Inventory item fields.
 *
 * Given a set of CSV/Excel headers, Claude Haiku maps them to known fields:
 *   name, vendorSku, vendorItemName, packSize, unitCost, category, portionUnit, allergens
 *
 * Returns a mapping { headerName: fieldName | null } for all headers.
 * Unknown headers map to null.
 *
 * Results are cached per vendor via VendorImportProfile.headerFingerprint so
 * Claude is called only on the first import per unique header set.
 */

import { anthropic } from '../lib/anthropic';
import { log } from '../utils/logger';

export type ImportFieldName =
  | 'name'
  | 'vendorSku'
  | 'vendorItemName'
  | 'packSize'
  | 'unitCost'
  | 'category'
  | 'portionUnit'
  | 'allergens'
  | null;

export type ColumnMapping = Record<string, ImportFieldName>;

const FIELD_DESCRIPTIONS: Record<string, string> = {
  name: 'The product/item name as used in inventory (e.g. "Chicken Breast", "Whole Milk")',
  vendorSku: 'Vendor SKU, item number, product code, or order code',
  vendorItemName: 'Vendor-side product description (may differ from inventory name)',
  packSize: 'Pack size, case size, unit pack (e.g. "24/16oz", "1/50lb", "CS")',
  unitCost: 'Unit price, cost per unit, price per each',
  category: 'Product category or department (e.g. "Dairy", "Produce", "Frozen")',
  portionUnit: 'Unit of measure for the item (oz, lb, ea, case)',
  allergens: 'Allergen declarations, contains statements',
};

export function fingerprintHeaders(headers: string[]): string {
  return headers
    .map((h) => h.toLowerCase().trim())
    .sort()
    .join('|');
}

export async function mapColumns(headers: string[]): Promise<ColumnMapping> {
  if (!process.env.ANTHROPIC_API_KEY) {
    log.warn('ANTHROPIC_API_KEY not set — returning null mappings');
    return Object.fromEntries(headers.map((h) => [h, null]));
  }

  const fieldList = Object.entries(FIELD_DESCRIPTIONS)
    .map(([field, desc]) => `  "${field}": ${desc}`)
    .join('\n');

  const prompt = `You are mapping vendor invoice/catalog column headers to inventory item fields.

HEADERS TO MAP:
${headers.map((h, i) => `${i + 1}. "${h}"`).join('\n')}

TARGET FIELDS:
${fieldList}

RULES:
- Map each header to exactly ONE target field, or null if it doesn't match any.
- Use the exact field name string from the TARGET FIELDS list.
- Multiple headers can map to the same field (e.g. "Item #" and "SKU" both → "vendorSku").
- Cost/price columns map to "unitCost" only if they represent per-unit cost. Totals, extended prices → null.
- If a header could plausibly be the item name (Description, Product Name, Item Name, etc.) → "name".

Return ONLY valid JSON: {"mappings":{"<header>":"<field or null>",...}}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return Object.fromEntries(headers.map((h) => [h, null]));

    let jsonStr = textBlock.text.trim();
    const codeMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeMatch) jsonStr = codeMatch[1].trim();

    const parsed = JSON.parse(jsonStr) as { mappings: Record<string, string | null> };
    const validFields = new Set(Object.keys(FIELD_DESCRIPTIONS));

    const result: ColumnMapping = {};
    for (const header of headers) {
      const mapped = parsed.mappings[header];
      result[header] = (mapped && validFields.has(mapped) ? mapped : null) as ImportFieldName;
    }

    return result;
  } catch (error) {
    log.error(error, { operation: 'aiColumnMapper' });
    return Object.fromEntries(headers.map((h) => [h, null]));
  }
}
