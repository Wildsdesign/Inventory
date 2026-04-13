/**
 * Vendor routes.
 *
 * GET    /api/v1/vendors       — List vendors
 * POST   /api/v1/vendors       — Create vendor
 * PUT    /api/v1/vendors/:id   — Update vendor
 * DELETE /api/v1/vendors/:id   — Delete vendor (soft check: refuse if active items linked)
 */

import { Express, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from '../lib/auth';
import { validateBody } from '../middleware/validate';
import { VendorCreateSchema, VendorUpdateSchema } from '../lib/validation';
import { auditFromRequest } from '../services/audit-log';
import { log } from '../utils/logger';

export function registerVendorRoutes(app: Express) {
  // ── List ─────────────────────────────────────────────────────────────
  app.get('/api/v1/vendors', authMiddleware, async (req: Request, res: Response) => {
    try {
      const facilityId = req.facilityId!;
      const vendors = await prisma.vendor.findMany({
        where: { facilityId },
        orderBy: { name: 'asc' },
        include: { _count: { select: { itemVendors: true } } },
      });

      res.json({
        vendors: vendors.map((v) => ({
          id: v.id,
          name: v.name,
          contactName: v.contactName,
          contactEmail: v.contactEmail,
          contactPhone: v.contactPhone,
          notes: v.notes,
          isActive: v.isActive,
          itemCount: v._count.itemVendors,
          createdAt: v.createdAt,
          updatedAt: v.updatedAt,
        })),
      });
    } catch (error) {
      log.error(error, { operation: 'listVendors' });
      res.status(500).json({ error: 'Failed to list vendors' });
    }
  });

  // ── Create ───────────────────────────────────────────────────────────
  app.post(
    '/api/v1/vendors',
    authMiddleware,
    validateBody(VendorCreateSchema),
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const data = req.validBody as {
          name: string;
          contactName?: string | null;
          contactEmail?: string | null;
          contactPhone?: string | null;
          notes?: string | null;
          isActive?: boolean;
        };

        const vendor = await prisma.vendor.create({
          data: {
            facilityId,
            name: data.name,
            contactName: data.contactName ?? null,
            contactEmail: data.contactEmail ?? null,
            contactPhone: data.contactPhone ?? null,
            notes: data.notes ?? null,
            isActive: data.isActive ?? true,
          },
        });

        void auditFromRequest(req, { action: 'VENDOR_CREATE', targetType: 'Vendor', targetId: vendor.id, details: { name: vendor.name } });
        res.status(201).json(vendor);
      } catch (error) {
        log.error(error, { operation: 'createVendor' });
        res.status(500).json({ error: 'Failed to create vendor' });
      }
    },
  );

  // ── Update ────────────────────────────────────────────────────────────
  app.put(
    '/api/v1/vendors/:id',
    authMiddleware,
    validateBody(VendorUpdateSchema),
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const existing = await prisma.vendor.findFirst({ where: { id: req.params.id, facilityId } });

        if (!existing) return res.status(404).json({ error: 'Vendor not found' });

        const data = req.validBody as Partial<{
          name: string;
          contactName: string | null;
          contactEmail: string | null;
          contactPhone: string | null;
          notes: string | null;
          isActive: boolean;
        }>;

        const updated = await prisma.vendor.update({ where: { id: req.params.id }, data });

        void auditFromRequest(req, { action: 'VENDOR_UPDATE', targetType: 'Vendor', targetId: req.params.id });
        res.json(updated);
      } catch (error) {
        log.error(error, { operation: 'updateVendor', id: req.params.id });
        res.status(500).json({ error: 'Failed to update vendor' });
      }
    },
  );

  // ── Delete ────────────────────────────────────────────────────────────
  app.delete('/api/v1/vendors/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
      const facilityId = req.facilityId!;
      const existing = await prisma.vendor.findFirst({
        where: { id: req.params.id, facilityId },
        include: { _count: { select: { itemVendors: true } } },
      });

      if (!existing) return res.status(404).json({ error: 'Vendor not found' });

      if (existing._count.itemVendors > 0) {
        return res.status(409).json({
          error: `Cannot delete — ${existing._count.itemVendors} items are linked to this vendor. Unlink them first.`,
        });
      }

      await prisma.vendor.delete({ where: { id: req.params.id } });

      void auditFromRequest(req, { action: 'VENDOR_DELETE', targetType: 'Vendor', targetId: req.params.id, details: { name: existing.name } });
      res.json({ success: true });
    } catch (error) {
      log.error(error, { operation: 'deleteVendor', id: req.params.id });
      res.status(500).json({ error: 'Failed to delete vendor' });
    }
  });
}
