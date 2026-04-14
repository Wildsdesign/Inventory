/**
 * Storage Location routes.
 *
 * Facility-scoped CRUD for the storage areas inventory items live in.
 * Each StorageLocation has a sortOrder field that drives the walking
 * order — a facility arranges it to match their physical kitchen layout.
 *
 * GET    /api/v1/storage-locations               — list all (facility scoped)
 * GET    /api/v1/storage-locations/templates     — standard hospital kitchen template list
 * POST   /api/v1/storage-locations/setup         — bulk-create from template selections
 * POST   /api/v1/storage-locations               — create single
 * POST   /api/v1/storage-locations/reorder       — bulk sortOrder update
 * PUT    /api/v1/storage-locations/:id           — update name/description/category/sortOrder/isActive
 * DELETE /api/v1/storage-locations/:id           — delete (refused if any Items reference it)
 */

import { Express, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from '../lib/auth';
import { validateBody } from '../middleware/validate';
import {
  StorageLocationCreateSchema,
  StorageLocationUpdateSchema,
  StorageLocationReorderSchema,
  StorageLocationSetupSchema,
} from '../lib/validation';
import { auditFromRequest } from '../services/audit-log';
import { log } from '../utils/logger';

export function registerStorageLocationRoutes(app: Express) {
  // ── List storage locations ────────────────────────────────────────
  app.get(
    '/api/v1/storage-locations',
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const locations = await prisma.storageLocation.findMany({
          where: { facilityId },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: { _count: { select: { items: true } } },
        });
        res.json({
          locations: locations.map((l) => ({
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
          count: locations.length,
        });
      } catch (error) {
        log.error(error, { operation: 'listStorageLocations' });
        res.status(500).json({ error: 'Failed to list storage locations' });
      }
    },
  );

  // ── Template list (standard hospital kitchen locations) ─────────
  // Returns a categorized list of suggested locations. Marks each as
  // "already exists" if the facility already has a location with the
  // same name so the wizard can show checkboxes pre-checked.

  interface TemplateLocation {
    name: string;
    description: string;
    category: string;
  }

  interface TemplateCategory {
    category: string;
    label: string;
    locations: Array<TemplateLocation & { alreadyExists: boolean }>;
  }

  const TEMPLATE_CATALOG: TemplateLocation[] = [
    // Dry Storage
    { name: 'Dry Storage', description: 'General ambient temperature storage for shelf-stable goods', category: 'dry' },
    { name: 'Canned & Jarred Goods', description: 'Canned, jarred, and shelf-stable items', category: 'dry' },
    { name: 'Canned Goods', description: 'Canned goods including #10 cans, vegetables, sauces', category: 'dry' },
    { name: 'Grains & Pasta', description: 'Rice, pasta, flour, cereal, bread products', category: 'dry' },
    { name: 'Spices & Seasonings', description: 'Spices, herbs, seasonings, salt, pepper', category: 'dry' },
    { name: 'Oils & Condiments', description: 'Cooking oils, vinegar, ketchup, mustard, dressings', category: 'dry' },
    { name: 'Baking Supplies', description: 'Sugar, flour, baking mixes, yeast, cocoa', category: 'dry' },
    { name: 'Bakery Shelf', description: 'Bread, buns, tortillas, crackers', category: 'dry' },
    // Refrigerated
    { name: 'Walk-In Cooler', description: 'Main walk-in refrigerated storage (34-40F)', category: 'refrigerated' },
    { name: 'Reach-In Cooler', description: 'Line-side reach-in refrigeration (34-40F)', category: 'refrigerated' },
    { name: 'Produce Cooler', description: 'Fresh produce refrigeration', category: 'refrigerated' },
    { name: 'Dairy Cooler', description: 'Dedicated dairy, eggs, and cheese storage', category: 'refrigerated' },
    { name: 'Beverage Cooler', description: 'Refrigerated beverage storage', category: 'refrigerated' },
    { name: 'Prep Cooler', description: 'Cold holding during prep (prepped ingredients, mise en place)', category: 'refrigerated' },
    // Frozen
    { name: 'Walk-In Freezer', description: 'Main walk-in frozen storage (0F or below)', category: 'frozen' },
    { name: 'Reach-In Freezer', description: 'Line-side reach-in freezer (0F or below)', category: 'frozen' },
    { name: 'Ice Cream Freezer', description: 'Dedicated frozen dessert and ice cream storage', category: 'frozen' },
    // Production
    { name: 'Production Kitchen', description: 'Active prep area — items in use for current production', category: 'production' },
    { name: 'Prep Kitchen', description: 'Active food preparation work area', category: 'production' },
    { name: 'Cook Line', description: 'Grill, fryer, oven, and cooking equipment area', category: 'production' },
    { name: 'Hot Holding', description: 'Hot holding cabinets and steam tables (135F+)', category: 'production' },
    { name: 'Cold Holding', description: 'Cold holding area for salads, cold items', category: 'production' },
    { name: 'Tray Line', description: 'Patient dining tray assembly line', category: 'production' },
    { name: 'Cafeteria Line', description: 'Cafeteria serving line and display', category: 'production' },
    // Receiving
    { name: 'Receiving Dock', description: 'Incoming delivery inspection and receiving area', category: 'receiving' },
    { name: 'Quarantine', description: 'Items pending inspection or temperature verification', category: 'receiving' },
    // Specialty
    { name: 'Pharmacy Nutrition', description: 'Tube feeding, nutritional supplements, medical nutrition', category: 'specialty' },
    { name: 'Nourishment Room', description: 'Floor-level patient snacks, juice, crackers', category: 'specialty' },
    { name: 'Catering Storage', description: 'Catering equipment, platters, and staging supplies', category: 'specialty' },
    { name: 'Vending Storage', description: 'Vending machine stock and backup inventory', category: 'specialty' },
  ];

  const CATEGORY_LABELS: Record<string, string> = {
    dry: 'Dry Storage',
    refrigerated: 'Refrigerated',
    frozen: 'Frozen',
    production: 'Production',
    receiving: 'Receiving',
    specialty: 'Specialty',
  };

  app.get(
    '/api/v1/storage-locations/templates',
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const existing = await prisma.storageLocation.findMany({
          where: { facilityId },
          select: { name: true },
        });
        const existingNames = new Set(existing.map((l) => l.name.toLowerCase()));

        // Group by category
        const categoryMap = new Map<string, TemplateCategory>();
        for (const tmpl of TEMPLATE_CATALOG) {
          let cat = categoryMap.get(tmpl.category);
          if (!cat) {
            cat = {
              category: tmpl.category,
              label: CATEGORY_LABELS[tmpl.category] || tmpl.category,
              locations: [],
            };
            categoryMap.set(tmpl.category, cat);
          }
          cat.locations.push({
            ...tmpl,
            alreadyExists: existingNames.has(tmpl.name.toLowerCase()),
          });
        }

        res.json({
          categories: Array.from(categoryMap.values()),
          totalTemplates: TEMPLATE_CATALOG.length,
          existingCount: existing.length,
        });
      } catch (error) {
        log.error(error, { operation: 'listStorageTemplates' });
        res.status(500).json({ error: 'Failed to list templates' });
      }
    },
  );

  // ── Setup from templates (bulk create) ────────────────────────────
  // Body: { names: string[] } — names from the template catalog to create
  app.post(
    '/api/v1/storage-locations/setup',
    authMiddleware,
    validateBody(StorageLocationSetupSchema),
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const { names } = req.validBody as { names: string[] };

        // Only create names that are in the template catalog
        const templateByName = new Map(
          TEMPLATE_CATALOG.map((t) => [t.name.toLowerCase(), t]),
        );

        // Skip names that already exist
        const existing = await prisma.storageLocation.findMany({
          where: { facilityId },
          select: { name: true, sortOrder: true },
        });
        const existingNames = new Set(existing.map((l) => l.name.toLowerCase()));
        const maxSort = existing.reduce((max, l) => Math.max(max, l.sortOrder), 0);

        let created = 0;
        let nextSort = maxSort + 10;

        for (const name of names) {
          const template = templateByName.get(name.toLowerCase());
          if (!template) continue;
          if (existingNames.has(name.toLowerCase())) continue;

          await prisma.storageLocation.create({
            data: {
              facilityId,
              name: template.name,
              description: template.description,
              category: template.category,
              sortOrder: nextSort,
              isActive: true,
            },
          });
          created++;
          nextSort += 10;
        }

        void auditFromRequest(req, {
          action: 'STORAGE_LOCATION_SETUP',
          targetType: 'StorageLocation',
          details: { requested: names.length, created, skippedExisting: names.length - created },
        });

        res.json({ success: true, created });
      } catch (error) {
        log.error(error, { operation: 'setupStorageLocations' });
        res.status(500).json({ error: 'Failed to set up storage locations' });
      }
    },
  );

  // ── Create single ─────────────────────────────────────────────────
  app.post(
    '/api/v1/storage-locations',
    authMiddleware,
    validateBody(StorageLocationCreateSchema),
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const { name, description, category, sortOrder, isActive } = req.validBody as {
          name: string;
          description?: string | null;
          category?: string | null;
          sortOrder?: number;
          isActive?: boolean;
        };

        // If no sortOrder provided, place at the end
        let finalSortOrder = sortOrder;
        if (finalSortOrder == null) {
          const last = await prisma.storageLocation.findFirst({
            where: { facilityId },
            orderBy: { sortOrder: 'desc' },
            select: { sortOrder: true },
          });
          finalSortOrder = (last?.sortOrder ?? -1) + 10;
        }

        const location = await prisma.storageLocation.create({
          data: {
            facilityId,
            name,
            description: description ?? null,
            category: category ?? null,
            sortOrder: finalSortOrder,
            isActive: isActive ?? true,
          },
        });

        void auditFromRequest(req, {
          action: 'STORAGE_LOCATION_CREATE',
          targetType: 'StorageLocation',
          targetId: location.id,
          details: { name, category: category ?? null, sortOrder: finalSortOrder },
        });

        res.status(201).json({ id: location.id, success: true });
      } catch (error) {
        if (error instanceof Error && /Unique constraint/i.test(error.message)) {
          return res
            .status(409)
            .json({ error: 'A storage location with that name already exists' });
        }
        log.error(error, { operation: 'createStorageLocation' });
        res.status(500).json({ error: 'Failed to create storage location' });
      }
    },
  );

  // ── Reorder (bulk sortOrder) — MUST be before /:id ─────────────────
  app.post(
    '/api/v1/storage-locations/reorder',
    authMiddleware,
    validateBody(StorageLocationReorderSchema),
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const { order } = req.validBody as {
          order: Array<{ id: string; sortOrder: number }>;
        };

        // Verify every referenced ID belongs to this facility before any write
        const ids = order.map((o) => o.id);
        const owned = await prisma.storageLocation.findMany({
          where: { id: { in: ids }, facilityId },
          select: { id: true },
        });
        if (owned.length !== ids.length) {
          return res
            .status(400)
            .json({ error: 'One or more storage locations do not belong to this facility' });
        }

        for (const entry of order) {
          await prisma.storageLocation.update({
            where: { id: entry.id },
            data: { sortOrder: entry.sortOrder },
          });
        }

        void auditFromRequest(req, {
          action: 'STORAGE_LOCATION_REORDER',
          targetType: 'StorageLocation',
          details: { count: order.length },
        });

        res.json({ success: true, count: order.length });
      } catch (error) {
        log.error(error, { operation: 'reorderStorageLocations' });
        res.status(500).json({ error: 'Failed to reorder storage locations' });
      }
    },
  );

  // ── Update ────────────────────────────────────────────────────────
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

        const body = req.validBody as {
          name?: string;
          description?: string | null;
          category?: string | null;
          sortOrder?: number;
          isActive?: boolean;
        };

        const data: Record<string, unknown> = {};
        if (body.name !== undefined) data.name = body.name;
        if (body.description !== undefined) data.description = body.description;
        if (body.category !== undefined) data.category = body.category;
        if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
        if (body.isActive !== undefined) data.isActive = body.isActive;

        const updated = await prisma.storageLocation.update({
          where: { id: req.params.id },
          data,
        });

        void auditFromRequest(req, {
          action: 'STORAGE_LOCATION_UPDATE',
          targetType: 'StorageLocation',
          targetId: updated.id,
          details: { fieldsChanged: Object.keys(data) },
        });

        res.json({
          id: updated.id,
          name: updated.name,
          description: updated.description,
          category: updated.category,
          sortOrder: updated.sortOrder,
          isActive: updated.isActive,
        });
      } catch (error) {
        if (error instanceof Error && /Unique constraint/i.test(error.message)) {
          return res
            .status(409)
            .json({ error: 'A storage location with that name already exists' });
        }
        log.error(error, { operation: 'updateStorageLocation', id: req.params.id });
        res.status(500).json({ error: 'Failed to update storage location' });
      }
    },
  );

  // ── Delete ────────────────────────────────────────────────────────
  // Refuses if any Items still reference the location. Facility must
  // reassign or clear references first.
  app.delete(
    '/api/v1/storage-locations/:id',
    authMiddleware,
    async (req: Request, res: Response) => {
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
          return res.status(400).json({
            error: `Cannot delete — ${existing._count.items} item${existing._count.items === 1 ? '' : 's'} still reference this location. Reassign them first.`,
            code: 'STORAGE_LOCATION_IN_USE',
            itemCount: existing._count.items,
          });
        }

        await prisma.storageLocation.delete({ where: { id: req.params.id } });

        void auditFromRequest(req, {
          action: 'STORAGE_LOCATION_DELETE',
          targetType: 'StorageLocation',
          targetId: req.params.id,
          details: { name: existing.name },
        });

        res.json({ success: true });
      } catch (error) {
        log.error(error, { operation: 'deleteStorageLocation', id: req.params.id });
        res.status(500).json({ error: 'Failed to delete storage location' });
      }
    },
  );
}
