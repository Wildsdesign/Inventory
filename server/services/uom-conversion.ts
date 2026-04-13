/**
 * Global UOM conversion — weight, volume, count.
 *
 * Per-spec decision: Inventory uses GLOBAL conversions only. No per-item
 * conversions. If a unit doesn't convert to the base unit, the operation
 * returns an error and the caller handles it gracefully.
 *
 * Base units:
 *   WEIGHT → ounces (oz)
 *   VOLUME → fluid ounces (floz)
 *   COUNT  → each (ea)
 *
 * Cross-type conversions (oz ↔ floz) use the water approximation
 * (1 floz water ≈ 1.043 oz weight). Operators should set consistent
 * units on their items rather than rely on cross-type.
 */

export type UnitType = 'weight' | 'volume' | 'count';

interface UnitDef {
  type: UnitType;
  toBase: number; // multiplier to convert 1 unit to base
  aliases: string[]; // normalized names that map here
}

const UNIT_DEFINITIONS: Record<string, UnitDef> = {
  // WEIGHT (base: oz)
  oz: { type: 'weight', toBase: 1, aliases: ['oz', 'ounce', 'ounces'] },
  lb: { type: 'weight', toBase: 16, aliases: ['lb', 'lbs', 'pound', 'pounds'] },
  g: { type: 'weight', toBase: 0.035274, aliases: ['g', 'gram', 'grams', 'gm'] },
  kg: { type: 'weight', toBase: 35.274, aliases: ['kg', 'kilogram', 'kilograms'] },
  mg: { type: 'weight', toBase: 0.0000352739, aliases: ['mg', 'milligram', 'milligrams'] },

  // VOLUME (base: floz)
  floz: { type: 'volume', toBase: 1, aliases: ['floz', 'fl oz', 'fluid ounce', 'fluid ounces'] },
  cup: { type: 'volume', toBase: 8, aliases: ['cup', 'cups', 'c'] },
  tbsp: { type: 'volume', toBase: 0.5, aliases: ['tbsp', 'tablespoon', 'tablespoons', 'T'] },
  tsp: { type: 'volume', toBase: 0.166667, aliases: ['tsp', 'teaspoon', 'teaspoons', 't'] },
  pint: { type: 'volume', toBase: 16, aliases: ['pint', 'pints', 'pt'] },
  quart: { type: 'volume', toBase: 32, aliases: ['quart', 'quarts', 'qt'] },
  gallon: { type: 'volume', toBase: 128, aliases: ['gallon', 'gallons', 'gal'] },
  ml: { type: 'volume', toBase: 0.033814, aliases: ['ml', 'milliliter', 'milliliters', 'mL'] },
  l: { type: 'volume', toBase: 33.814, aliases: ['l', 'liter', 'liters', 'L'] },

  // COUNT (base: each)
  each: { type: 'count', toBase: 1, aliases: ['each', 'ea', 'unit', 'units', 'piece', 'pieces'] },
  dozen: { type: 'count', toBase: 12, aliases: ['dozen', 'doz', 'dz'] },
  slice: { type: 'count', toBase: 1, aliases: ['slice', 'slices'] },
};

// Build alias lookup table for fast normalization
const ALIAS_TO_KEY: Record<string, string> = {};
for (const [key, def] of Object.entries(UNIT_DEFINITIONS)) {
  for (const alias of def.aliases) {
    ALIAS_TO_KEY[alias.toLowerCase()] = key;
  }
}

function normalizeUnit(unit: string): string | null {
  const trimmed = unit.trim().toLowerCase();
  return ALIAS_TO_KEY[trimmed] || null;
}

export interface ConversionResult {
  success: boolean;
  convertedQuantity?: number;
  factor?: number;
  error?: string;
}

/**
 * Convert a quantity from one unit to another.
 * Returns { success: false, error } if units are incompatible or unknown.
 */
export function convert(quantity: number, fromUnit: string, toUnit: string): ConversionResult {
  const fromKey = normalizeUnit(fromUnit);
  const toKey = normalizeUnit(toUnit);

  if (!fromKey) {
    return { success: false, error: `Unknown unit: "${fromUnit}"` };
  }
  if (!toKey) {
    return { success: false, error: `Unknown unit: "${toUnit}"` };
  }

  // Same unit — no conversion needed
  if (fromKey === toKey) {
    return { success: true, convertedQuantity: quantity, factor: 1 };
  }

  const fromDef = UNIT_DEFINITIONS[fromKey];
  const toDef = UNIT_DEFINITIONS[toKey];

  // Same type — direct conversion via base
  if (fromDef.type === toDef.type) {
    const factor = fromDef.toBase / toDef.toBase;
    return {
      success: true,
      convertedQuantity: quantity * factor,
      factor,
    };
  }

  // Different types — incompatible
  return {
    success: false,
    error: `Cannot convert ${fromDef.type} (${fromUnit}) to ${toDef.type} (${toUnit})`,
  };
}

/**
 * Check if two units are compatible without actually converting.
 */
export function areCompatible(unitA: string, unitB: string): boolean {
  const keyA = normalizeUnit(unitA);
  const keyB = normalizeUnit(unitB);
  if (!keyA || !keyB) return false;
  return UNIT_DEFINITIONS[keyA].type === UNIT_DEFINITIONS[keyB].type;
}

/**
 * Get the type (weight/volume/count) of a unit, or null if unknown.
 */
export function getUnitType(unit: string): UnitType | null {
  const key = normalizeUnit(unit);
  if (!key) return null;
  return UNIT_DEFINITIONS[key].type;
}
