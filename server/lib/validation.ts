/**
 * Zod schemas for all request body validation.
 */

import { z } from 'zod';

// ── Primitives ──────────────────────────────────────────────────────────
const idString = z.string().min(1).max(64);
const shortString = z.string().min(1).max(200);
const longString = z.string().max(10_000);
const nullableShort = shortString.nullable().optional();
const nullableLong = longString.nullable().optional();
const nullableNumber = z.number().finite().nullable().optional();
const nonNegativeNumber = z.number().finite().nonnegative();

// ── Auth ─────────────────────────────────────────────────────────────────

export const LoginSchema = z.object({
  pin: z
    .string()
    .min(1, 'PIN is required')
    .max(32, 'PIN too long')
    .regex(/^[0-9]+$/, 'PIN must be numeric'),
});

// ── Items ────────────────────────────────────────────────────────────────

const nutritionInput = z
  .object({
    servingSize: nullableNumber,
    servingUnit: nullableShort,
    calories: nullableNumber,
    protein: nullableNumber,
    totalFat: nullableNumber,
    saturatedFat: nullableNumber,
    transFat: nullableNumber,
    carbohydrate: nullableNumber,
    fiber: nullableNumber,
    sugar: nullableNumber,
    addedSugar: nullableNumber,
    cholesterol: nullableNumber,
    sodium: nullableNumber,
    potassium: nullableNumber,
    calcium: nullableNumber,
    iron: nullableNumber,
    phosphorus: nullableNumber,
    vitaminD: nullableNumber,
    ingredients: nullableLong,
    rawNutrients: z.unknown().optional(),
  })
  .partial()
  .strict();

const allergenInput = z.object({
  allergenId: idString,
  severity: z.enum(['CONTAINS', 'MAY_CONTAIN']).optional(),
  source: z.enum(['USDA_VERIFIED', 'AI_SUGGESTED', 'MANUAL', 'ROLLUP']).optional(),
});

export const ItemCreateSchema = z
  .object({
    name: shortString,
    category: nullableShort,
    portionSize: z.number().finite().nonnegative().nullable().optional(),
    portionUnit: nullableShort,
    storageLocationId: idString.nullable().optional(),
    reorderPoint: z.number().finite().nonnegative().nullable().optional(),
    reorderQty: z.number().finite().nonnegative().nullable().optional(),
    healthTouchItemId: nullableShort,
    currentQty: z.number().finite().nonnegative().optional(),
    itemCost: z.number().finite().nonnegative().nullable().optional(),
    primaryVendorId: idString.nullable().optional(),
    nutrition: nutritionInput.optional(),
    allergens: z.array(allergenInput).max(200).optional(),
  })
  .strict();

export const ItemUpdateSchema = z
  .object({
    name: shortString.optional(),
    category: nullableShort,
    portionSize: z.number().finite().nonnegative().nullable().optional(),
    portionUnit: nullableShort,
    storageLocationId: idString.nullable().optional(),
    reorderPoint: z.number().finite().nonnegative().nullable().optional(),
    reorderQty: z.number().finite().nonnegative().nullable().optional(),
    healthTouchItemId: nullableShort,
    primaryVendorId: idString.nullable().optional(),
    nutrition: nutritionInput.optional(),
    allergens: z.array(allergenInput).max(200).optional(),
  })
  .strict();

// ── Storage Locations ─────────────────────────────────────────────────────

const storageCategory = z
  .enum(['dry', 'refrigerated', 'frozen', 'production', 'receiving', 'specialty'])
  .nullable()
  .optional();

export const StorageLocationCreateSchema = z
  .object({
    name: shortString,
    description: z.string().max(500).nullable().optional(),
    category: storageCategory,
    sortOrder: z.number().int().nonnegative().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const StorageLocationUpdateSchema = StorageLocationCreateSchema.partial().strict();

export const StorageLocationReorderSchema = z
  .object({
    order: z
      .array(
        z.object({
          id: idString,
          sortOrder: z.number().int().nonnegative(),
        }),
      )
      .max(200),
  })
  .strict();

// ── Allergens ─────────────────────────────────────────────────────────────

export const AllergenCreateSchema = z
  .object({
    name: shortString,
    severity: nullableShort,
    isBigNine: z.boolean().optional(),
    keywords: z.array(z.string()).nullable().optional(),
    aiHint: z.string().max(500).nullable().optional(),
    category: z.enum(['ALLERGEN', 'DRUG_INTERACTION']).optional(),
  })
  .strict();

export const AllergenUpdateSchema = AllergenCreateSchema.partial().strict();

// ── USDA ─────────────────────────────────────────────────────────────────

export const UsdaApplySchema = z
  .object({
    fdcId: z.number().int().positive(),
    overwrite: z.boolean().optional().default(false),
  })
  .strict();

// ── Vendors ───────────────────────────────────────────────────────────────

export const VendorCreateSchema = z
  .object({
    name: shortString,
    contactName: nullableShort,
    contactEmail: z.string().email().nullable().optional(),
    contactPhone: nullableShort,
    notes: nullableLong,
    isActive: z.boolean().optional(),
  })
  .strict();

export const VendorUpdateSchema = VendorCreateSchema.partial().strict();

// ── Receiving ─────────────────────────────────────────────────────────────

export const ReceiveItemSchema = z
  .object({
    quantity: z.number().finite().positive(),
    unitCost: z.number().finite().nonnegative(),
    vendorId: idString.optional(),
    reference: nullableShort,
  })
  .strict();

// ── Adjust / Transaction ──────────────────────────────────────────────────

export const AdjustItemSchema = z
  .object({
    quantity: z.number().finite(),  // negative = remove stock
    type: z.enum(['waste', 'adjustment']).optional().default('adjustment'),
    reference: nullableShort,
  })
  .strict();

// ── Import ────────────────────────────────────────────────────────────────

export const ImportPreviewSchema = z
  .object({
    vendorId: idString.optional(),
    fileContent: z.string().min(1).max(50 * 1024 * 1024, 'File too large'),
    fileName: shortString,
  })
  .strict();

export const ImportApplySchema = z
  .object({
    vendorId: idString.optional(),
    fileName: shortString,
    rows: z.array(
      z.object({
        name: shortString,
        vendorSku: nullableShort,
        vendorItemName: nullableShort,
        packSize: nullableShort,
        unitCost: z.number().finite().nonnegative().nullable().optional(),
        costPerBaseUnit: z.number().finite().nonnegative().nullable().optional(),
        category: nullableShort,
        portionUnit: nullableShort,
        allergens: z.array(z.string()).optional(),
        action: z.enum(['create', 'update', 'skip']),
        itemId: idString.optional(),
      }),
    ).max(5000),
  })
  .strict();

// ── AI Allergen Detect ────────────────────────────────────────────────────

export const AllergenDetectBatchSchema = z
  .object({
    itemIds: z.array(idString).min(1).max(50),
  })
  .strict();

// ── UOM Conversions ───────────────────────────────────────────────────────

export const UOMConversionSchema = z
  .object({
    fromUnit: shortString,
    toBaseUnits: nonNegativeNumber,
  })
  .strict();

export type { z };
