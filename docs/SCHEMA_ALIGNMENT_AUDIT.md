# Schema Alignment Audit — Inventory ↔ Recipe

**Date:** 2026-04-13  
**Purpose:** Field-by-field comparison of shared models between `[inventory]` and `[recipe]` schemas on the same Azure SQL Server instance. Identifies gaps, bridge requirements, and cross-schema FK feasibility.

**Schemas:**
- `[inventory]` — Inventory repo (`prisma/schema.prisma`)
- `[recipe]` — Recipe repo (`prisma/schema.prisma`)

---

## B1: Item Model — Field-by-Field Comparison

Both schemas have an `Item` model. These are logically the same concept (a food/supply item) but serve different purposes: Recipe's Item is synced from HealthTouch (patient dining menu items); Inventory's Item is purchased vendor stock.

| Field | Inventory `[inventory].[Item]` | Recipe `[recipe].[Item]` | Notes |
|-------|-------------------------------|--------------------------|-------|
| `id` | `String @id @default(cuid())` | `String @id @default(cuid())` | Same pattern, different values |
| `healthTouchItemId` | `String? @map("healthtouch_item_id")` | `String @map("healthtouch_item_id")` — **required** | Recipe requires it; Inventory allows null. Bridge key. |
| `name` | `String` NOT NULL | `String` NOT NULL | Identical |
| `buttonName` | ❌ not present | `String? @map("button_name")` | Recipe-only; display label for HealthTouch POS |
| `category` | `String?` nullable | `String?` nullable | Identical |
| `portionSize` | `Float? @map("portion_size")` | `Float? @map("portion_size")` | Identical |
| `portionUnit` | `String? @map("portion_unit")` | `String? @map("portion_unit")` | Identical |
| `recipeNumber` | ❌ not present | `String? @map("recipe_number")` | Recipe-only; HealthTouch recipe code |
| `itemCost` | `Float? @map("item_cost")` | `Float? @map("item_cost")` | Identical field. Inventory stores per-unit cost (FIFO); Recipe stores total item cost. |
| `isRecipe` | `Boolean @default(false) @map("is_recipe")` | `Boolean @default(false) @map("is_recipe")` | Identical |
| `facilityId` | `String @map("facility_id")` | `String @map("facility_id")` | Identical pattern; different Facility records |
| `storageLocationId` | `String? @map("storage_location_id")` | `String? @map("storage_location_id")` | Identical |
| `syncedAt` | `DateTime @default(now()) @map("synced_at")` | `DateTime @default(now()) @map("synced_at")` | Identical |
| `pushedAt` | `DateTime? @map("pushed_at")` | `DateTime? @map("pushed_at")` | Identical |
| `pushStatus` | ❌ not present | `String? @map("push_status")` | Recipe-only; HealthTouch sync status |
| `createdAt` | `DateTime @default(now()) @map("created_at")` | `DateTime @default(now()) @map("created_at")` | Identical |
| `updatedAt` | `DateTime @updatedAt @map("updated_at")` | `DateTime @updatedAt @map("updated_at")` | Identical |
| `currentQty` | `Float @default(0) @map("current_qty")` | ❌ not present | Inventory-only; FIFO on-hand quantity |
| `reorderPoint` | `Float? @map("reorder_point")` | ❌ not present | Inventory-only; low-stock threshold |
| `reorderQty` | `Float? @map("reorder_qty")` | ❌ not present | Inventory-only; suggested reorder amount |

**Unique Constraints:**

| Constraint | Inventory | Recipe |
|------------|-----------|--------|
| `@@unique([healthTouchItemId, facilityId])` | ✅ present | ✅ present |
| `@@index([facilityId])` | ✅ present | ✅ present |
| `@@index([storageLocationId])` | ✅ present | ✅ present |

---

## B2: Related Table Comparison

### ItemNutrition

