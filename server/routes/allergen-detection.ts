/**
 * AI Allergen Detection routes.
 *
 * POST /api/v1/allergens/detect-batch   — Batch detect allergens for multiple items
 * POST /api/v1/items/:id/ai-allergens   — Detect allergens for a single item and apply
 */

import { Express, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from '../lib/auth';
import { validateBody } from '../middleware/validate';
import { AllergenDetectBatchSchema } from '../lib/validation';
import { suggestAllergensBatch } from '../services/allergen-detection';
import { mergeAllergenDecision } from '../services/allergen-merge';
import { auditFromRequest } from '../services/audit-log';
import { rateLimit, userKey } from '../middleware/rate-limit';
import { log } from '../utils/logger';

// AI calls are expensive — rate limit per user
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  keyFn: userKey,
  name: 'aiAllergenLimit',
  message: 'AI allergen detection rate limit exceeded — try again in an hour',
});

export function registerAllergenDetectionRoutes(app: Express) {
  // ── Batch detect (preview only, no write) ─────────────────────────────
  app.post(
    '/api/v1/allergens/detect-batch',
    authMiddleware,
    aiLimiter,
    validateBody(AllergenDetectBatchSchema),
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const { itemIds } = req.validBody as { itemIds: string[] };

        if (!process.env.ANTHROPIC_API_KEY) {
          return res.status(503).json({ error: 'AI allergen detection is not configured on this server' });
        }

        const [items, facilityAllergens] = await Promise.all([
          prisma.item.findMany({ where: { facilityId, id: { in: itemIds } } }),
          prisma.allergen.findMany({ where: { facilityId } }),
        ]);

        if (facilityAllergens.length === 0) {
          return res.status(422).json({ error: 'No allergens configured for this facility' });
        }

        const results = await suggestAllergensBatch(
          items.map((i) => ({ name: i.name, description: i.category })),
          facilityAllergens.map((a) => ({ name: a.name, aiHint: a.aiHint })),
        );

        if (results.size === 0 && items.length > 0) {
          return res.status(502).json({ error: 'AI allergen detection returned no results — API may be unavailable' });
        }

        const allergenByName = new Map(facilityAllergens.map((a) => [a.name, a]));
        const preview = items.map((item) => {
          const suggestion = results.get(item.name) ?? { contains: [], mayContain: [] };
          return {
            itemId: item.id,
            itemName: item.name,
            contains: suggestion.contains.map((name) => ({
              allergenId: allergenByName.get(name)?.id,
              allergenName: name,
            })),
            mayContain: suggestion.mayContain.map((name) => ({
              allergenId: allergenByName.get(name)?.id,
              allergenName: name,
            })),
          };
        });

        res.json({ preview });
      } catch (error) {
        log.error(error, { operation: 'detectAllergensBatch' });
        res.status(500).json({ error: 'Allergen detection failed' });
      }
    },
  );

  // ── Single item AI detect + apply ─────────────────────────────────────
  app.post(
    '/api/v1/items/:id/ai-allergens',
    authMiddleware,
    aiLimiter,
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;

        if (!process.env.ANTHROPIC_API_KEY) {
          return res.status(503).json({ error: 'AI allergen detection is not configured on this server' });
        }

        const item = await prisma.item.findFirst({
          where: { id: req.params.id, facilityId },
          include: { allergens: true },
        });

        if (!item) return res.status(404).json({ error: 'Item not found' });

        const facilityAllergens = await prisma.allergen.findMany({ where: { facilityId } });

        if (facilityAllergens.length === 0) {
          return res.status(422).json({ error: 'No allergens configured for this facility' });
        }

        const results = await suggestAllergensBatch(
          [{ name: item.name, description: item.category }],
          facilityAllergens.map((a) => ({ name: a.name, aiHint: a.aiHint })),
        );

        if (results.size === 0) {
          return res.status(502).json({ error: 'AI detection returned no results' });
        }

        const suggestion = results.values().next().value as { contains: string[]; mayContain: string[] };
        const allergenByName = new Map(facilityAllergens.map((a) => [a.name, a]));
        const existingByAllergenId = new Map(item.allergens.map((ia) => [ia.allergenId, ia]));

        let applied = 0;

        // Apply CONTAINS suggestions
        for (const name of suggestion.contains) {
          const allergen = allergenByName.get(name);
          if (!allergen) continue;

          const existing = existingByAllergenId.get(allergen.id) ?? null;
          const decision = mergeAllergenDecision(
            existing ? { source: existing.source as 'MANUAL' | 'USDA_VERIFIED' | 'AI_SUGGESTED' | 'ROLLUP', severity: existing.severity as 'CONTAINS' | 'MAY_CONTAIN', confidence: existing.confidence } : null,
            { source: 'AI_SUGGESTED', severity: 'CONTAINS', confidence: 0.8 },
          );

          if (decision.action === 'insert') {
            await prisma.itemAllergen.create({
              data: { itemId: item.id, allergenId: allergen.id, severity: 'CONTAINS', source: 'AI_SUGGESTED', confidence: 0.8 },
            });
            applied++;
          } else if (decision.action === 'update') {
            await prisma.itemAllergen.update({
              where: { id: existingByAllergenId.get(allergen.id)!.id },
              data: { severity: decision.data.severity, source: decision.data.source, confidence: decision.data.confidence ?? null },
            });
            applied++;
          }
        }

        // Apply MAY_CONTAIN suggestions
        for (const name of suggestion.mayContain) {
          const allergen = allergenByName.get(name);
          if (!allergen) continue;

          const existing = existingByAllergenId.get(allergen.id) ?? null;
          const decision = mergeAllergenDecision(
            existing ? { source: existing.source as 'MANUAL' | 'USDA_VERIFIED' | 'AI_SUGGESTED' | 'ROLLUP', severity: existing.severity as 'CONTAINS' | 'MAY_CONTAIN', confidence: existing.confidence } : null,
            { source: 'AI_SUGGESTED', severity: 'MAY_CONTAIN', confidence: 0.6 },
          );

          if (decision.action === 'insert') {
            await prisma.itemAllergen.create({
              data: { itemId: item.id, allergenId: allergen.id, severity: 'MAY_CONTAIN', source: 'AI_SUGGESTED', confidence: 0.6 },
            });
            applied++;
          } else if (decision.action === 'update') {
            await prisma.itemAllergen.update({
              where: { id: existingByAllergenId.get(allergen.id)!.id },
              data: { severity: decision.data.severity, source: decision.data.source, confidence: decision.data.confidence ?? null },
            });
            applied++;
          }
        }

        await prisma.item.update({ where: { id: item.id }, data: { updatedAt: new Date() } });

        void auditFromRequest(req, {
          action: 'AI_ALLERGEN_DETECT',
          targetType: 'Item',
          targetId: item.id,
          details: { applied, contains: suggestion.contains, mayContain: suggestion.mayContain },
        });

        const refreshed = await prisma.item.findFirst({
          where: { id: item.id },
          include: { allergens: { include: { allergen: true } } },
        });

        res.json({
          applied,
          allergens: (refreshed?.allergens ?? []).map((ia) => ({
            id: ia.id,
            allergenId: ia.allergenId,
            allergenName: ia.allergen.name,
            isBigNine: ia.allergen.isBigNine,
            category: ia.allergen.category,
            severity: ia.severity,
            source: ia.source,
          })),
        });
      } catch (error) {
        log.error(error, { operation: 'aiAllergenItem', id: req.params.id });
        res.status(500).json({ error: 'AI allergen detection failed' });
      }
    },
  );
}
