/**
 * Items routes.
 *
 * GET    /api/v1/items              — List all items (facility scoped, filterable)
 * GET    /api/v1/items/low-stock    — Items at or below reorder point
 * GET    /api/v1/items/batch        — Fetch multiple by ID: ?ids=a,b,c
 * POST   /api/v1/items              — Create a new item
 * GET    /api/v1/items/:id          — Single item with nutrition + allergens + vendors
 * PUT    /api/v1/items/:id          — Update item
 * DELETE /api/v1/items/:id          — Delete item
 */

import { Express, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from '../lib/auth';
import { validateBody } from '../middleware/validate';
import { ItemCreateSchema, ItemUpdateSchema } from '../lib/validation';
import { auditFromRequest } from '../services/audit-log';
import { log } from '../utils/logger';

// SQL Server stores JSON as NVARCHAR(MAX)
function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function stringifyJson(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function shapeItem(item: {
  id: string;
  facilityId: string;
  name: string;
  healthTouchItemId: string | null;
  isRecipe: boolean;
  category: string | null;
  portionSize: number | null;
  portionUnit: string | null;
  itemCost: number | null;
  currentQty: number;
  reorderPoint: number | null;
  reorderQty: number | null;
  storageLocationId: string | null;
  storageLocation?: { id: string; name: string } | null;
  syncedAt: Date;
  pushedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  nutrition?: Record<string, unknown> | null;
  allergens?: Array<{
    id: string;
    allergenId: string;
    severity: string;
    source: string;
    allergen: { id: string; name: string; isBigNine: boolean; category: string };
  }>;
  vendors?: Array<{
    id: string;
    vendorId: string;
    vendorSku: string | null;
    vendorItemName: string | null;
    packSize: string | null;
    lastCost: number | null;
    lastReceivedAt: Date | null;
    vendor: { id: string; name: string };
  }>;
}) {
  const n = item.nutrition as Record<string, unknown> | null;
  return {
    id: item.id,
    facilityId: item.facilityId,
    name: item.name,
    healthTouchItemId: item.healthTouchItemId,
    isRecipe: item.isRecipe,
    category: item.category,
    portionSize: item.portionSize,
    portionUnit: item.portionUnit,
    itemCost: item.itemCost,
    currentQty: item.currentQty,
    reorderPoint: item.reorderPoint,
    reorderQty: item.reorderQty,
    isLowStock: item.reorderPoint != null && item.currentQty <= item.reorderPoint,
    storageLocationId: item.storageLocationId,
    storageLocationName: item.storageLocation?.name ?? null,
    syncedAt: item.syncedAt,
    pushedAt: item.pushedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    nutrition: n
      ? {
          servingSize: n.servingSize as number | null,
          servingUnit: n.servingUnit as string | null,
          calories: n.calories as number | null,
          protein: n.protein as number | null,
          totalFat: n.totalFat as number | null,
          saturatedFat: n.saturatedFat as number | null,
          transFat: n.transFat as number | null,
          carbohydrate: n.carbohydrate as number | null,
          fiber: n.fiber as number | null,
          sugar: n.sugar as number | null,
          addedSugar: n.addedSugar as number | null,
          cholesterol: n.cholesterol as number | null,
          sodium: n.sodium as number | null,
          potassium: n.potassium as number | null,
          calcium: n.calcium as number | null,
          iron: n.iron as number | null,
          phosphorus: n.phosphorus as number | null,
          vitaminD: n.vitaminD as number | null,
          rawNutrients: parseJson(n.rawNutrients as string | null),
          ingredients: n.ingredients as string | null,
          source: n.source as string | null,
          usdaFdcId: n.usdaFdcId as string | null,
          lastEnrichedAt: n.lastEnrichedAt as Date | null,
        }
      : null,
    allergens: (item.allergens ?? []).map((ia) => ({
      id: ia.id,
      allergenId: ia.allergenId,
      allergenName: ia.allergen.name,
      isBigNine: ia.allergen.isBigNine,
      category: ia.allergen.category,
      severity: ia.severity,
      source: ia.source,
    })),
    vendors: (item.vendors ?? []).map((iv) => ({
      id: iv.id,
      vendorId: iv.vendorId,
      vendorName: iv.vendor.name,
      vendorSku: iv.vendorSku,
      vendorItemName: iv.vendorItemName,
      packSize: iv.packSize,
      lastCost: iv.lastCost,
      lastReceivedAt: iv.lastReceivedAt,
    })),
  };
}

const ITEM_INCLUDE = {
  nutrition: true,
  storageLocation: { select: { id: true, name: true } },
  allergens: { include: { allergen: true } },
  vendors: { include: { vendor: { select: { id: true, name: true } } } },
};

export function registerItemsRoutes(app: Express) {
  // ── List items ─────────────────────────────────────────────────────────
  app.get('/api/v1/items', authMiddleware, async (req: Request, res: Response) => {
    try {
      const facilityId = req.facilityId!;
      const { search, category, hasNutrition, hasAllergens, storageLocationId } = req.query;

      const where: Record<string, unknown> = { facilityId };

      if (search && typeof search === 'string' && search.trim()) {
        where.name = { contains: search.trim() };
      }
      if (category && typeof category === 'string') {
        where.category = category;
      }
      if (storageLocationId && typeof storageLocationId === 'string') {
        where.storageLocationId = storageLocationId;
      }

      const items = await prisma.item.findMany({
        where,
        include: ITEM_INCLUDE,
        orderBy: { name: 'asc' },
      });

      let shaped = items.map(shapeItem);

      if (hasNutrition === 'true') shaped = shaped.filter((i) => i.nutrition !== null);
      else if (hasNutrition === 'false') shaped = shaped.filter((i) => i.nutrition === null);

      if (hasAllergens === 'true') shaped = shaped.filter((i) => i.allergens.length > 0);
      else if (hasAllergens === 'false') shaped = shaped.filter((i) => i.allergens.length === 0);

      res.json({ items: shaped, count: shaped.length });
    } catch (error) {
      log.error(error, { operation: 'listItems' });
      res.status(500).json({ error: 'Failed to list items' });
    }
  });

  // ── Low stock — MUST be before /:id ───────────────────────────────────
  app.get('/api/v1/items/low-stock', authMiddleware, async (req: Request, res: Response) => {
    try {
      const facilityId = req.facilityId!;

      // Items where currentQty <= reorderPoint and reorderPoint is set
      const items = await prisma.item.findMany({
        where: {
          facilityId,
          reorderPoint: { not: null },
        },
        include: ITEM_INCLUDE,
        orderBy: { name: 'asc' },
      });

      const lowStock = items
        .map(shapeItem)
        .filter((i) => i.reorderPoint != null && i.currentQty <= i.reorderPoint);

      res.json({ items: lowStock, count: lowStock.length });
    } catch (error) {
      log.error(error, { operation: 'lowStockItems' });
      res.status(500).json({ error: 'Failed to fetch low stock items' });
    }
  });

  // ── Batch fetch — MUST be before /:id ─────────────────────────────────
  app.get('/api/v1/items/batch', authMiddleware, async (req: Request, res: Response) => {
    try {
      const facilityId = req.facilityId!;
      const idsParam = req.query.ids;

      if (!idsParam || typeof idsParam !== 'string') {
        return res.status(400).json({ error: 'ids query param is required' });
      }

      const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);

      if (ids.length === 0 || ids.length > 500) {
        return res.status(400).json({ error: 'ids must be between 1 and 500' });
      }

      const items = await prisma.item.findMany({
        where: { facilityId, id: { in: ids } },
        include: ITEM_INCLUDE,
        orderBy: { name: 'asc' },
      });

      res.json({ items: items.map(shapeItem), count: items.length });
    } catch (error) {
      log.error(error, { operation: 'batchItems' });
      res.status(500).json({ error: 'Failed to batch fetch items' });
    }
  });

  // ── Create item ────────────────────────────────────────────────────────
  app.post(
    '/api/v1/items',
    authMiddleware,
    validateBody(ItemCreateSchema),
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const data = req.validBody as {
          name: string;
          category?: string | null;
          portionSize?: number | null;
          portionUnit?: string | null;
          storageLocationId?: string | null;
          reorderPoint?: number | null;
          reorderQty?: number | null;
          healthTouchItemId?: string | null;
          currentQty?: number;
          itemCost?: number | null;
          primaryVendorId?: string | null;
          nutrition?: Record<string, unknown>;
          allergens?: Array<{ allergenId: string; severity?: string; source?: string }>;
        };

        const created = await prisma.item.create({
          data: {
            facilityId,
            name: data.name,
            category: data.category ?? null,
            portionSize: data.portionSize ?? null,
            portionUnit: data.portionUnit ?? null,
            storageLocationId: data.storageLocationId ?? null,
            reorderPoint: data.reorderPoint ?? null,
            reorderQty: data.reorderQty ?? null,
            healthTouchItemId: data.healthTouchItemId ?? null,
            currentQty: data.currentQty ?? 0,
            itemCost: data.itemCost ?? null,
          },
        });

        // Nutrition (optional on create — no existing nutrition to merge)
        if (data.nutrition && typeof data.nutrition === 'object') {
          const NUTRITION_NUMERIC = [
            'servingSize', 'calories', 'protein', 'totalFat', 'saturatedFat', 'transFat',
            'carbohydrate', 'fiber', 'sugar', 'addedSugar', 'cholesterol', 'sodium',
            'potassium', 'calcium', 'iron', 'phosphorus', 'vitaminD',
          ] as const;

          const fields: Record<string, unknown> = {};
          for (const key of NUTRITION_NUMERIC) {
            if (key in data.nutrition) fields[key] = data.nutrition[key] ?? null;
          }
          if ('servingUnit' in data.nutrition) fields.servingUnit = data.nutrition.servingUnit || null;
          if ('ingredients' in data.nutrition) fields.ingredients = data.nutrition.ingredients || null;
          if ('rawNutrients' in data.nutrition) fields.rawNutrients = stringifyJson(data.nutrition.rawNutrients);
          fields.source = 'manual';

          // Only upsert if at least one value was supplied (avoids empty rows)
          if (Object.keys(fields).some((k) => k !== 'source' && fields[k] != null)) {
            await prisma.itemNutrition.create({
              data: { itemId: created.id, ...fields },
            });
          }
        }

        // Allergens
        if (Array.isArray(data.allergens) && data.allergens.length > 0) {
          await prisma.itemAllergen.createMany({
            data: data.allergens.map((a) => ({
              itemId: created.id,
              allergenId: a.allergenId,
              severity: a.severity || 'CONTAINS',
              source: a.source || 'MANUAL',
            })),
          });
        }

        // Primary vendor link
        if (data.primaryVendorId) {
          const vendor = await prisma.vendor.findFirst({
            where: { id: data.primaryVendorId, facilityId },
          });
          if (vendor) {
            await prisma.itemVendor.create({
              data: { itemId: created.id, vendorId: vendor.id },
            });
          }
        }

        const item = await prisma.item.findFirst({
          where: { id: created.id, facilityId },
          include: ITEM_INCLUDE,
        });

        void auditFromRequest(req, { action: 'ITEM_CREATE', targetType: 'Item', targetId: created.id, details: { name: created.name } });
        res.status(201).json(shapeItem(item!));
      } catch (error) {
        log.error(error, { operation: 'createItem' });
        res.status(500).json({ error: 'Failed to create item' });
      }
    },
  );

  // ── Get single item ────────────────────────────────────────────────────
  app.get('/api/v1/items/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
      const facilityId = req.facilityId!;
      const item = await prisma.item.findFirst({
        where: { id: req.params.id, facilityId },
        include: ITEM_INCLUDE,
      });

      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }

      res.json(shapeItem(item));
    } catch (error) {
      log.error(error, { operation: 'getItem', id: req.params.id });
      res.status(500).json({ error: 'Failed to fetch item' });
    }
  });

  // ── Update item ────────────────────────────────────────────────────────
  app.put(
    '/api/v1/items/:id',
    authMiddleware,
    validateBody(ItemUpdateSchema),
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const {
          name,
          category,
          portionSize,
          portionUnit,
          storageLocationId,
          reorderPoint,
          reorderQty,
          healthTouchItemId,
          primaryVendorId,
          nutrition,
          allergens,
        } = req.validBody as {
          name?: string;
          category?: string | null;
          portionSize?: number | null;
          portionUnit?: string | null;
          storageLocationId?: string | null;
          reorderPoint?: number | null;
          reorderQty?: number | null;
          healthTouchItemId?: string | null;
          primaryVendorId?: string | null;
          nutrition?: Record<string, unknown>;
          allergens?: Array<{ allergenId: string; severity?: string; source?: string }>;
        };

        const existing = await prisma.item.findFirst({
          where: { id: req.params.id, facilityId },
          include: { nutrition: true },
        });

        if (!existing) {
          return res.status(404).json({ error: 'Item not found' });
        }

        const itemUpdate: Record<string, unknown> = {};
        if (name !== undefined) itemUpdate.name = name;
        if (category !== undefined) itemUpdate.category = category;
        if (portionSize !== undefined) itemUpdate.portionSize = portionSize;
        if (portionUnit !== undefined) itemUpdate.portionUnit = portionUnit;
        if (storageLocationId !== undefined) itemUpdate.storageLocationId = storageLocationId;
        if (reorderPoint !== undefined) itemUpdate.reorderPoint = reorderPoint;
        if (reorderQty !== undefined) itemUpdate.reorderQty = reorderQty;
        if (healthTouchItemId !== undefined) itemUpdate.healthTouchItemId = healthTouchItemId;

        if (Object.keys(itemUpdate).length > 0) {
          await prisma.item.update({ where: { id: req.params.id }, data: itemUpdate });
        }

        if (nutrition && typeof nutrition === 'object') {
          const NUTRITION_NUMERIC = [
            'servingSize', 'calories', 'protein', 'totalFat', 'saturatedFat', 'transFat',
            'carbohydrate', 'fiber', 'sugar', 'addedSugar', 'cholesterol', 'sodium',
            'potassium', 'calcium', 'iron', 'phosphorus', 'vitaminD',
          ] as const;

          const fields: Record<string, unknown> = {};
          for (const key of NUTRITION_NUMERIC) {
            if (key in nutrition) fields[key] = nutrition[key] ?? null;
          }
          if ('servingUnit' in nutrition) fields.servingUnit = nutrition.servingUnit || null;
          if ('ingredients' in nutrition) fields.ingredients = nutrition.ingredients || null;
          if ('rawNutrients' in nutrition) fields.rawNutrients = stringifyJson(nutrition.rawNutrients);

          const existingSource = existing.nutrition?.source;
          if (existingSource === 'usda') {
            fields.source = 'manual_modified';
          } else if (!existing.nutrition) {
            fields.source = 'manual';
          }

          await prisma.itemNutrition.upsert({
            where: { itemId: req.params.id },
            create: { itemId: req.params.id, ...fields },
            update: fields,
          });
        }

        if (Array.isArray(allergens)) {
          await prisma.itemAllergen.deleteMany({ where: { itemId: req.params.id } });
          if (allergens.length > 0) {
            await prisma.itemAllergen.createMany({
              data: allergens.map((a) => ({
                itemId: req.params.id,
                allergenId: a.allergenId,
                severity: a.severity || 'CONTAINS',
                source: a.source || 'MANUAL',
              })),
            });
          }
        }

        // Primary vendor — ensure an ItemVendor row exists linking to the
        // selected vendor. We don't purge existing links: the full vendor
        // management surface lives on the Vendors page, so here we only
        // add a link when one is missing.
        if (primaryVendorId) {
          const vendor = await prisma.vendor.findFirst({
            where: { id: primaryVendorId, facilityId },
          });
          if (vendor) {
            await prisma.itemVendor.upsert({
              where: {
                itemId_vendorId: { itemId: req.params.id, vendorId: vendor.id },
              },
              create: { itemId: req.params.id, vendorId: vendor.id },
              update: {},
            });
          }
        }

        await prisma.item.update({ where: { id: req.params.id }, data: { updatedAt: new Date() } });

        const refreshed = await prisma.item.findFirst({
          where: { id: req.params.id, facilityId },
          include: ITEM_INCLUDE,
        });

        void auditFromRequest(req, {
          action: 'ITEM_UPDATE',
          targetType: 'Item',
          targetId: req.params.id,
          details: { name: refreshed?.name, fieldsChanged: Object.keys(itemUpdate) },
        });

        res.json(shapeItem(refreshed!));
      } catch (error) {
        log.error(error, { operation: 'updateItem', id: req.params.id });
        res.status(500).json({ error: 'Failed to update item' });
      }
    },
  );

  // ── Delete item ────────────────────────────────────────────────────────
  app.delete('/api/v1/items/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
      const facilityId = req.facilityId!;
      const existing = await prisma.item.findFirst({ where: { id: req.params.id, facilityId } });

      if (!existing) {
        return res.status(404).json({ error: 'Item not found' });
      }

      await prisma.item.delete({ where: { id: req.params.id } });

      void auditFromRequest(req, { action: 'ITEM_DELETE', targetType: 'Item', targetId: req.params.id, details: { name: existing.name } });
      res.json({ success: true });
    } catch (error) {
      log.error(error, { operation: 'deleteItem', id: req.params.id });
      res.status(500).json({ error: 'Failed to delete item' });
    }
  });
}
