/**
 * Storage locations routes.
 *
 * GET  /api/v1/storage-locations             — List all
 * POST /api/v1/storage-locations             — Create
 * PUT  /api/v1/storage-locations/reorder     — Bulk reorder (drag+drop)
 * PUT  /api/v1/storage-locations/:id         — Update
 * DELETE /api/v1/storage-locations/:id       — Delete
 */

import { Express, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from '../lib/auth';
import { validateBody } from '../middleware/validate';
import {
  StorageLocationCreateSchema,
  StorageLocationUpdateSchema,
  StorageLocationReorderSchema,
} from '../lib/validation';
import { auditFromRequest } from '../services/audit-log';
import { log } from '../utils/logger';

export function registerStorageLocationRoutes(app: Express) {
  // ── List ─────────────────────────────────────────────────────────────
  app.get('/api/v1/storage-locations', authMiddleware, async (req: Request, res: Response) => {
    try {
      const facilityId = req.facilityId!;
      const locations = await prisma.storageLocation.findMany({
        where: { facilityId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { items: true } } },
      });

      res.json({
        storageLocations: locations.map((l) => ({
          id: l.id,
          name: l.name,
          description: l.description,
          category: l.category,
          sortOrder: l.sortOrder,
          isActive: l.isActive,
          itemCount: l._count.items,
          createdAt: l.createdAt,
          updatedAt: l.updatedAt,
        })),
      });
    } catch (error) {
      log.error(error, { operation: 'listStorageLocations' });
      res.status(500).json({ error: 'Failed to list storage locations' });
    }
  });

  // ── Create ───────────────────────────────────────────────────────────
  app.post(
    '/api/v1/storage-locations',
    authMiddleware,
    validateBody(StorageLocationCreateSchema),
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const data = req.validBody as {
          name: string;
          description?: string | null;
          category?: string | null;
          sortOrder?: number;
          isActive?: boolean;
        };

        const location = await prisma.storageLocation.create({
          data: {
            facilityId,
            name: data.name,
            description: data.description ?? null,
            category: data.category ?? null,
            sortOrder: data.sortOrder ?? 0,
            isActive: data.isActive ?? true,
          },
        });

        void auditFromRequest(req, { action: 'STORAGE_LOCATION_CREATE', targetType: 'StorageLocation', targetId: location.id, details: { name: location.name } });
        res.status(201).json(location);
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          error.message.includes('Unique constraint')
        ) {
          return res.status(409).json({ error: 'A storage location with that name already exists' });
        }
        log.error(error, { operation: 'createStorageLocation' });
        res.status(500).json({ error: 'Failed to create storage location' });
      }
    },
  );

  // ── Reorder — MUST be before /:id ─────────────────────────────────────
  app.put(
    '/api/v1/storage-locations/reorder',
    authMiddleware,
    validateBody(StorageLocationReorderSchema),
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const { order } = req.validBody as { order: Array<{ id: string; sortOrder: number }> };

        await Promise.all(
          order.map(({ id, sortOrder }) =>
            prisma.storageLocation.updateMany({
              where: { id, facilityId },
              data: { sortOrder },
            }),
          ),
        );

        res.json({ success: true });
      } catch (error) {
        log.error(error, { operation: 'reorderStorageLocations' });
        res.status(500).json({ error: 'Failed to reorder storage locations' });
      }
    },
  );

  // ── Update ────────────────────────────────────────────────────────────
  app.put(
    '/api/v1/storage-locations/:id',
    authMiddleware,
    validateBody(StorageLocationUpdateSchema),
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const existing = await prisma.storageLocation.findFirst({
          where: { id: req.params.id, facilityId },
        });

        if (!existing) {
          return res.status(404).json({ error: 'Storage location not found' });
        }

        const data = req.validBody as Partial<{
          name: string;
          description: string | null;
          category: string | null;
          sortOrder: number;
          isActive: boolean;
        }>;

        const updated = await prisma.storageLocation.update({
          where: { id: req.params.id },
          data,
        });

        void auditFromRequest(req, { action: 'STORAGE_LOCATION_UPDATE', targetType: 'StorageLocation', targetId: req.params.id });
        res.json(updated);
      } catch (error) {
        log.error(error, { operation: 'updateStorageLocation', id: req.params.id });
        res.status(500).json({ error: 'Failed to update storage location' });
      }
    },
  );

  // ── Delete ────────────────────────────────────────────────────────────
  app.delete('/api/v1/storage-locations/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
      const facilityId = req.facilityId!;
      const existing = await prisma.storageLocation.findFirst({
        where: { id: req.params.id, facilityId },
        include: { _count: { select: { items: true } } },
      });

      if (!existing) {
        return res.status(404).json({ error: 'Storage location not found' });
      }

      if (existing._count.items > 0) {
        return res.status(409).json({
          error: `Cannot delete — ${existing._count.items} items are assigned to this location. Reassign them first.`,
        });
      }

      await prisma.storageLocation.delete({ where: { id: req.params.id } });

      void auditFromRequest(req, { action: 'STORAGE_LOCATION_DELETE', targetType: 'StorageLocation', targetId: req.params.id, details: { name: existing.name } });
      res.json({ success: true });
    } catch (error) {
      log.error(error, { operation: 'deleteStorageLocation', id: req.params.id });
      res.status(500).json({ error: 'Failed to delete storage location' });
    }
  });
}
