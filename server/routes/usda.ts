/**
 * USDA FoodData Central routes.
 *
 * GET  /api/v1/usda/search       — Search USDA for nutrition data
 * GET  /api/v1/usda/:fdcId       — Get full nutrient detail by FDC ID
 * POST /api/v1/items/:id/apply-usda — Apply USDA nutrition to an item
 */

import { Express, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from '../lib/auth';
import { validateBody } from '../middleware/validate';
import { UsdaApplySchema } from '../lib/validation';
import {
  searchUSDA,
  getUSDANutrition,
  mapUSDANutrition,
  captureAllUSDANutrients,
  extractAllergensFromIngredients,
  parseAllergenKeywords,
  USDA_NUTRIENT_MAP,
  type USDAFoodNutrient,
} from '../services/usda-integration';
import { mergeAllergenDecision } from '../services/allergen-merge';
import { auditFromRequest } from '../services/audit-log';
import { log } from '../utils/logger';

export function registerUsdaRoutes(app: Express) {
  // ── Search ───────────────────────────────────────────────────────────
  app.get('/api/v1/usda/search', authMiddleware, async (req: Request, res: Response) => {
    try {
      const query = req.query.q;
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return res.status(400).json({ error: 'q query param is required' });
      }

      const { results, error } = await searchUSDA(query.trim());

      if (error && results.length === 0) {
        return res.status(503).json({ error });
      }

      // Shape each result with a lightweight nutrientPreview so the
      // search dialog can show calories / protein / sodium inline.
      const shaped = results.map((r) => {
        const preview: Record<string, number> = {};
        for (const n of (r.foodNutrients ?? []) as USDAFoodNutrient[]) {
          const id = n.nutrient?.id ?? n.nutrientId ?? 0;
          const value = n.amount ?? n.value;
          const field = USDA_NUTRIENT_MAP[id];
          if (field && value != null) preview[field] = value;
        }
        return {
          fdcId: r.fdcId,
          description: r.description,
          dataType: r.dataType,
          brandOwner: r.brandOwner,
          brandName: r.brandName,
          ingredients: r.ingredients,
          servingSize: r.servingSize,
          servingSizeUnit: r.servingSizeUnit,
          householdServingFullText: r.householdServingFullText,
          score: r.score,
          nutrientPreview: preview,
        };
      });

      res.json({ results: shaped, count: shaped.length });
    } catch (error) {
      log.error(error, { operation: 'usdaSearch' });
      res.status(500).json({ error: 'USDA search failed' });
    }
  });

  // ── Get full detail ──────────────────────────────────────────────────
  app.get('/api/v1/usda/:fdcId', authMiddleware, async (req: Request, res: Response) => {
    try {
      const fdcId = parseInt(req.params.fdcId, 10);
      if (isNaN(fdcId)) return res.status(400).json({ error: 'Invalid fdcId' });

      const { data, error } = await getUSDANutrition(fdcId);

      if (error || !data) {
        return res.status(503).json({ error: error || 'USDA fetch failed' });
      }

      const mapped = mapUSDANutrition(data);
      const raw = captureAllUSDANutrients(data);

      res.json({
        fdcId,
        description: data.description,
        dataType: data.dataType,
        brandOwner: data.brandOwner,
        brandName: data.brandName,
        ingredients: data.ingredients,
        servingSize: data.servingSize,
        servingSizeUnit: data.servingSizeUnit,
        // `mapped` is the standard name across the MindServe product family.
        // `nutrition` is kept as a deprecated alias for any existing callers.
        mapped,
        nutrition: mapped,
        rawNutrients: raw,
      });
    } catch (error) {
      log.error(error, { operation: 'usdaDetail' });
      res.status(500).json({ error: 'USDA detail fetch failed' });
    }
  });

  // ── Apply to item ─────────────────────────────────────────────────────
  app.post(
    '/api/v1/items/:id/apply-usda',
    authMiddleware,
    validateBody(UsdaApplySchema),
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const { fdcId, overwrite } = req.validBody as { fdcId: number; overwrite: boolean };

        const item = await prisma.item.findFirst({
          where: { id: req.params.id, facilityId },
          include: { nutrition: true, allergens: true },
        });

        if (!item) return res.status(404).json({ error: 'Item not found' });

        // If item already has USDA nutrition and overwrite=false, skip
        if (item.nutrition?.source === 'usda' && !overwrite) {
          return res.status(409).json({
            error: 'Item already has USDA nutrition data. Pass overwrite=true to replace.',
          });
        }

        const { data, error } = await getUSDANutrition(fdcId);
        if (error || !data) {
          return res.status(503).json({ error: error || 'USDA fetch failed' });
        }

        const mapped = mapUSDANutrition(data);
        const raw = captureAllUSDANutrients(data);
        const ingredients = (data.ingredients as string | undefined) || null;

        // Upsert nutrition
        await prisma.itemNutrition.upsert({
          where: { itemId: item.id },
          create: {
            itemId: item.id,
            ...mapped,
            rawNutrients: JSON.stringify(raw),
            ingredients,
            source: 'usda',
            usdaFdcId: String(fdcId),
            confidence: 1.0,
            lastEnrichedAt: new Date(),
          },
          update: {
            ...mapped,
            rawNutrients: JSON.stringify(raw),
            ingredients,
            source: 'usda',
            usdaFdcId: String(fdcId),
            confidence: 1.0,
            lastEnrichedAt: new Date(),
          },
        });

        // Extract allergens from ingredients string
        if (ingredients) {
          const facilityAllergens = await prisma.allergen.findMany({ where: { facilityId } });
          const allergenKeywords = facilityAllergens.map((a) => ({
            name: a.name,
            keywords: parseAllergenKeywords(a.keywords),
          }));

          const { contains, mayContain } = extractAllergensFromIngredients(ingredients, allergenKeywords);
          const allergenByName = new Map(facilityAllergens.map((a) => [a.name, a]));
          const existingByAllergenId = new Map(item.allergens.map((ia) => [ia.allergenId, ia]));

          for (const [names, severity] of [[contains, 'CONTAINS'], [mayContain, 'MAY_CONTAIN']] as const) {
            for (const name of names) {
              const allergen = allergenByName.get(name);
              if (!allergen) continue;

              const existing = existingByAllergenId.get(allergen.id) ?? null;
              const decision = mergeAllergenDecision(
                existing ? { source: existing.source as 'MANUAL' | 'USDA_VERIFIED' | 'AI_SUGGESTED' | 'ROLLUP', severity: existing.severity as 'CONTAINS' | 'MAY_CONTAIN', confidence: existing.confidence } : null,
                { source: 'USDA_VERIFIED', severity, confidence: 0.95 },
              );

              if (decision.action === 'insert') {
                await prisma.itemAllergen.create({
                  data: { itemId: item.id, allergenId: allergen.id, severity, source: 'USDA_VERIFIED', confidence: 0.95 },
                });
              } else if (decision.action === 'update') {
                await prisma.itemAllergen.update({
                  where: { id: existingByAllergenId.get(allergen.id)!.id },
                  data: { severity: decision.data.severity, source: decision.data.source, confidence: decision.data.confidence ?? null },
                });
              }
            }
          }
        }

        await prisma.item.update({ where: { id: item.id }, data: { updatedAt: new Date() } });

        void auditFromRequest(req, {
          action: 'USDA_APPLY',
          targetType: 'Item',
          targetId: item.id,
          details: { fdcId, overwrite },
        });

        const refreshed = await prisma.item.findFirst({
          where: { id: item.id },
          include: { nutrition: true, allergens: { include: { allergen: true } } },
        });

        res.json(refreshed);
      } catch (error) {
        log.error(error, { operation: 'applyUsda', id: req.params.id });
        res.status(500).json({ error: 'Failed to apply USDA nutrition' });
      }
    },
  );
}
