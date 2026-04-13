/**
 * Allergens routes.
 *
 * GET  /api/v1/allergens        — List facility allergen catalog
 * POST /api/v1/allergens        — Create allergen
 * PUT  /api/v1/allergens/:id    — Update allergen
 * DELETE /api/v1/allergens/:id  — Delete allergen (clears ItemAllergen refs first)
 * POST /api/v1/allergens/sync   — Bulk upsert (name-keyed, same as Recipe HT sync)
 */

import { Express, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from '../lib/auth';
import { validateBody } from '../middleware/validate';
import { AllergenCreateSchema, AllergenUpdateSchema } from '../lib/validation';
import { auditFromRequest } from '../services/audit-log';
import { log } from '../utils/logger';

export function registerAllergenRoutes(app: Express) {
  // ── List ─────────────────────────────────────────────────────────────
  app.get('/api/v1/allergens', authMiddleware, async (req: Request, res: Response) => {
    try {
      const facilityId = req.facilityId!;
      const allergens = await prisma.allergen.findMany({
        where: { facilityId },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      });

      res.json({
        allergens: allergens.map((a) => ({
          id: a.id,
          name: a.name,
          severity: a.severity,
          isBigNine: a.isBigNine,
          keywords: (() => {
            try { return a.keywords ? JSON.parse(a.keywords) : []; } catch { return []; }
          })(),
          aiHint: a.aiHint,
          category: a.category,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        })),
      });
    } catch (error) {
      log.error(error, { operation: 'listAllergens' });
      res.status(500).json({ error: 'Failed to list allergens' });
    }
  });

  // ── Create ───────────────────────────────────────────────────────────
  app.post(
    '/api/v1/allergens',
    authMiddleware,
    validateBody(AllergenCreateSchema),
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const data = req.validBody as {
          name: string;
          severity?: string | null;
          isBigNine?: boolean;
          keywords?: string[] | null;
          aiHint?: string | null;
          category?: string;
        };

        const allergen = await prisma.allergen.create({
          data: {
            facilityId,
            name: data.name,
            severity: data.severity ?? null,
            isBigNine: data.isBigNine ?? false,
            keywords: data.keywords ? JSON.stringify(data.keywords) : null,
            aiHint: data.aiHint ?? null,
            category: data.category ?? 'ALLERGEN',
          },
        });

        void auditFromRequest(req, { action: 'ALLERGEN_CREATE', targetType: 'Allergen', targetId: allergen.id, details: { name: allergen.name } });
        res.status(201).json(allergen);
      } catch (error) {
        log.error(error, { operation: 'createAllergen' });
        res.status(500).json({ error: 'Failed to create allergen' });
      }
    },
  );

  // ── Bulk sync (upsert by name) ────────────────────────────────────────
  app.post('/api/v1/allergens/sync', authMiddleware, async (req: Request, res: Response) => {
    try {
      const facilityId = req.facilityId!;
      const { allergens } = req.body as {
        allergens: Array<{
          name: string;
          severity?: string;
          isBigNine?: boolean;
          keywords?: string[];
          aiHint?: string;
          category?: string;
        }>;
      };

      if (!Array.isArray(allergens)) {
        return res.status(400).json({ error: 'allergens array is required' });
      }

      let created = 0;
      let updated = 0;

      for (const a of allergens) {
        const existing = await prisma.allergen.findFirst({ where: { name: a.name, facilityId } });

        if (existing) {
          await prisma.allergen.update({
            where: { id: existing.id },
            data: {
              severity: a.severity ?? existing.severity,
              isBigNine: a.isBigNine ?? existing.isBigNine,
              keywords: a.keywords ? JSON.stringify(a.keywords) : existing.keywords,
              aiHint: a.aiHint ?? existing.aiHint,
              category: a.category ?? existing.category,
            },
          });
          updated++;
        } else {
          await prisma.allergen.create({
            data: {
              facilityId,
              name: a.name,
              severity: a.severity ?? null,
              isBigNine: a.isBigNine ?? false,
              keywords: a.keywords ? JSON.stringify(a.keywords) : null,
              aiHint: a.aiHint ?? null,
              category: a.category ?? 'ALLERGEN',
            },
          });
          created++;
        }
      }

      void auditFromRequest(req, { action: 'ALLERGEN_SYNC', targetType: 'Allergen', details: { created, updated } });
      res.json({ success: true, created, updated });
    } catch (error) {
      log.error(error, { operation: 'syncAllergens' });
      res.status(500).json({ error: 'Failed to sync allergens' });
    }
  });

  // ── Update ────────────────────────────────────────────────────────────
  app.put(
    '/api/v1/allergens/:id',
    authMiddleware,
    validateBody(AllergenUpdateSchema),
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const existing = await prisma.allergen.findFirst({ where: { id: req.params.id, facilityId } });

        if (!existing) return res.status(404).json({ error: 'Allergen not found' });

        const data = req.validBody as Partial<{
          name: string;
          severity: string | null;
          isBigNine: boolean;
          keywords: string[] | null;
          aiHint: string | null;
          category: string;
        }>;

        const updated = await prisma.allergen.update({
          where: { id: req.params.id },
          data: {
            ...data,
            keywords: data.keywords !== undefined
              ? (data.keywords ? JSON.stringify(data.keywords) : null)
              : undefined,
          },
        });

        void auditFromRequest(req, { action: 'ALLERGEN_UPDATE', targetType: 'Allergen', targetId: req.params.id });
        res.json(updated);
      } catch (error) {
        log.error(error, { operation: 'updateAllergen', id: req.params.id });
        res.status(500).json({ error: 'Failed to update allergen' });
      }
    },
  );

  // ── Delete ────────────────────────────────────────────────────────────
  app.delete('/api/v1/allergens/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
      const facilityId = req.facilityId!;
      const existing = await prisma.allergen.findFirst({ where: { id: req.params.id, facilityId } });

      if (!existing) return res.status(404).json({ error: 'Allergen not found' });

      // Must delete ItemAllergen refs first (NoAction cascade)
      await prisma.itemAllergen.deleteMany({ where: { allergenId: req.params.id } });
      await prisma.allergen.delete({ where: { id: req.params.id } });

      void auditFromRequest(req, { action: 'ALLERGEN_DELETE', targetType: 'Allergen', targetId: req.params.id, details: { name: existing.name } });
      res.json({ success: true });
    } catch (error) {
      log.error(error, { operation: 'deleteAllergen', id: req.params.id });
      res.status(500).json({ error: 'Failed to delete allergen' });
    }
  });
}
