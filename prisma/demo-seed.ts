/**
 * Inventory — Demo Seed
 *
 * Seeds one Facility, 2 Vendors, 6 Storage Locations, 46 Items, allergens (Big 9 + 8 drug
 * interactions), nutrition data, and a few opening ItemLayers.
 *
 * Gated: runs only when facility.count() === 0 to avoid double-seeding.
 *
 * Run: npm run demo:seed
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const facilityCount = await prisma.facility.count();
  if (facilityCount > 0) {
    console.log('[demo-seed] Facility already exists — skipping.');
    return;
  }

  console.log('[demo-seed] Seeding demo data…');

  // ── Facility ────────────────────────────────────────────────────────
  const facility = await prisma.facility.create({
    data: {
      name: 'General Hospital — Cafeteria',
    },
  });

  console.log(`[demo-seed] Facility: ${facility.name} (${facility.id})`);

  // ── Default admin user (PIN: 1234) ──────────────────────────────────
  // PIN stored as plaintext in demo — real auth hashes with bcrypt.
  await prisma.appUser.create({
    data: {
      facilityId: facility.id,
      name: 'Admin',
      pin: '1234',
      role: 'ADMIN',
    },
  });

  // ── Vendors ─────────────────────────────────────────────────────────
  const sysco = await prisma.vendor.create({
    data: {
      facilityId: facility.id,
      name: 'Sysco',
      contactName: 'Mark Thompson',
      contactEmail: 'mark.thompson@sysco.com',
      contactPhone: '800-380-6543',
      notes: 'Primary broadline distributor. Order by Tuesday for Thursday delivery.',
    },
  });

  const usFoods = await prisma.vendor.create({
    data: {
      facilityId: facility.id,
      name: 'US Foods',
      contactName: 'Linda Park',
      contactEmail: 'linda.park@usfoods.com',
      contactPhone: '800-777-4665',
      notes: 'Secondary broadline distributor. Order by Wednesday for Friday delivery.',
    },
  });

  console.log('[demo-seed] Vendors: Sysco, US Foods');

  // ── Storage Locations ────────────────────────────────────────────────
  const [walkInCooler, walkInFreezer, dryStorage, cannedGoods, productionKitchen, receivingDock] =
    await Promise.all([
      prisma.storageLocation.create({
        data: {
          facilityId: facility.id,
          name: 'Walk-In Cooler',
          description: 'Main refrigerated storage. 34–38°F.',
          category: 'refrigerated',
          sortOrder: 1,
        },
      }),
      prisma.storageLocation.create({
        data: {
          facilityId: facility.id,
          name: 'Walk-In Freezer',
          description: 'Main frozen storage. 0°F or below.',
          category: 'frozen',
          sortOrder: 2,
        },
      }),
      prisma.storageLocation.create({
        data: {
          facilityId: facility.id,
          name: 'Dry Storage',
          description: 'Ambient dry goods storage. 60–70°F.',
          category: 'dry',
          sortOrder: 3,
        },
      }),
      prisma.storageLocation.create({
        data: {
          facilityId: facility.id,
          name: 'Canned & Jarred Goods',
          description: 'Canned, jarred, and shelf-stable items.',
          category: 'dry',
          sortOrder: 4,
        },
      }),
      prisma.storageLocation.create({
        data: {
          facilityId: facility.id,
          name: 'Production Kitchen',
          description: 'Active prep area — items in use for current production.',
          category: 'production',
          sortOrder: 5,
        },
      }),
      prisma.storageLocation.create({
        data: {
          facilityId: facility.id,
          name: 'Receiving Dock',
          description: 'Temporary staging area for incoming deliveries.',
          category: 'receiving',
          sortOrder: 6,
        },
      }),
    ]);

  console.log('[demo-seed] Storage locations created (6)');

  // ── Allergens — Big 9 + 8 Drug Interactions ──────────────────────────
  const allergenData = [
    // Big 9
    { name: 'Milk', isBigNine: true, category: 'ALLERGEN', severity: 'Major', keywords: JSON.stringify(['milk', 'dairy', 'lactose', 'butter', 'cream', 'cheese', 'whey', 'casein', 'yogurt']), aiHint: 'Dairy products, milk derivatives, lactose, casein, whey' },
    { name: 'Eggs', isBigNine: true, category: 'ALLERGEN', severity: 'Major', keywords: JSON.stringify(['egg', 'albumin', 'globulin', 'mayonnaise', 'meringue', 'ovalbumin']), aiHint: 'Eggs and egg products, albumin, mayonnaise' },
    { name: 'Fish', isBigNine: true, category: 'ALLERGEN', severity: 'Major', keywords: JSON.stringify(['fish', 'salmon', 'tuna', 'cod', 'tilapia', 'pollock', 'bass', 'flounder', 'halibut', 'mahi']), aiHint: 'Fish species: salmon, tuna, cod, tilapia, pollock, bass, flounder, halibut' },
    { name: 'Shellfish', isBigNine: true, category: 'ALLERGEN', severity: 'Major', keywords: JSON.stringify(['shrimp', 'crab', 'lobster', 'clam', 'oyster', 'scallop', 'mussel', 'prawn', 'squid', 'octopus']), aiHint: 'Crustaceans and mollusks: shrimp, crab, lobster, clam, oyster, scallop' },
    { name: 'Tree Nuts', isBigNine: true, category: 'ALLERGEN', severity: 'Major', keywords: JSON.stringify(['almond', 'cashew', 'walnut', 'pecan', 'pistachio', 'hazelnut', 'macadamia', 'brazil nut', 'pine nut']), aiHint: 'Tree nuts: almonds, cashews, walnuts, pecans, pistachios, hazelnuts, macadamia' },
    { name: 'Peanuts', isBigNine: true, category: 'ALLERGEN', severity: 'Major', keywords: JSON.stringify(['peanut', 'groundnut', 'arachis oil', 'peanut butter', 'monkey nuts']), aiHint: 'Peanuts and peanut products, arachis oil, groundnuts' },
    { name: 'Wheat', isBigNine: true, category: 'ALLERGEN', severity: 'Major', keywords: JSON.stringify(['wheat', 'flour', 'bread', 'pasta', 'gluten', 'semolina', 'spelt', 'farro', 'durum', 'bulgur', 'kamut']), aiHint: 'Wheat and wheat derivatives: flour, bread, pasta, gluten, semolina, spelt' },
    { name: 'Soybeans', isBigNine: true, category: 'ALLERGEN', severity: 'Major', keywords: JSON.stringify(['soy', 'soybean', 'tofu', 'edamame', 'miso', 'tempeh', 'tamari', 'soy sauce', 'soya']), aiHint: 'Soy and soy products: tofu, edamame, miso, tempeh, soy sauce' },
    { name: 'Sesame', isBigNine: true, category: 'ALLERGEN', severity: 'Major', keywords: JSON.stringify(['sesame', 'tahini', 'gingelly', 'benne', 'sesame oil', 'sesame seed']), aiHint: 'Sesame seeds, tahini, sesame oil' },
    // Drug Interactions
    { name: 'Grapefruit', isBigNine: false, category: 'DRUG_INTERACTION', severity: 'Moderate', keywords: JSON.stringify(['grapefruit', 'pomelo']), aiHint: 'Inhibits CYP3A4. Interacts with statins, calcium channel blockers, immunosuppressants.' },
    { name: 'Tyramine (High)', isBigNine: false, category: 'DRUG_INTERACTION', severity: 'High', keywords: JSON.stringify(['aged cheese', 'cured meat', 'fermented', 'sauerkraut', 'kimchi', 'salami', 'pepperoni', 'wine']), aiHint: 'High-tyramine foods interact with MAOIs causing hypertensive crisis.' },
    { name: 'Vitamin K', isBigNine: false, category: 'DRUG_INTERACTION', severity: 'Moderate', keywords: JSON.stringify(['kale', 'spinach', 'collard greens', 'swiss chard', 'broccoli', 'brussels sprouts', 'green onion', 'parsley']), aiHint: 'Vitamin K-rich foods interact with warfarin/anticoagulants. Monitor INR.' },
    { name: 'Potassium (High)', isBigNine: false, category: 'DRUG_INTERACTION', severity: 'Moderate', keywords: JSON.stringify(['banana', 'orange', 'potato', 'avocado', 'spinach', 'tomato', 'yogurt', 'salmon', 'beans']), aiHint: 'High potassium foods interact with ACE inhibitors, ARBs, potassium-sparing diuretics.' },
    { name: 'Calcium (Supplement Risk)', isBigNine: false, category: 'DRUG_INTERACTION', severity: 'Low', keywords: JSON.stringify(['milk', 'cheese', 'yogurt', 'fortified', 'calcium-fortified']), aiHint: 'Calcium reduces absorption of tetracyclines, fluoroquinolones, bisphosphonates, thyroid meds. Space 2+ hrs.' },
    { name: 'Phosphorus (High)', isBigNine: false, category: 'DRUG_INTERACTION', severity: 'Low', keywords: JSON.stringify(['dairy', 'meat', 'nuts', 'beans', 'cola', 'processed cheese']), aiHint: 'High phosphorus relevant for renal diet patients on phosphate binders.' },
    { name: 'Sodium (High)', isBigNine: false, category: 'DRUG_INTERACTION', severity: 'Low', keywords: JSON.stringify(['salt', 'sodium', 'cured', 'brined', 'pickled', 'soy sauce', 'processed']), aiHint: 'High sodium interacts with lithium, diuretics, antihypertensives.' },
    { name: 'Alcohol', isBigNine: false, category: 'DRUG_INTERACTION', severity: 'High', keywords: JSON.stringify(['alcohol', 'wine', 'beer', 'liquor', 'spirits', 'mirin', 'cooking wine']), aiHint: 'Alcohol interacts with metronidazole, antidepressants, sedatives, blood thinners.' },
  ];

  const createdAllergens = await Promise.all(
    allergenData.map((a) =>
      prisma.allergen.create({
        data: {
          facilityId: facility.id,
          name: a.name,
          isBigNine: a.isBigNine,
          category: a.category,
          severity: a.severity,
          keywords: a.keywords,
          aiHint: a.aiHint,
        },
      }),
    ),
  );

  const allergenMap = Object.fromEntries(createdAllergens.map((a) => [a.name, a]));
  console.log(`[demo-seed] Allergens created (${createdAllergens.length})`);

  // ── Helper to create an item with optional nutrition, allergens, layer ──
  type ItemSpec = {
    name: string;
    category: string;
    portionSize?: number;
    portionUnit?: string;
    currentQty: number;
    reorderPoint?: number;
    reorderQty?: number;
    storageLocation: typeof walkInCooler;
    vendors: Array<{ vendor: typeof sysco; sku?: string; packSize?: string; lastCost: number }>;
    allergens?: Array<{ name: string; severity: string }>;
    nutrition?: {
      calories?: number; protein?: number; totalFat?: number; carbohydrate?: number;
      fiber?: number; sugar?: number; sodium?: number; calcium?: number;
      servingSize?: number; servingUnit?: string;
    };
    openingLayerCost?: number;
  };

  async function createItem(spec: ItemSpec) {
    const item = await prisma.item.create({
      data: {
        facilityId: facility.id,
        name: spec.name,
        category: spec.category,
        portionSize: spec.portionSize ?? null,
        portionUnit: spec.portionUnit ?? null,
        currentQty: spec.currentQty,
        reorderPoint: spec.reorderPoint ?? null,
        reorderQty: spec.reorderQty ?? null,
        storageLocationId: spec.storageLocation.id,
        itemCost: spec.vendors[0]?.lastCost ?? null,
      },
    });

    // Vendor links
    for (const v of spec.vendors) {
      await prisma.itemVendor.create({
        data: {
          itemId: item.id,
          vendorId: v.vendor.id,
          vendorSku: v.sku ?? null,
          packSize: v.packSize ?? null,
          lastCost: v.lastCost,
          lastReceivedAt: new Date(),
        },
      });
    }

    // Opening layer
    if (spec.openingLayerCost !== undefined && spec.currentQty > 0) {
      await prisma.itemLayer.create({
        data: {
          itemId: item.id,
          quantity: spec.currentQty,
          originalQty: spec.currentQty,
          unitCost: spec.openingLayerCost,
          sourceType: 'OPENING',
        },
      });
    }

    // Nutrition
    if (spec.nutrition) {
      await prisma.itemNutrition.create({
        data: {
          itemId: item.id,
          servingSize: spec.nutrition.servingSize ?? null,
          servingUnit: spec.nutrition.servingUnit ?? null,
          calories: spec.nutrition.calories ?? null,
          protein: spec.nutrition.protein ?? null,
          totalFat: spec.nutrition.totalFat ?? null,
          carbohydrate: spec.nutrition.carbohydrate ?? null,
          fiber: spec.nutrition.fiber ?? null,
          sugar: spec.nutrition.sugar ?? null,
          sodium: spec.nutrition.sodium ?? null,
          calcium: spec.nutrition.calcium ?? null,
          source: 'SEED',
        },
      });
    }

    // Allergens
    if (spec.allergens) {
      for (const a of spec.allergens) {
        const allergenRecord = allergenMap[a.name];
        if (!allergenRecord) continue;
        await prisma.itemAllergen.create({
          data: {
            itemId: item.id,
            allergenId: allergenRecord.id,
            severity: a.severity,
            source: 'MANUAL',
            confidence: 1.0,
          },
        });
      }
    }

    return item;
  }

  // ── 46 Items ──────────────────────────────────────────────────────────
  // Produce (10)
  await createItem({ name: 'Apples — Gala', category: 'Produce', portionSize: 1, portionUnit: 'each', currentQty: 120, reorderPoint: 24, reorderQty: 48, storageLocation: walkInCooler, vendors: [{ vendor: sysco, sku: 'SY-APPLE-GAL', packSize: '40 ct', lastCost: 18.50 }], openingLayerCost: 18.50, nutrition: { calories: 95, protein: 0.5, totalFat: 0.3, carbohydrate: 25, fiber: 4.4, sugar: 19, sodium: 2, servingSize: 182, servingUnit: 'g' } });
  await createItem({ name: 'Bananas', category: 'Produce', portionSize: 1, portionUnit: 'each', currentQty: 96, reorderPoint: 24, reorderQty: 48, storageLocation: productionKitchen, vendors: [{ vendor: sysco, sku: 'SY-BANANA', packSize: '40 lb case', lastCost: 22.00 }], openingLayerCost: 22.00, nutrition: { calories: 105, protein: 1.3, totalFat: 0.4, carbohydrate: 27, fiber: 3.1, sugar: 14, sodium: 1, servingSize: 118, servingUnit: 'g' }, allergens: [{ name: 'Potassium (High)', severity: 'CONTAINS' }] });
  await createItem({ name: 'Broccoli — Fresh', category: 'Produce', portionSize: 4, portionUnit: 'oz', currentQty: 30, reorderPoint: 10, reorderQty: 20, storageLocation: walkInCooler, vendors: [{ vendor: usFoods, sku: 'UF-BROCC-F', packSize: '20 lb case', lastCost: 28.00 }], openingLayerCost: 28.00, nutrition: { calories: 34, protein: 2.8, totalFat: 0.4, carbohydrate: 6.6, fiber: 2.6, sugar: 1.7, sodium: 33, calcium: 47, servingSize: 91, servingUnit: 'g' }, allergens: [{ name: 'Vitamin K', severity: 'CONTAINS' }] });
  await createItem({ name: 'Carrots — Baby', category: 'Produce', portionSize: 3, portionUnit: 'oz', currentQty: 20, reorderPoint: 5, reorderQty: 10, storageLocation: walkInCooler, vendors: [{ vendor: sysco, sku: 'SY-CARROT-B', packSize: '5 lb bag', lastCost: 8.50 }], openingLayerCost: 8.50, nutrition: { calories: 35, protein: 0.6, totalFat: 0.1, carbohydrate: 8.2, fiber: 2.3, sugar: 4.7, sodium: 69, servingSize: 85, servingUnit: 'g' } });
  await createItem({ name: 'Celery', category: 'Produce', portionSize: 2, portionUnit: 'oz', currentQty: 15, reorderPoint: 4, reorderQty: 8, storageLocation: walkInCooler, vendors: [{ vendor: sysco, sku: 'SY-CELERY', packSize: '24 ct', lastCost: 16.00 }], openingLayerCost: 16.00, nutrition: { calories: 10, protein: 0.4, totalFat: 0.1, carbohydrate: 1.9, fiber: 1.0, sodium: 81, servingSize: 40, servingUnit: 'g' } });
  await createItem({ name: 'Iceberg Lettuce', category: 'Produce', portionSize: 2, portionUnit: 'oz', currentQty: 12, reorderPoint: 4, reorderQty: 8, storageLocation: walkInCooler, vendors: [{ vendor: usFoods, sku: 'UF-LETT-ICE', packSize: '24 ct', lastCost: 24.00 }], openingLayerCost: 24.00, nutrition: { calories: 10, protein: 0.6, totalFat: 0.1, carbohydrate: 1.6, fiber: 0.6, sodium: 7, servingSize: 55, servingUnit: 'g' } });
  await createItem({ name: 'Tomatoes — Roma', category: 'Produce', portionSize: 2, portionUnit: 'oz', currentQty: 25, reorderPoint: 8, reorderQty: 16, storageLocation: walkInCooler, vendors: [{ vendor: sysco, sku: 'SY-TOM-ROMA', packSize: '25 lb case', lastCost: 22.00 }], openingLayerCost: 22.00, nutrition: { calories: 18, protein: 0.9, totalFat: 0.2, carbohydrate: 3.9, fiber: 1.2, sugar: 2.6, sodium: 5, servingSize: 62, servingUnit: 'g' } });
  await createItem({ name: 'Oranges — Navel', category: 'Produce', portionSize: 1, portionUnit: 'each', currentQty: 72, reorderPoint: 24, reorderQty: 48, storageLocation: walkInCooler, vendors: [{ vendor: usFoods, sku: 'UF-ORG-NAV', packSize: '72 ct', lastCost: 26.00 }], openingLayerCost: 26.00, nutrition: { calories: 62, protein: 1.2, totalFat: 0.2, carbohydrate: 15.4, fiber: 3.1, sugar: 12.2, sodium: 0, calcium: 60, servingSize: 131, servingUnit: 'g' } });
  await createItem({ name: 'Spinach — Fresh', category: 'Produce', portionSize: 2, portionUnit: 'oz', currentQty: 8, reorderPoint: 3, reorderQty: 6, storageLocation: walkInCooler, vendors: [{ vendor: sysco, sku: 'SY-SPIN-F', packSize: '4 lb bag', lastCost: 12.00 }], openingLayerCost: 12.00, nutrition: { calories: 7, protein: 0.9, totalFat: 0.1, carbohydrate: 1.1, fiber: 0.7, sodium: 24, calcium: 30, servingSize: 30, servingUnit: 'g' }, allergens: [{ name: 'Vitamin K', severity: 'CONTAINS' }, { name: 'Potassium (High)', severity: 'CONTAINS' }] });
  await createItem({ name: 'Russet Potatoes', category: 'Produce', portionSize: 6, portionUnit: 'oz', currentQty: 50, reorderPoint: 20, reorderQty: 40, storageLocation: dryStorage, vendors: [{ vendor: sysco, sku: 'SY-POT-RUS', packSize: '50 lb bag', lastCost: 18.00 }], openingLayerCost: 18.00, nutrition: { calories: 168, protein: 4.6, totalFat: 0.2, carbohydrate: 38.6, fiber: 2.7, sugar: 1.3, sodium: 17, potassium: 927, servingSize: 173, servingUnit: 'g' }, allergens: [{ name: 'Potassium (High)', severity: 'CONTAINS' }] });

  // Proteins (12)
  await createItem({ name: 'Ground Beef 80/20', category: 'Proteins', portionSize: 4, portionUnit: 'oz', currentQty: 40, reorderPoint: 10, reorderQty: 20, storageLocation: walkInCooler, vendors: [{ vendor: sysco, sku: 'SY-GBEEF-80', packSize: '10 lb chub', lastCost: 38.00 }], openingLayerCost: 3.80, nutrition: { calories: 287, protein: 19.6, totalFat: 22.7, carbohydrate: 0, sodium: 75, servingSize: 113, servingUnit: 'g' } });
  await createItem({ name: 'Chicken Breast — IQF', category: 'Proteins', portionSize: 6, portionUnit: 'oz', currentQty: 60, reorderPoint: 20, reorderQty: 40, storageLocation: walkInFreezer, vendors: [{ vendor: sysco, sku: 'SY-CHKBR-IQF', packSize: '40 lb case', lastCost: 78.00 }], openingLayerCost: 1.95, nutrition: { calories: 165, protein: 31, totalFat: 3.6, carbohydrate: 0, sodium: 74, servingSize: 100, servingUnit: 'g' } });
  await createItem({ name: 'Eggs — Large Grade A', category: 'Proteins', portionSize: 2, portionUnit: 'each', currentQty: 30, reorderPoint: 10, reorderQty: 20, storageLocation: walkInCooler, vendors: [{ vendor: usFoods, sku: 'UF-EGG-LGA', packSize: '15 dz case', lastCost: 36.00 }], openingLayerCost: 2.40, nutrition: { calories: 147, protein: 13, totalFat: 10, carbohydrate: 0.8, sodium: 142, calcium: 56, servingSize: 100, servingUnit: 'g' }, allergens: [{ name: 'Eggs', severity: 'CONTAINS' }] });
  await createItem({ name: 'Tuna — Chunk Light in Water', category: 'Proteins', portionSize: 2, portionUnit: 'oz', currentQty: 48, reorderPoint: 12, reorderQty: 24, storageLocation: cannedGoods, vendors: [{ vendor: sysco, sku: 'SY-TUNA-CL', packSize: '24/5oz case', lastCost: 42.00 }], openingLayerCost: 1.75, nutrition: { calories: 109, protein: 25.5, totalFat: 0.5, carbohydrate: 0, sodium: 287, servingSize: 142, servingUnit: 'g' }, allergens: [{ name: 'Fish', severity: 'CONTAINS' }] });
  await createItem({ name: 'Turkey Breast — Sliced', category: 'Proteins', portionSize: 3, portionUnit: 'oz', currentQty: 25, reorderPoint: 8, reorderQty: 16, storageLocation: walkInCooler, vendors: [{ vendor: usFoods, sku: 'UF-TRK-SLC', packSize: '5 lb pkg', lastCost: 24.00 }], openingLayerCost: 4.80, nutrition: { calories: 135, protein: 26, totalFat: 3, carbohydrate: 1, sodium: 830, servingSize: 85, servingUnit: 'g' } });
  await createItem({ name: 'Salmon Fillet — Atlantic', category: 'Proteins', portionSize: 6, portionUnit: 'oz', currentQty: 20, reorderPoint: 6, reorderQty: 12, storageLocation: walkInFreezer, vendors: [{ vendor: usFoods, sku: 'UF-SAL-ATL', packSize: '10 lb case', lastCost: 72.00 }], openingLayerCost: 7.20, nutrition: { calories: 208, protein: 20.5, totalFat: 13.4, carbohydrate: 0, sodium: 59, servingSize: 100, servingUnit: 'g' }, allergens: [{ name: 'Fish', severity: 'CONTAINS' }, { name: 'Potassium (High)', severity: 'CONTAINS' }] });
  await createItem({ name: 'Black Beans — Canned', category: 'Proteins', portionSize: 4, portionUnit: 'oz', currentQty: 36, reorderPoint: 12, reorderQty: 24, storageLocation: cannedGoods, vendors: [{ vendor: sysco, sku: 'SY-BBEAN-C', packSize: '12/29oz case', lastCost: 18.00 }], openingLayerCost: 1.50, nutrition: { calories: 132, protein: 8.9, totalFat: 0.5, carbohydrate: 24, fiber: 8.7, sodium: 399, servingSize: 130, servingUnit: 'g' }, allergens: [{ name: 'Potassium (High)', severity: 'CONTAINS' }] });
  await createItem({ name: 'Kidney Beans — Canned', category: 'Proteins', portionSize: 4, portionUnit: 'oz', currentQty: 24, reorderPoint: 8, reorderQty: 16, storageLocation: cannedGoods, vendors: [{ vendor: usFoods, sku: 'UF-KBEAN-C', packSize: '12/29oz case', lastCost: 18.00 }], openingLayerCost: 1.50, nutrition: { calories: 127, protein: 8.7, totalFat: 0.5, carbohydrate: 22.8, fiber: 7.4, sodium: 406, servingSize: 128, servingUnit: 'g' } });
  await createItem({ name: 'Tofu — Firm', category: 'Proteins', portionSize: 4, portionUnit: 'oz', currentQty: 16, reorderPoint: 4, reorderQty: 8, storageLocation: walkInCooler, vendors: [{ vendor: sysco, sku: 'SY-TOFU-F', packSize: '12/14oz case', lastCost: 24.00 }], openingLayerCost: 2.00, nutrition: { calories: 144, protein: 17.3, totalFat: 8.7, carbohydrate: 2.8, sodium: 14, calcium: 350, servingSize: 126, servingUnit: 'g' }, allergens: [{ name: 'Soybeans', severity: 'CONTAINS' }] });
  await createItem({ name: 'Ham — Sliced Deli', category: 'Proteins', portionSize: 3, portionUnit: 'oz', currentQty: 20, reorderPoint: 6, reorderQty: 12, storageLocation: walkInCooler, vendors: [{ vendor: usFoods, sku: 'UF-HAM-SLC', packSize: '5 lb pkg', lastCost: 22.00 }], openingLayerCost: 4.40, nutrition: { calories: 113, protein: 14.9, totalFat: 5.5, carbohydrate: 1.5, sodium: 1255, servingSize: 85, servingUnit: 'g' }, allergens: [{ name: 'Sodium (High)', severity: 'CONTAINS' }] });
  await createItem({ name: 'Bacon — Thick Cut', category: 'Proteins', portionSize: 2, portionUnit: 'oz', currentQty: 15, reorderPoint: 5, reorderQty: 10, storageLocation: walkInCooler, vendors: [{ vendor: sysco, sku: 'SY-BACON-TC', packSize: '15 lb case', lastCost: 52.00 }], openingLayerCost: 3.47, nutrition: { calories: 541, protein: 37, totalFat: 42, carbohydrate: 1.4, sodium: 1717, servingSize: 100, servingUnit: 'g' }, allergens: [{ name: 'Sodium (High)', severity: 'CONTAINS' }] });
  await createItem({ name: 'Pork Loin — Boneless', category: 'Proteins', portionSize: 6, portionUnit: 'oz', currentQty: 30, reorderPoint: 10, reorderQty: 20, storageLocation: walkInFreezer, vendors: [{ vendor: usFoods, sku: 'UF-PORK-BL', packSize: '10 lb case', lastCost: 32.00 }], openingLayerCost: 3.20, nutrition: { calories: 198, protein: 22.8, totalFat: 11, carbohydrate: 0, sodium: 53, servingSize: 100, servingUnit: 'g' } });

  // Dairy (6)
  await createItem({ name: 'Whole Milk', category: 'Dairy', portionSize: 8, portionUnit: 'fl oz', currentQty: 24, reorderPoint: 8, reorderQty: 16, storageLocation: walkInCooler, vendors: [{ vendor: sysco, sku: 'SY-MILK-W', packSize: '4/1 gal', lastCost: 18.00 }], openingLayerCost: 4.50, nutrition: { calories: 149, protein: 7.7, totalFat: 8, carbohydrate: 11.7, sugar: 12, sodium: 105, calcium: 276, servingSize: 244, servingUnit: 'mL' }, allergens: [{ name: 'Milk', severity: 'CONTAINS' }, { name: 'Calcium (Supplement Risk)', severity: 'CONTAINS' }] });
  await createItem({ name: '2% Milk', category: 'Dairy', portionSize: 8, portionUnit: 'fl oz', currentQty: 20, reorderPoint: 8, reorderQty: 16, storageLocation: walkInCooler, vendors: [{ vendor: sysco, sku: 'SY-MILK-2', packSize: '4/1 gal', lastCost: 17.00 }], openingLayerCost: 4.25, nutrition: { calories: 122, protein: 8.1, totalFat: 4.8, carbohydrate: 11.7, sugar: 12, sodium: 115, calcium: 293, servingSize: 244, servingUnit: 'mL' }, allergens: [{ name: 'Milk', severity: 'CONTAINS' }, { name: 'Calcium (Supplement Risk)', severity: 'CONTAINS' }] });
  await createItem({ name: 'Butter — Unsalted', category: 'Dairy', portionSize: 1, portionUnit: 'tbsp', currentQty: 20, reorderPoint: 5, reorderQty: 10, storageLocation: walkInCooler, vendors: [{ vendor: usFoods, sku: 'UF-BUTT-U', packSize: '36/1lb case', lastCost: 108.00 }], openingLayerCost: 3.00, nutrition: { calories: 102, protein: 0.1, totalFat: 11.5, carbohydrate: 0, sodium: 2, servingSize: 14, servingUnit: 'g' }, allergens: [{ name: 'Milk', severity: 'CONTAINS' }] });
  await createItem({ name: 'Cheddar Cheese — Shredded', category: 'Dairy', portionSize: 1, portionUnit: 'oz', currentQty: 15, reorderPoint: 5, reorderQty: 10, storageLocation: walkInCooler, vendors: [{ vendor: sysco, sku: 'SY-CHED-SHR', packSize: '4/5 lb bag', lastCost: 48.00 }], openingLayerCost: 2.40, nutrition: { calories: 113, protein: 7, totalFat: 9.3, carbohydrate: 0.4, sodium: 174, calcium: 204, servingSize: 28, servingUnit: 'g' }, allergens: [{ name: 'Milk', severity: 'CONTAINS' }, { name: 'Tyramine (High)', severity: 'CONTAINS' }, { name: 'Calcium (Supplement Risk)', severity: 'CONTAINS' }] });
  await createItem({ name: 'Mozzarella — Part Skim', category: 'Dairy', portionSize: 1, portionUnit: 'oz', currentQty: 12, reorderPoint: 4, reorderQty: 8, storageLocation: walkInCooler, vendors: [{ vendor: usFoods, sku: 'UF-MOZZ-PS', packSize: '4/5 lb bag', lastCost: 44.00 }], openingLayerCost: 2.20, nutrition: { calories: 72, protein: 6.9, totalFat: 4.5, carbohydrate: 0.8, sodium: 175, calcium: 183, servingSize: 28, servingUnit: 'g' }, allergens: [{ name: 'Milk', severity: 'CONTAINS' }, { name: 'Calcium (Supplement Risk)', severity: 'CONTAINS' }] });
  await createItem({ name: 'Sour Cream', category: 'Dairy', portionSize: 2, portionUnit: 'tbsp', currentQty: 10, reorderPoint: 3, reorderQty: 6, storageLocation: walkInCooler, vendors: [{ vendor: sysco, sku: 'SY-SCREAM', packSize: '4/5 lb tub', lastCost: 28.00 }], openingLayerCost: 1.40, nutrition: { calories: 60, protein: 0.7, totalFat: 5.8, carbohydrate: 1.3, sugar: 1.2, sodium: 14, servingSize: 28, servingUnit: 'g' }, allergens: [{ name: 'Milk', severity: 'CONTAINS' }] });

  // Grains / Dry (8)
  await createItem({ name: 'White Rice — Long Grain', category: 'Grains', portionSize: 4, portionUnit: 'oz', currentQty: 80, reorderPoint: 20, reorderQty: 40, storageLocation: dryStorage, vendors: [{ vendor: sysco, sku: 'SY-RICE-WL', packSize: '50 lb bag', lastCost: 24.00 }], openingLayerCost: 0.48, nutrition: { calories: 206, protein: 4.3, totalFat: 0.4, carbohydrate: 44.5, fiber: 0.6, sodium: 1, servingSize: 186, servingUnit: 'g' } });
  await createItem({ name: 'Brown Rice', category: 'Grains', portionSize: 4, portionUnit: 'oz', currentQty: 40, reorderPoint: 10, reorderQty: 20, storageLocation: dryStorage, vendors: [{ vendor: usFoods, sku: 'UF-RICE-BR', packSize: '50 lb bag', lastCost: 28.00 }], openingLayerCost: 0.56, nutrition: { calories: 216, protein: 5, totalFat: 1.8, carbohydrate: 44.8, fiber: 3.5, sodium: 10, servingSize: 195, servingUnit: 'g' } });
  await createItem({ name: 'Penne Pasta', category: 'Grains', portionSize: 3, portionUnit: 'oz', currentQty: 50, reorderPoint: 12, reorderQty: 24, storageLocation: dryStorage, vendors: [{ vendor: sysco, sku: 'SY-PASTA-P', packSize: '20 lb case', lastCost: 22.00 }], openingLayerCost: 1.10, nutrition: { calories: 349, protein: 12.5, totalFat: 1.5, carbohydrate: 70.2, fiber: 3.2, sodium: 5, servingSize: 100, servingUnit: 'g' }, allergens: [{ name: 'Wheat', severity: 'CONTAINS' }] });
  await createItem({ name: 'White Bread — Sandwich Loaf', category: 'Grains', portionSize: 2, portionUnit: 'slices', currentQty: 20, reorderPoint: 6, reorderQty: 12, storageLocation: dryStorage, vendors: [{ vendor: usFoods, sku: 'UF-BREAD-W', packSize: '6/24oz case', lastCost: 18.00 }], openingLayerCost: 3.00, nutrition: { calories: 133, protein: 4.3, totalFat: 1.7, carbohydrate: 25.5, sodium: 251, servingSize: 52, servingUnit: 'g' }, allergens: [{ name: 'Wheat', severity: 'CONTAINS' }, { name: 'Soybeans', severity: 'MAY_CONTAIN' }] });
  await createItem({ name: 'Whole Wheat Bread', category: 'Grains', portionSize: 2, portionUnit: 'slices', currentQty: 15, reorderPoint: 5, reorderQty: 10, storageLocation: dryStorage, vendors: [{ vendor: sysco, sku: 'SY-BREAD-WW', packSize: '6/24oz case', lastCost: 20.00 }], openingLayerCost: 3.33, nutrition: { calories: 128, protein: 5.5, totalFat: 2.2, carbohydrate: 23.8, fiber: 3.4, sodium: 246, servingSize: 52, servingUnit: 'g' }, allergens: [{ name: 'Wheat', severity: 'CONTAINS' }] });
  await createItem({ name: 'Rolled Oats — Quick Cook', category: 'Grains', portionSize: 1, portionUnit: 'cup dry', currentQty: 40, reorderPoint: 10, reorderQty: 20, storageLocation: dryStorage, vendors: [{ vendor: usFoods, sku: 'UF-OATS-Q', packSize: '10 lb bag', lastCost: 14.00 }], openingLayerCost: 1.40, nutrition: { calories: 307, protein: 10.7, totalFat: 5.3, carbohydrate: 54.8, fiber: 8.2, sugar: 0.8, sodium: 5, servingSize: 81, servingUnit: 'g' } });
  await createItem({ name: 'All-Purpose Flour', category: 'Grains', portionSize: 4, portionUnit: 'oz', currentQty: 50, reorderPoint: 10, reorderQty: 25, storageLocation: dryStorage, vendors: [{ vendor: sysco, sku: 'SY-FLOUR-AP', packSize: '50 lb bag', lastCost: 20.00 }], openingLayerCost: 0.40, nutrition: { calories: 364, protein: 10.3, totalFat: 1, carbohydrate: 76.3, fiber: 2.7, sodium: 2, servingSize: 125, servingUnit: 'g' }, allergens: [{ name: 'Wheat', severity: 'CONTAINS' }] });
  await createItem({ name: 'Cornstarch', category: 'Grains', portionSize: 1, portionUnit: 'tbsp', currentQty: 20, reorderPoint: 4, reorderQty: 8, storageLocation: dryStorage, vendors: [{ vendor: usFoods, sku: 'UF-CSTARCH', packSize: '12/1 lb case', lastCost: 18.00 }], openingLayerCost: 1.50, nutrition: { calories: 381, protein: 0.3, totalFat: 0.1, carbohydrate: 91.3, sodium: 9, servingSize: 128, servingUnit: 'g' } });

  // Frozen (5)
  await createItem({ name: 'Frozen Peas', category: 'Frozen', portionSize: 4, portionUnit: 'oz', currentQty: 30, reorderPoint: 8, reorderQty: 16, storageLocation: walkInFreezer, vendors: [{ vendor: sysco, sku: 'SY-PEA-F', packSize: '12/2.5 lb case', lastCost: 24.00 }], openingLayerCost: 0.80, nutrition: { calories: 81, protein: 5.4, totalFat: 0.4, carbohydrate: 14.4, fiber: 5.1, sugar: 5.6, sodium: 108, servingSize: 85, servingUnit: 'g' } });
  await createItem({ name: 'Frozen Corn — Whole Kernel', category: 'Frozen', portionSize: 4, portionUnit: 'oz', currentQty: 30, reorderPoint: 8, reorderQty: 16, storageLocation: walkInFreezer, vendors: [{ vendor: usFoods, sku: 'UF-CORN-F', packSize: '12/2.5 lb case', lastCost: 22.00 }], openingLayerCost: 0.73, nutrition: { calories: 86, protein: 3.2, totalFat: 1.2, carbohydrate: 20.6, fiber: 2.4, sugar: 3.5, sodium: 2, servingSize: 82, servingUnit: 'g' } });
  await createItem({ name: 'Frozen Broccoli Florets', category: 'Frozen', portionSize: 4, portionUnit: 'oz', currentQty: 24, reorderPoint: 8, reorderQty: 16, storageLocation: walkInFreezer, vendors: [{ vendor: sysco, sku: 'SY-BROCC-FZ', packSize: '12/2 lb case', lastCost: 30.00 }], openingLayerCost: 1.25, nutrition: { calories: 32, protein: 3.7, totalFat: 0, carbohydrate: 5.9, fiber: 3.3, sodium: 30, calcium: 50, servingSize: 85, servingUnit: 'g' }, allergens: [{ name: 'Vitamin K', severity: 'CONTAINS' }] });
  await createItem({ name: 'Vanilla Ice Cream', category: 'Frozen', portionSize: 4, portionUnit: 'fl oz', currentQty: 20, reorderPoint: 4, reorderQty: 8, storageLocation: walkInFreezer, vendors: [{ vendor: sysco, sku: 'SY-ICE-VAN', packSize: '6/0.5 gal case', lastCost: 36.00 }], openingLayerCost: 1.20, nutrition: { calories: 137, protein: 2.3, totalFat: 7.3, carbohydrate: 16, sugar: 14, sodium: 53, calcium: 84, servingSize: 66, servingUnit: 'g' }, allergens: [{ name: 'Milk', severity: 'CONTAINS' }, { name: 'Eggs', severity: 'CONTAINS' }] });
  await createItem({ name: 'Frozen Fish Fillets — Breaded', category: 'Frozen', portionSize: 4, portionUnit: 'oz', currentQty: 20, reorderPoint: 6, reorderQty: 12, storageLocation: walkInFreezer, vendors: [{ vendor: usFoods, sku: 'UF-FISH-BR', packSize: '10 lb case', lastCost: 48.00 }], openingLayerCost: 4.80, nutrition: { calories: 220, protein: 12, totalFat: 11, carbohydrate: 18, sodium: 490, servingSize: 113, servingUnit: 'g' }, allergens: [{ name: 'Fish', severity: 'CONTAINS' }, { name: 'Wheat', severity: 'CONTAINS' }, { name: 'Eggs', severity: 'CONTAINS' }] });

  // Condiments / Other (5)
  await createItem({ name: 'Vegetable Oil', category: 'Condiments', portionSize: 1, portionUnit: 'tbsp', currentQty: 15, reorderPoint: 3, reorderQty: 6, storageLocation: dryStorage, vendors: [{ vendor: sysco, sku: 'SY-VOIL', packSize: '6/1 gal case', lastCost: 42.00 }], openingLayerCost: 7.00, nutrition: { calories: 124, protein: 0, totalFat: 14, carbohydrate: 0, sodium: 0, servingSize: 14, servingUnit: 'mL' } });
  await createItem({ name: 'Olive Oil — Extra Virgin', category: 'Condiments', portionSize: 1, portionUnit: 'tbsp', currentQty: 8, reorderPoint: 2, reorderQty: 4, storageLocation: dryStorage, vendors: [{ vendor: usFoods, sku: 'UF-EVOIL', packSize: '4/1 gal case', lastCost: 80.00 }], openingLayerCost: 20.00, nutrition: { calories: 119, protein: 0, totalFat: 13.5, carbohydrate: 0, sodium: 0, servingSize: 14, servingUnit: 'mL' } });
  await createItem({ name: 'Salt — Iodized Table', category: 'Condiments', portionSize: 0.25, portionUnit: 'tsp', currentQty: 20, reorderPoint: 5, reorderQty: 10, storageLocation: dryStorage, vendors: [{ vendor: sysco, sku: 'SY-SALT-I', packSize: '6/26 oz case', lastCost: 12.00 }], openingLayerCost: 2.00, nutrition: { calories: 0, protein: 0, totalFat: 0, carbohydrate: 0, sodium: 2325, servingSize: 6, servingUnit: 'g' }, allergens: [{ name: 'Sodium (High)', severity: 'CONTAINS' }] });
  await createItem({ name: 'Black Pepper — Ground', category: 'Condiments', portionSize: 0.25, portionUnit: 'tsp', currentQty: 10, reorderPoint: 2, reorderQty: 4, storageLocation: dryStorage, vendors: [{ vendor: usFoods, sku: 'UF-BPEP-G', packSize: '6/18 oz case', lastCost: 36.00 }], openingLayerCost: 6.00, nutrition: { calories: 6, protein: 0.2, totalFat: 0.1, carbohydrate: 1.5, fiber: 0.6, sodium: 1, servingSize: 2, servingUnit: 'g' } });
  await createItem({ name: 'Ketchup', category: 'Condiments', portionSize: 1, portionUnit: 'tbsp', currentQty: 24, reorderPoint: 6, reorderQty: 12, storageLocation: cannedGoods, vendors: [{ vendor: sysco, sku: 'SY-KETCH', packSize: '6/#10 can case', lastCost: 36.00 }], openingLayerCost: 6.00, nutrition: { calories: 19, protein: 0.3, totalFat: 0.1, carbohydrate: 4.5, sugar: 3.7, sodium: 154, servingSize: 17, servingUnit: 'g' }, allergens: [{ name: 'Sodium (High)', severity: 'CONTAINS' }] });

  console.log('[demo-seed] Items created (46)');
  console.log('[demo-seed] Demo seed complete. Login PIN: 1234');
}

main()
  .catch((e) => {
    console.error('[demo-seed] Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
