/**
 * Receiving + Transactions routes.
 *
 * POST /api/v1/items/:id/receive   — Receive stock (creates ItemLayer + ItemTransaction, updates qty + avgCost)
 * POST /api/v1/items/:id/adjust    — Waste or adjustment (creates ItemTransaction, updates qty)
 * GET  /api/v1/items/:id/history   — Transaction history for an item
 */

import { Express, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from '../lib/auth';
import { validateBody } from '../middleware/validate';
import { ReceiveItemSchema, AdjustItemSchema } from '../lib/validation';
import { auditFromRequest } from '../services/audit-log';
import { log } from '../utils/logger';

/**
 * Recalculate weighted average cost from all active (non-depleted) layers.
 * Returns the new average cost, or null if no layers with cost.
 */
function calcAverageCost(
  layers: Array<{ quantity: number; unitCost: number; depleted: boolean }>,
): number | null {
  const active = layers.filter((l) => !l.depleted && l.quantity > 0);
  if (active.length === 0) return null;

  const totalValue = active.reduce((sum, l) => sum + l.quantity * l.unitCost, 0);
  const totalQty = active.reduce((sum, l) => sum + l.quantity, 0);

  return totalQty > 0 ? Math.round((totalValue / totalQty) * 10000) / 10000 : null;
}

export function registerReceivingRoutes(app: Express) {
  // ── Receive ───────────────────────────────────────────────────────────
  app.post(
    '/api/v1/items/:id/receive',
    authMiddleware,
    validateBody(ReceiveItemSchema),
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const { quantity, unitCost, vendorId, reference } = req.validBody as {
          quantity: number;
          unitCost: number;
          vendorId?: string;
          reference?: string | null;
        };

        const item = await prisma.item.findFirst({
          where: { id: req.params.id, facilityId },
          include: { layers: { where: { depleted: false } } },
        });

        if (!item) return res.status(404).json({ error: 'Item not found' });

        // Create cost layer
        const layer = await prisma.itemLayer.create({
          data: {
            itemId: item.id,
            quantity,
            originalQty: quantity,
            unitCost,
            sourceType: 'PURCHASE',
          },
        });

        // Create transaction record
        await prisma.itemTransaction.create({
          data: {
            itemId: item.id,
            type: 'received',
            quantity,
            unitCost,
            reference: reference ?? null,
            performedById: req.user?.userId ?? null,
          },
        });

        // Recalculate quantity and average cost
        const allActiveLayers = [
          ...item.layers.map((l) => ({ quantity: l.quantity, unitCost: l.unitCost, depleted: l.depleted })),
          { quantity, unitCost, depleted: false },
        ];

        const newQty = item.currentQty + quantity;
        const newAvgCost = calcAverageCost(allActiveLayers);

        await prisma.item.update({
          where: { id: item.id },
          data: {
            currentQty: newQty,
            itemCost: newAvgCost,
            updatedAt: new Date(),
          },
        });

        // Update ItemVendor lastCost and lastReceivedAt if vendorId provided
        if (vendorId) {
          await prisma.itemVendor.upsert({
            where: { itemId_vendorId: { itemId: item.id, vendorId } },
            create: { itemId: item.id, vendorId, lastCost: unitCost, lastReceivedAt: new Date() },
            update: { lastCost: unitCost, lastReceivedAt: new Date() },
          });
        }

        void auditFromRequest(req, {
          action: 'ITEM_RECEIVE',
          targetType: 'Receiving',
          targetId: item.id,
          details: { quantity, unitCost, vendorId, reference, layerId: layer.id, newQty, newAvgCost },
        });

        res.json({
          success: true,
          itemId: item.id,
          layerId: layer.id,
          receivedQty: quantity,
          newCurrentQty: newQty,
          newAverageCost: newAvgCost,
        });
      } catch (error) {
        log.error(error, { operation: 'receiveItem', id: req.params.id });
        res.status(500).json({ error: 'Failed to receive item' });
      }
    },
  );

  // ── Adjust / Waste ─────────────────────────────────────────────────────
  app.post(
    '/api/v1/items/:id/adjust',
    authMiddleware,
    validateBody(AdjustItemSchema),
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const { quantity, type, reference } = req.validBody as {
          quantity: number;
          type: 'waste' | 'adjustment';
          reference?: string | null;
        };

        const item = await prisma.item.findFirst({
          where: { id: req.params.id, facilityId },
        });

        if (!item) return res.status(404).json({ error: 'Item not found' });

        // quantity can be negative (remove stock) or positive (add stock for adjustments)
        const newQty = Math.max(0, item.currentQty + quantity);

        await prisma.itemTransaction.create({
          data: {
            itemId: item.id,
            type,
            quantity,
            unitCost: item.itemCost ?? null,
            reference: reference ?? null,
            performedById: req.user?.userId ?? null,
          },
        });

        await prisma.item.update({
          where: { id: item.id },
          data: { currentQty: newQty, updatedAt: new Date() },
        });

        void auditFromRequest(req, {
          action: type === 'waste' ? 'ITEM_WASTE' : 'ITEM_ADJUST',
          targetType: 'Transaction',
          targetId: item.id,
          details: { quantity, type, reference, previousQty: item.currentQty, newQty },
        });

        res.json({
          success: true,
          itemId: item.id,
          adjustment: quantity,
          previousQty: item.currentQty,
          newCurrentQty: newQty,
        });
      } catch (error) {
        log.error(error, { operation: 'adjustItem', id: req.params.id });
        res.status(500).json({ error: 'Failed to adjust item' });
      }
    },
  );

  // ── Transaction history ───────────────────────────────────────────────
  app.get('/api/v1/items/:id/history', authMiddleware, async (req: Request, res: Response) => {
    try {
      const facilityId = req.facilityId!;
      const item = await prisma.item.findFirst({ where: { id: req.params.id, facilityId } });

      if (!item) return res.status(404).json({ error: 'Item not found' });

      const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 500);

      const transactions = await prisma.itemTransaction.findMany({
        where: { itemId: item.id },
        orderBy: { transactionDate: 'desc' },
        take: limit,
        include: {
          performedBy: { select: { id: true, name: true } },
        },
      });

      res.json({
        itemId: item.id,
        transactions: transactions.map((t) => ({
          id: t.id,
          type: t.type,
          quantity: t.quantity,
          unitCost: t.unitCost,
          reference: t.reference,
          performedBy: t.performedBy ? { id: t.performedBy.id, name: t.performedBy.name } : null,
          transactionDate: t.transactionDate,
        })),
        count: transactions.length,
      });
    } catch (error) {
      log.error(error, { operation: 'itemHistory', id: req.params.id });
      res.status(500).json({ error: 'Failed to fetch item history' });
    }
  });
}