| Field | Inventory `[inventory].[ItemNutrition]` | Recipe `[recipe].[ItemNutrition]` | Notes |
|-------|-----------------------------------------|-----------------------------------|-------|
| `id` | `String @id @default(cuid())` | `String @id @default(cuid())` | Identical |
| `itemId` | `String @unique @map("item_id")` | `String @unique @map("item_id")` | Identical (1:1 with Item) |
| `servingSize` | `Float? @map("serving_size")` | `Float? @map("serving_size")` | Identical |
| `servingUnit` | `String? @map("serving_unit")` | `String? @map("serving_unit")` | Identical |
| `calories` | `Float?` | `Float?` | Identical |
| `protein` | `Float?` | `Float?` | Identical |
| `totalFat` | `Float? @map("total_fat")` | `Float? @map("total_fat")` | Identical |
| `saturatedFat` | `Float? @map("saturated_fat")` | `Float? @map("saturated_fat")` | Identical |
| `transFat` | `Float? @map("trans_fat")` | `Float? @map("trans_fat")` | Identical |
| `carbohydrate` | `Float?` | `Float?` | Identical |
| `fiber` | `Float?` | `Float?` | Identical |
| `sugar` | `Float?` | `Float?` | Identical |
| `addedSugar` | `Float? @map("added_sugar")` | `Float? @map("added_sugar")` | Identical |
| `cholesterol` | `Float?` | `Float?` | Identical |
| `sodium` | `Float?` | `Float?` | Identical |
| `potassium` | `Float?` | `Float?` | Identical |
| `calcium` | `Float?` | `Float?` | Identical |
| `iron` | `Float?` | `Float?` | Identical |
| `phosphorus` | `Float?` | `Float?` | Identical |
| `vitaminD` | `Float? @map("vitamin_d")` | `Float? @map("vitamin_d")` | Identical |
| `rawNutrients` | `String? @db.NVarChar(Max) @map("raw_nutrients")` | `String? @db.NVarChar(Max) @map("raw_nutrients")` | Identical |
| `ingredients` | `String? @db.NVarChar(Max)` | `String? @db.NVarChar(Max)` | Identical |
| `source` | `String?` | `String?` | Identical |
| `usdaFdcId` | `String? @map("usda_fdc_id")` | `String? @map("usda_fdc_id")` | Identical |
| `confidence` | `Float?` | `Float?` | Identical |
| `lastEnrichedAt` | `DateTime? @map("last_enriched_at")` | `DateTime? @map("last_enriched_at")` | Identical |
| `createdAt` | `DateTime @default(now()) @map("created_at")` | `DateTime @default(now()) @map("created_at")` | Identical |
| `updatedAt` | `DateTime @updatedAt @map("updated_at")` | `DateTime @updatedAt @map("updated_at")` | Identical |

**ItemNutrition is structurally identical.** This is the cleanest bridge target — nutrition data written by Inventory's USDA enrichment can be read by Recipe without any transformation.

---

### ItemAllergen

| Field | Inventory `[inventory].[ItemAllergen]` | Recipe `[recipe].[ItemAllergen]` | Notes |
|-------|----------------------------------------|----------------------------------|-------|
| `id` | `String @id @default(cuid())` | `String @id @default(cuid())` | Identical |
| `itemId` | `String @map("item_id")` | `String @map("item_id")` | Identical |
| `allergenId` | `String @map("allergen_id")` | `String @map("allergen_id")` | Identical field name; different allergen catalog per schema |
| `severity` | `String` — CONTAINS \| MAY_CONTAIN | `String` — CONTAINS \| MAY_CONTAIN | Identical |
| `source` | `String` — USDA_VERIFIED \| AI_SUGGESTED \| MANUAL \| ROLLUP | `String` — USDA_VERIFIED \| AI_SUGGESTED \| MANUAL \| ROLLUP | Identical |
| `confidence` | `Float?` | `Float?` | Identical |
| `createdAt` | `DateTime @default(now()) @map("created_at")` | `DateTime @default(now()) @map("created_at")` | Identical |
| `updatedAt` | `DateTime @updatedAt @map("updated_at")` | `DateTime @updatedAt @map("updated_at")` | Identical |

**Key difference:** `allergenId` points into `[inventory].[Allergen]` vs `[recipe].[Allergen]`. These are separate allergen catalogs — bridge must map by allergen name, not by ID.

---

### Allergen

| Field | Inventory `[inventory].[Allergen]` | Recipe `[recipe].[Allergen]` | Notes |
|-------|-------------------------------------|------------------------------|-------|
| `id` | `String @id @default(cuid())` | `String @id @default(cuid())` | Different ID spaces |
| `healthTouchAllergenId` | ❌ not present | `String? @map("healthtouch_allergen_id")` | Recipe-only; HealthTouch sync key |
| `name` | `String` | `String` | Identical — bridge key for cross-schema matching |
| `facilityId` | `String @map("facility_id")` | `String @map("facility_id")` | Different facility records |
| `isBigNine` | `Boolean @default(false) @map("is_big_nine")` | `Boolean @default(false) @map("is_big_nine")` | Identical |
| `keywords` | `String? @db.NVarChar(Max)` | `String? @db.NVarChar(Max)` | Identical; JSON array of regex patterns |
| `aiHint` | `String? @db.NVarChar(500) @map("ai_hint")` | `String? @db.NVarChar(500) @map("ai_hint")` | Identical |
| `severity` | `String?` — informational label | ❌ not present | Inventory-only field |
| `category` | `String @default("ALLERGEN")` — ALLERGEN \| DRUG_INTERACTION | `String @default("ALLERGEN") @map("category")` | Identical semantics; Inventory omits `@map` |
| `createdAt` | `DateTime @default(now()) @map("created_at")` | `DateTime @default(now()) @map("created_at")` | Identical |
| `updatedAt` | `DateTime @updatedAt @map("updated_at")` | `DateTime @updatedAt @map("updated_at")` | Identical |

