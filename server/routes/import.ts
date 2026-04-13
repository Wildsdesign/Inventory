/**
 * Vendor file import routes.
 *
 * POST /api/v1/import/preview — Parse file + AI column mapping + duplicate detection
 * POST /api/v1/import/apply   — Write approved rows to database
 *
 * Two-step import flow:
 *   1. Preview: client sends file content + optional vendorId.
 *      Server parses, maps columns, detects duplicates, returns preview.
 *   2. Apply: client sends reviewed rows (each marked create/update/skip).
 *      Server writes to Item, ItemVendor, ImportJob, ImportedItem.
 */

import { Express, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from '../lib/auth';
import { validateBody } from '../middleware/validate';
import { ImportPreviewSchema, ImportApplySchema } from '../lib/validation';
import { parseFile } from '../services/file-parser';
import { mapColumns, fingerprintHeaders } from '../services/ai-column-mapper';
import { detectDuplicates } from '../services/duplicate-detector';
import { auditFromRequest } from '../services/audit-log';
import { log } from '../utils/logger';

export function registerImportRoutes(app: Express) {
  // ── Preview ──────────────────────────────────────────────────────────
  app.post(
    '/api/v1/import/preview',
    authMiddleware,
    validateBody(ImportPreviewSchema),
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const { vendorId, fileContent, fileName } = req.validBody as {
          vendorId?: string;
          fileContent: string;
          fileName: string;
        };

        const { headers, rows } = parseFile(fileContent, fileName);

        if (headers.length === 0 || rows.length === 0) {
          return res.status(400).json({ error: 'File is empty or could not be parsed' });
        }

        if (rows.length > 5000) {
          return res.status(413).json({ error: 'File exceeds 5000 row limit. Split it and retry.' });
        }

        // Check for cached column mapping profile
        const fingerprint = fingerprintHeaders(headers);
        let columnMappings: Record<string, string | null> | null = null;

        if (vendorId) {
          const cached = await prisma.vendorImportProfile.findFirst({
            where: { vendorId, headerFingerprint: fingerprint },
          });
          if (cached) {
            try { columnMappings = JSON.parse(cached.columnMappings) as Record<string, string | null>; } catch { /* ignore */ }
          }
        }

        if (!columnMappings) {
          columnMappings = await mapColumns(headers);

          // Cache the mapping if we have a vendor
          if (vendorId) {
            await prisma.vendorImportProfile.create({
              data: {
                vendorId,
                headerFingerprint: fingerprint,
                columnMappings: JSON.stringify(columnMappings),
              },
            }).catch(() => { /* ignore duplicate */ });
          }
        }

        // Apply column mappings to rows
        const normalizedRows = rows.map((row) => {
          const normalized: Record<string, string> = {};
          for (const [header, value] of Object.entries(row)) {
            const field = columnMappings![header];
            if (field) normalized[field] = value;
          }
          return { rawRow: row, normalized };
        });

        // Filter rows that have at least a name
        const rowsWithName = normalizedRows.filter((r) => r.normalized.name?.trim());

        // Detect duplicates
        const matchResults = await detectDuplicates(
          facilityId,
          vendorId,
          rowsWithName.map((r) => ({
            name: r.normalized.name,
            vendorSku: r.normalized.vendorSku || null,
          })),
        );

        const previewRows = rowsWithName.map((r, idx) => {
          const match = matchResults[idx];
          const cost = r.normalized.unitCost ? parseFloat(r.normalized.unitCost) : null;

          return {
            rowIndex: idx,
            name: r.normalized.name,
            vendorSku: r.normalized.vendorSku || null,
            vendorItemName: r.normalized.vendorItemName || null,
            packSize: r.normalized.packSize || null,
            unitCost: isNaN(cost as number) ? null : cost,
            category: r.normalized.category || null,
            portionUnit: r.normalized.portionUnit || null,
            allergens: r.normalized.allergens
              ? r.normalized.allergens.split(/[,;]/).map((a) => a.trim()).filter(Boolean)
              : [],
            matchType: match.matchType,
            itemId: match.itemId || null,
            itemName: match.itemName || null,
            confidence: match.confidence,
            action: match.matchType === 'new' ? 'create' : 'update',
            rawRow: r.rawRow,
          };
        });

        const skippedRows = normalizedRows.filter((r) => !r.normalized.name?.trim()).length;

        res.json({
          headers,
          columnMappings,
          previewRows,
          totalRows: rows.length,
          rowsWithName: rowsWithName.length,
          skippedRows,
          newCount: previewRows.filter((r) => r.matchType === 'new').length,
          updateCount: previewRows.filter((r) => r.matchType !== 'new').length,
        });
      } catch (error) {
        log.error(error, { operation: 'importPreview' });
        res.status(500).json({ error: 'Import preview failed' });
      }
    },
  );

  // ── Apply ─────────────────────────────────────────────────────────────
  app.post(
    '/api/v1/import/apply',
    authMiddleware,
    validateBody(ImportApplySchema),
    async (req: Request, res: Response) => {
      try {
        const facilityId = req.facilityId!;
        const { vendorId, fileName, rows } = req.validBody as {
          vendorId?: string;
          fileName: string;
          rows: Array<{
            name: string;
            vendorSku?: string | null;
            vendorItemName?: string | null;
            packSize?: string | null;
            unitCost?: number | null;
            category?: string | null;
            portionUnit?: string | null;
            allergens?: string[];
            action: 'create' | 'update' | 'skip';
            itemId?: string;
          }>;
        };

        // Create import job record
        const importJob = await prisma.importJob.create({
          data: {
            facilityId,
            vendorId: vendorId ?? null,
            fileName,
            status: 'processing',
            totalRows: rows.length,
          },
        });

        let importedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (const row of rows) {
          if (row.action === 'skip') {
            skippedCount++;
            await prisma.importedItem.create({
              data: {
                importJobId: importJob.id,
                rawData: JSON.stringify(row),
                matchType: 'new',
                status: 'skipped',
                notes: 'Skipped by user',
              },
            });
            continue;
          }

          try {
            let itemId = row.itemId;

            if (row.action === 'create' || !itemId) {
              // Create new item
              const item = await prisma.item.create({
                data: {
                  facilityId,
                  name: row.name,
                  category: row.category ?? null,
                  portionUnit: row.portionUnit ?? null,
                  itemCost: row.unitCost ?? null,
                },
              });
              itemId = item.id;

              // Create ItemVendor if we have a vendor
              if (vendorId) {
                await prisma.itemVendor.create({
                  data: {
                    itemId,
                    vendorId,
                    vendorSku: row.vendorSku ?? null,
                    vendorItemName: row.vendorItemName ?? null,
                    packSize: row.packSize ?? null,
                    lastCost: row.unitCost ?? null,
                  },
                });
              }
            } else {
              // Update existing item
              await prisma.item.update({
                where: { id: itemId },
                data: {
                  category: row.category ?? undefined,
                  portionUnit: row.portionUnit ?? undefined,
                  itemCost: row.unitCost ?? undefined,
                  updatedAt: new Date(),
                },
              });

              // Upsert ItemVendor
              if (vendorId) {
                await prisma.itemVendor.upsert({
                  where: { itemId_vendorId: { itemId, vendorId } },
                  create: {
                    itemId,
                    vendorId,
                    vendorSku: row.vendorSku ?? null,
                    vendorItemName: row.vendorItemName ?? null,
                    packSize: row.packSize ?? null,
                    lastCost: row.unitCost ?? null,
                  },
                  update: {
                    vendorSku: row.vendorSku ?? undefined,
                    vendorItemName: row.vendorItemName ?? undefined,
                    packSize: row.packSize ?? undefined,
                    lastCost: row.unitCost ?? undefined,
                  },
                });
              }
            }

            await prisma.importedItem.create({
              data: {
                importJobId: importJob.id,
                itemId,
                rawData: JSON.stringify(row),
                matchType: row.action === 'create' ? 'new' : 'name_match',
                status: 'imported',
              },
            });

            importedCount++;
          } catch (rowError) {
            errorCount++;
            log.error(rowError, { operation: 'importApplyRow', name: row.name });
            await prisma.importedItem.create({
              data: {
                importJobId: importJob.id,
                rawData: JSON.stringify(row),
                status: 'error',
                notes: rowError instanceof Error ? rowError.message.slice(0, 490) : 'Unknown error',
              },
            });
          }
        }

        // Update job status
        await prisma.importJob.update({
          where: { id: importJob.id },
          data: {
            status: errorCount > 0 && importedCount === 0 ? 'failed' : 'completed',
            importedCount,
            skippedCount,
            errorCount,
            completedAt: new Date(),
          },
        });

        void auditFromRequest(req, {
          action: 'IMPORT_APPLY',
          targetType: 'ImportJob',
          targetId: importJob.id,
          details: { fileName, importedCount, skippedCount, errorCount },
        });

        res.json({
          success: true,
          importJobId: importJob.id,
          importedCount,
          skippedCount,
          errorCount,
          totalRows: rows.length,
        });
      } catch (error) {
        log.error(error, { operation: 'importApply' });
        res.status(500).json({ error: 'Import apply failed' });
      }
    },
  );
}
