/**
 * Duplicate detection for import pipeline.
 *
 * For each incoming row, check if a matching item already exists in the facility's
 * item catalog. Match strategy (in priority order):
 *   1. SKU match — if vendorSku matches an existing ItemVendor.vendorSku for this vendor
 *   2. Name match — exact name match (case-insensitive)
 *   3. Fuzzy match — simple similarity score on item name
 *
 * Returns the match type and itemId for matched rows.
 */

import prisma from '../lib/prisma';

export type MatchType = 'new' | 'sku_match' | 'name_match' | 'fuzzy_match';

export interface MatchResult {
  matchType: MatchType;
  itemId?: string;
  itemName?: string;
  confidence: number;
}

/**
 * Simple string similarity using character bigrams.
 */
function similarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const na = normalize(a);
  const nb = normalize(b);

  if (na === nb) return 1.0;
  if (na.length < 2 || nb.length < 2) return 0;

  const bigrams = (s: string): Set<string> => {
    const bg = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) bg.add(s.slice(i, i + 2));
    return bg;
  };

  const setA = bigrams(na);
  const setB = bigrams(nb);
  let intersection = 0;
  for (const bg of setA) if (setB.has(bg)) intersection++;

  return (2 * intersection) / (setA.size + setB.size);
}

const FUZZY_THRESHOLD = 0.6;

export async function detectDuplicates(
  facilityId: string,
  vendorId: string | undefined,
  rows: Array<{ name: string; vendorSku?: string | null }>,
): Promise<MatchResult[]> {
  // Fetch all items + their vendor cross-references for this facility
  const [items, itemVendors] = await Promise.all([
    prisma.item.findMany({ where: { facilityId }, select: { id: true, name: true } }),
    vendorId
      ? prisma.itemVendor.findMany({ where: { vendorId }, select: { itemId: true, vendorSku: true } })
      : Promise.resolve([]),
  ]);

  const nameToItemId = new Map(items.map((i) => [i.name.toLowerCase(), i.id]));
  const skuToItemId = new Map(itemVendors.map((iv) => [iv.vendorSku?.toLowerCase() ?? '', iv.itemId]));

  return rows.map((row) => {
    const rowSku = row.vendorSku?.toLowerCase().trim();
    const rowName = row.name.toLowerCase().trim();

    // 1. SKU match
    if (rowSku && skuToItemId.has(rowSku)) {
      const itemId = skuToItemId.get(rowSku)!;
      return { matchType: 'sku_match', itemId, confidence: 1.0 };
    }

    // 2. Name match
    if (nameToItemId.has(rowName)) {
      const itemId = nameToItemId.get(rowName)!;
      return { matchType: 'name_match', itemId, confidence: 0.95 };
    }

    // 3. Fuzzy match
    let bestScore = 0;
    let bestItemId: string | undefined;
    let bestName: string | undefined;

    for (const item of items) {
      const score = similarity(row.name, item.name);
      if (score > bestScore) {
        bestScore = score;
        bestItemId = item.id;
        bestName = item.name;
      }
    }

    if (bestScore >= FUZZY_THRESHOLD && bestItemId) {
      return { matchType: 'fuzzy_match', itemId: bestItemId, itemName: bestName, confidence: bestScore };
    }

    return { matchType: 'new', confidence: 0 };
  });
}