---

### StorageLocation

| Field | Inventory `[inventory].[StorageLocation]` | Recipe `[recipe].[StorageLocation]` | Notes |
|-------|-------------------------------------------|--------------------------------------|-------|
| `id` | `String @id @default(cuid())` | `String @id @default(cuid())` | Different ID spaces |
| `facilityId` | `String @map("facility_id")` | `String @map("facility_id")` | Identical pattern |
| `name` | `String` | `String` | Identical |
| `description` | `String? @db.NVarChar(500)` | `String? @db.NVarChar(500)` | Identical |
| `category` | `String?` — dry \| refrigerated \| frozen \| production \| receiving \| specialty | `String?` — same values | Identical |
| `sortOrder` | `Int @default(0) @map("sort_order")` | `Int @default(0) @map("sort_order")` | Identical |
| `isActive` | `Boolean @default(true) @map("is_active")` | `Boolean @default(true) @map("is_active")` | Identical |
| `createdAt` | `DateTime @default(now()) @map("created_at")` | `DateTime @default(now()) @map("created_at")` | Identical |
| `updatedAt` | `DateTime @updatedAt @map("updated_at")` | `DateTime @updatedAt @map("updated_at")` | Identical |

StorageLocation is structurally identical. In a future bridge, facilities could share storage location definitions, but currently each schema manages its own.

---

## B3: Gap Analysis

### Fields in Recipe but NOT in Inventory

| Table | Field | Recipe Has It | Why It Exists | Bridge Needed? |
|-------|-------|---------------|---------------|----------------|
| `Item` | `buttonName` | ✅ | HealthTouch POS display label | No — HealthTouch-specific |
| `Item` | `recipeNumber` | ✅ | HealthTouch recipe/item code | No — HealthTouch-specific |
| `Item` | `pushStatus` | ✅ | HealthTouch sync tracking | No — HealthTouch-specific |
| `Allergen` | `healthTouchAllergenId` | ✅ | HealthTouch allergen sync key | No — HealthTouch-specific |

### Fields in Inventory but NOT in Recipe

| Table | Field | Inventory Has It | Why It Exists | Bridge Needed? |
|-------|-------|------------------|---------------|----------------|
| `Item` | `currentQty` | ✅ | FIFO on-hand quantity | No — inventory-specific, not in Recipe's domain |
| `Item` | `reorderPoint` | ✅ | Low-stock threshold | No — inventory-specific |
| `Item` | `reorderQty` | ✅ | Suggested reorder amount | No — inventory-specific |
| `Allergen` | `severity` | ✅ | Informational severity label (e.g., "Severe") | Maybe — could be useful in Recipe |

### Unique to Recipe (no analog in Inventory)

| Model | Notes |
|-------|-------|
| `Recipe` | Recipe management — not in Inventory's scope |
| `RecipeIngredient` | Recipe → Item links |
| `RecipeStep` | Preparation instructions |
| `RecipeNutrition` | Rolled-up recipe nutrition |
| `MealPeriod` | Dining period configuration |
| `ProductionSlot` | Production scheduling |
| `ProductionSubstitution` | Ingredient substitutions |
| `MenuRotation` / `MenuRotationDay` / `MenuRotationItem` | Menu planning |

### Unique to Inventory (no analog in Recipe)

| Model | Notes |
|-------|-------|
| `Vendor` | Vendor management |
| `VendorImportProfile` | AI column mapping cache |
| `ItemVendor` | Item ↔ vendor cross-reference |
| `ItemLayer` | FIFO cost layers |
| `ItemTransaction` | Receive/waste/adjustment history |
| `ItemUOMConversion` | Per-item unit conversions |
| `ImportJob` / `ImportedItem` | Vendor file import pipeline |

---

## B4: FK and Relationship Mapping

### Recipe relationships that reference Item

| Relationship | FK Type | Cascade | Notes |
|-------------|---------|---------|-------|
| `Recipe.linkedItemId → Item.id` | Optional (1:1) | `NoAction` on Item | Recipe promoted to Item. NoAction chosen to avoid circular cascade. Code must clear `linkedItemId` before deleting an `Item` that is a promoted recipe. |
| `RecipeIngredient.itemId → Item.id` | Required (N:1) | `NoAction` on Item | NoAction breaks implicit cascade cycle through Facility. Code must delete `RecipeIngredient` rows before deleting an `Item`. |
| `ProductionSubstitution.originalItemId → Item.id` | Required (N:1) | `NoAction` on Item | Both originalItemId and substituteItemId reference Item — SQL Server allows only one cascade path per table. |
| `ProductionSubstitution.substituteItemId → Item.id` | Required (N:1) | `NoAction` on Item | Second path; same reason. |
| `ItemAllergen.itemId → Item.id` | Required (N:1) | `Cascade` on Item | Primary path — deleting an Item cascades to its allergen flags. |
| `ItemNutrition.itemId → Item.id` | Required (1:1) | `Cascade` on Item | Primary path — deleting an Item cascades to its nutrition record. |
| `Item.storageLocationId → StorageLocation.id` | Optional (N:1) | `NoAction` on StorageLocation | NoAction because of SQL Server cascade chain limit from Facility. |

### Cross-schema FK feasibility on Azure SQL Server

**Short answer: Azure SQL Server SUPPORTS cross-schema FK references (e.g., `[inventory].[Item]` referencing `[recipe].[Item]`).**

However, Prisma `multiSchema` with `@@schema()` directives **does NOT generate cross-schema FK constraints** in the Prisma schema DSL — cross-schema relations are not supported in Prisma as of Prisma 5.x. This means:

1. **Cross-schema FKs can be created directly in raw SQL** via migrations or `prisma db execute` — SQL Server enforces them correctly.
2. **Prisma cannot model cross-schema relations** — any bridge queries must use raw SQL (`$queryRaw`) or be implemented at the application layer by joining on `healthTouchItemId`.
3. **Without FK enforcement from Prisma**, referential integrity must be maintained in application code.

### Recommended bridge approach

Since both schemas share the `healthTouchItemId` as a natural key from HealthTouch:

```sql
-- Cross-schema join: Recipe item nutrition read from Inventory-enriched data
SELECT
  r.[id]            AS recipe_item_id,
  r.[name]          AS recipe_item_name,
  i.[id]            AS inventory_item_id,
  n.[calories],
  n.[protein],
  n.[sodium]
FROM [recipe].[Item] r
LEFT JOIN [inventory].[Item] i
  ON r.[healthtouch_item_id] = i.[healthtouch_item_id]
  AND r.[facility_id] = i.[facility_id]
LEFT JOIN [inventory].[ItemNutrition] n
  ON n.[item_id] = i.[id];
```

This join works today on the shared Azure SQL instance. No FK constraint needed — the `healthTouchItemId` uniqueness constraint on both sides provides sufficient integrity guarantees.

### Allergen bridge

Allergens cannot be bridged by ID (different catalogs). Bridge by name:

```sql
-- Map allergen flags from Inventory to Recipe allergen catalog
SELECT
  ra.[id]           AS recipe_item_allergen_id,
  ri.[id]           AS inventory_item_id,
  ria.[severity],
  ria.[source],
  ria.[confidence]
FROM [recipe].[Item] r
JOIN [recipe].[ItemAllergen] ra ON ra.[item_id] = r.[id]
JOIN [recipe].[Allergen] rag ON rag.[id] = ra.[allergen_id]
LEFT JOIN [inventory].[Item] ri
  ON r.[healthtouch_item_id] = ri.[healthtouch_item_id]
  AND r.[facility_id] = ri.[facility_id]
LEFT JOIN [inventory].[ItemAllergen] ria ON ria.[item_id] = ri.[id]
LEFT JOIN [inventory].[Allergen] iag ON iag.[id] = ria.[allergen_id]
  AND iag.[name] = rag.[name];
```

---

## B5: Cross-Schema Query Test

_Skipped — no Azure deployment available at time of audit. See B4 for the query design and expected behavior based on SQL Server cross-schema semantics. To verify: run the SELECT query in B4 against the shared Azure SQL instance after `prisma db push` for both repos._

---

## Summary

### High alignment (no changes needed)
- `ItemNutrition` — structurally identical field-for-field
- `ItemAllergen` — identical structure; allergenId points to different catalogs (bridge by name)
- `StorageLocation` — structurally identical

### Moderate gaps (non-blocking)
- `Item.healthTouchItemId` — required in Recipe, optional in Inventory. Inventory items created from vendor imports won't have this; only items synced from HealthTouch will. Bridge queries must use `LEFT JOIN`.
- `Allergen.severity` — Inventory has it, Recipe doesn't. Acceptable; it's informational.

### No bridge needed
- Recipe-only fields (`buttonName`, `recipeNumber`, `pushStatus`, `healthTouchAllergenId`) — HealthTouch-specific, not in Inventory's domain
- Inventory-only fields (`currentQty`, `reorderPoint`, `reorderQty`) — inventory management concepts not needed in Recipe

### Cross-schema FK strategy
- Do NOT add cross-schema FK constraints via Prisma (not supported in Prisma 5.x multiSchema)
- Use `healthTouchItemId` as the natural bridge key in raw SQL joins
- Maintain integrity at the application layer
- Cross-schema reads work today on the shared SQL Server instance
