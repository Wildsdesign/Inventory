/**
 * Item Edit dialog — mirror of Recipe's design with Inventory additions.
 *
 * Inventory extras vs Recipe:
 *   - Read-only On Hand display in the header
 *   - Reorder Point / Reorder Qty fields
 *   - Primary Vendor dropdown
 *   - No `buttonName` field (Recipe-only concept)
 *   - Create path: when `item` is null, build a blank shell and POST
 */

import { useState, useEffect, FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Save, Loader2, FlaskConical, Package, AlertTriangle } from 'lucide-react';
import {
  itemsApi,
  allergensApi,
  type Item,
  type Allergen,
  type USDASearchResult,
} from '../../lib/items-api';
import { storageLocationsApi } from '../../lib/storage-locations-api';
import { vendorsApi } from '../../lib/vendors-api';
import { AllergenSourceBadge } from '../../components/AllergenSourceBadge';
import { UsdaSearchDialog } from './UsdaSearchDialog';
import { UsdaDetailDialog } from './UsdaDetailDialog';

interface ItemEditDialogProps {
  item: Item | null; // null = create mode
  onClose: () => void;
  onSaved?: () => void;
}

// Core 16 nutrient field definitions — FDA 15 + Phosphorus
const NUTRIENT_GROUPS = [
  {
    group: 'Macronutrients',
    fields: [
      { key: 'calories', label: 'Calories', unit: 'kcal' },
      { key: 'protein', label: 'Protein', unit: 'g' },
      { key: 'totalFat', label: 'Total Fat', unit: 'g' },
      { key: 'saturatedFat', label: 'Sat Fat', unit: 'g' },
      { key: 'transFat', label: 'Trans Fat', unit: 'g' },
      { key: 'carbohydrate', label: 'Carbs', unit: 'g' },
      { key: 'fiber', label: 'Fiber', unit: 'g' },
      { key: 'sugar', label: 'Sugar', unit: 'g' },
      { key: 'addedSugar', label: 'Added Sugar', unit: 'g' },
    ],
  },
  {
    group: 'Minerals & Vitamins',
    fields: [
      { key: 'cholesterol', label: 'Cholesterol', unit: 'mg' },
      { key: 'sodium', label: 'Sodium', unit: 'mg' },
      { key: 'potassium', label: 'Potassium', unit: 'mg' },
      { key: 'calcium', label: 'Calcium', unit: 'mg' },
      { key: 'iron', label: 'Iron', unit: 'mg' },
      { key: 'phosphorus', label: 'Phosphorus', unit: 'mg' },
      { key: 'vitaminD', label: 'Vitamin D', unit: 'IU' },
    ],
  },
] as const;

type NutritionFormState = Record<string, string>;

function buildInitialNutrition(item: Item | null): NutritionFormState {
  const n = item?.nutrition ?? null;
  const out: NutritionFormState = {
    servingSize: n?.servingSize != null ? String(n.servingSize) : '',
    servingUnit: n?.servingUnit || 'g',
    ingredients: n?.ingredients || '',
  };
  for (const group of NUTRIENT_GROUPS) {
    for (const f of group.fields) {
      const v = (n as unknown as Record<string, number | null>)?.[f.key];
      out[f.key] = v != null ? String(v) : '';
    }
  }
  return out;
}

export function ItemEditDialog({ item, onClose, onSaved }: ItemEditDialogProps) {
  const queryClient = useQueryClient();
  const isNew = !item;

  const [name, setName] = useState(item?.name ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [portionSize, setPortionSize] = useState(
    item?.portionSize != null ? String(item.portionSize) : '',
  );
  const [portionUnit, setPortionUnit] = useState(item?.portionUnit ?? '');
  const [storageLocationId, setStorageLocationId] = useState(item?.storageLocationId ?? '');
  const [reorderPoint, setReorderPoint] = useState(
    item?.reorderPoint != null ? String(item.reorderPoint) : '',
  );
  const [reorderQty, setReorderQty] = useState(
    item?.reorderQty != null ? String(item.reorderQty) : '',
  );
  const [primaryVendorId, setPrimaryVendorId] = useState(item?.vendors?.[0]?.vendorId ?? '');
  const [nutrition, setNutrition] = useState<NutritionFormState>(() => buildInitialNutrition(item));
  const [selectedAllergenIds, setSelectedAllergenIds] = useState<Set<string>>(
    () => new Set((item?.allergens ?? []).map((a) => a.allergenId)),
  );
  const [allergenSeverities, setAllergenSeverities] = useState<Record<string, 'CONTAINS' | 'MAY_CONTAIN'>>(
    () => {
      const map: Record<string, 'CONTAINS' | 'MAY_CONTAIN'> = {};
      (item?.allergens ?? []).forEach((a) => {
        map[a.allergenId] = a.severity;
      });
      return map;
    },
  );
  // Per-allergen source tracking so Save doesn't silently downgrade
  // USDA/AI sources to MANUAL unless the user actively changes something.
  const [allergenSources, setAllergenSources] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    (item?.allergens ?? []).forEach((a) => {
      map[a.allergenId] = a.source;
    });
    return map;
  });
  const [error, setError] = useState<string | null>(null);
  const [usdaSearchOpen, setUsdaSearchOpen] = useState(false);
  const [usdaDetailResult, setUsdaDetailResult] = useState<USDASearchResult | null>(null);

  // Load facility allergens (Big 9 seeded)
  const { data: allergensData } = useQuery({
    queryKey: ['allergens'],
    queryFn: () => allergensApi.list(),
  });
  const allAllergens: Allergen[] = allergensData?.allergens || [];

  // Load storage locations for the dropdown
  const { data: storageLocationsData } = useQuery({
    queryKey: ['storage-locations'],
    queryFn: () => storageLocationsApi.list(),
  });
  const storageLocations = storageLocationsData?.locations || [];

  // Load vendors for the primary-vendor dropdown
  const { data: vendorsData } = useQuery({
    queryKey: ['vendors'],
    queryFn: () => vendorsApi.list(),
  });
  const vendors = vendorsData?.vendors || [];

  // Lock body scroll while dialog is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name,
        category: category || null,
        portionSize: portionSize === '' ? null : parseFloat(portionSize),
        portionUnit: portionUnit || null,
        storageLocationId: storageLocationId || null,
        reorderPoint: reorderPoint === '' ? null : parseFloat(reorderPoint),
        reorderQty: reorderQty === '' ? null : parseFloat(reorderQty),
        primaryVendorId: primaryVendorId || null,
        nutrition,
        allergens: Array.from(selectedAllergenIds).map((allergenId) => ({
          allergenId,
          severity: allergenSeverities[allergenId] || 'CONTAINS',
          source: allergenSources[allergenId] || 'MANUAL',
        })),
      };
      return isNew ? itemsApi.create(payload) : itemsApi.update(item!.id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      onSaved?.();
      onClose();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Save failed');
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    saveMutation.mutate();
  };

  const updateNutritionField = (key: string, value: string) => {
    setNutrition((prev) => ({ ...prev, [key]: value }));
  };

  const toggleAllergen = (allergenId: string, checked: boolean) => {
    const next = new Set(selectedAllergenIds);
    if (checked) {
      next.add(allergenId);
      setAllergenSeverities((prev) => ({ ...prev, [allergenId]: prev[allergenId] || 'CONTAINS' }));
      setAllergenSources((prev) => ({ ...prev, [allergenId]: 'MANUAL' }));
    } else {
      next.delete(allergenId);
    }
    setSelectedAllergenIds(next);
  };

  const setAllergenSeverity = (allergenId: string, severity: 'CONTAINS' | 'MAY_CONTAIN') => {
    setAllergenSeverities((prev) => ({ ...prev, [allergenId]: severity }));
    setAllergenSources((prev) => ({ ...prev, [allergenId]: 'MANUAL' }));
  };

  // Nutrition source badge
  const sourceBadge = (() => {
    const source = item?.nutrition?.source;
    if (!source) return null;
    if (source === 'usda') {
      const parts = ['USDA Verified'];
      if (item?.nutrition?.usdaFdcId) parts.push(`FDC ID: ${item.nutrition.usdaFdcId}`);
      if (item?.nutrition?.lastEnrichedAt) {
        parts.push(`Last enriched: ${new Date(item.nutrition.lastEnrichedAt).toLocaleDateString()}`);
      }
      return { text: parts.join(' · '), cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    }
    if (source === 'manual_modified') {
      return { text: 'Manual (modified from USDA)', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
    }
    if (source === 'healthtouch') {
      return { text: 'HealthTouch original', cls: 'bg-blue-50 text-blue-700 border-blue-200' };
    }
    return { text: 'Manually entered', cls: 'bg-slate-50 text-slate-600 border-slate-200' };
  })();

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-3xl w-full my-8 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-emerald-600" />
              <h2 className="text-lg font-semibold text-slate-900">
                {isNew ? 'Add Item' : 'Edit Item'}
              </h2>
            </div>
            {!isNew && (
              <div className="flex items-center gap-3 mt-1">
                <p className="text-xs text-slate-500">
                  On hand:{' '}
                  <span
                    className={`font-semibold ${item!.isLowStock ? 'text-amber-600' : 'text-slate-900'}`}
                  >
                    {item!.currentQty}
                    {item!.portionUnit ? ` ${item!.portionUnit}` : ''}
                  </span>
                  {item!.itemCost != null && (
                    <>
                      {' · '}Avg cost:{' '}
                      <span className="font-semibold text-slate-900">
                        ${item!.itemCost.toFixed(4)}
                      </span>
                    </>
                  )}
                </p>
                {item!.isLowStock && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                    <AlertTriangle className="h-3 w-3" />
                    Low stock
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 text-slate-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="px-6 py-4 space-y-6">
            {/* Error */}
            {error && (
              <div className="rounded-md bg-red-50 border border-red-200 text-red-800 text-sm p-3">
                {error}
              </div>
            )}

            {/* Basic info */}
            <section>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
                Basic Info
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name *">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </Field>
                <Field label="Category">
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="e.g. Protein"
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </Field>
                <Field label="Portion">
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="any"
                      value={portionSize}
                      onChange={(e) => setPortionSize(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <input
                      type="text"
                      value={portionUnit}
                      onChange={(e) => setPortionUnit(e.target.value)}
                      placeholder="oz"
                      className="w-16 px-3 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </Field>
                <Field label="Storage Location">
                  <select
                    value={storageLocationId}
                    onChange={(e) => setStorageLocationId(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">— Unassigned —</option>
                    {storageLocations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Reorder Point">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={reorderPoint}
                    onChange={(e) => setReorderPoint(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </Field>
                <Field label="Reorder Qty">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={reorderQty}
                    onChange={(e) => setReorderQty(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </Field>
                <Field label="Primary Vendor">
                  <select
                    value={primaryVendorId}
                    onChange={(e) => setPrimaryVendorId(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">— None —</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </section>

            {/* Nutrition */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
                  Nutrition
                </h3>
                {!isNew && (
                  <button
                    type="button"
                    onClick={() => setUsdaSearchOpen(true)}
                    className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                  >
                    <FlaskConical className="h-3.5 w-3.5" />
                    USDA Lookup
                  </button>
                )}
              </div>

              {sourceBadge && (
                <div
                  className={`inline-block text-xs px-2 py-1 rounded border mb-3 ${sourceBadge.cls}`}
                >
                  {sourceBadge.text}
                </div>
              )}

              {/* Serving size */}
              <div className="flex items-center gap-2 mb-4">
                <label className="text-xs text-slate-600 w-24">Serving Size</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={nutrition.servingSize}
                  onChange={(e) => updateNutritionField('servingSize', e.target.value)}
                  className="w-20 h-8 text-xs border border-slate-300 rounded px-2 text-right"
                  placeholder="100"
                />
                <select
                  value={nutrition.servingUnit}
                  onChange={(e) => updateNutritionField('servingUnit', e.target.value)}
                  className="h-8 text-xs border border-slate-300 rounded px-1"
                >
                  <option value="g">g</option>
                  <option value="oz">oz</option>
                  <option value="ml">mL</option>
                  <option value="cup">cup</option>
                  <option value="each">each</option>
                  <option value="slice">slice</option>
                  <option value="tbsp">tbsp</option>
                </select>
              </div>

              {/* Nutrient groups */}
              {NUTRIENT_GROUPS.map(({ group, fields }) => (
                <div key={group} className="mb-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1.5">
                    {group}
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                    {fields.map(({ key, label, unit }) => (
                      <div key={key} className="flex items-center gap-2">
                        <label className="text-xs text-slate-600 w-24 shrink-0">{label}</label>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={nutrition[key] ?? ''}
                          onChange={(e) => updateNutritionField(key, e.target.value)}
                          className="w-20 h-7 text-xs border border-slate-300 rounded px-2 text-right"
                        />
                        <span className="text-[10px] text-slate-500 w-6">{unit}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Ingredients */}
              <div className="mt-4">
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1 block">
                  Ingredients
                </label>
                <textarea
                  rows={3}
                  value={nutrition.ingredients}
                  onChange={(e) => updateNutritionField('ingredients', e.target.value)}
                  placeholder="Ingredient list (from vendor label, USDA, or manual entry)"
                  className="w-full text-xs border border-slate-300 rounded px-3 py-2 resize-y"
                />
              </div>
            </section>

            {/* Allergens + Drug Interactions — grouped by category */}
            {(() => {
              const allergens = allAllergens.filter(
                (a) => (a.category || 'ALLERGEN') === 'ALLERGEN',
              );
              const drugInteractions = allAllergens.filter(
                (a) => a.category === 'DRUG_INTERACTION',
              );

              const renderGrid = (items: typeof allAllergens) => (
                <div className="grid grid-cols-3 gap-3">
                  {items.map((a) => {
                    const checked = selectedAllergenIds.has(a.id);
                    const severity = allergenSeverities[a.id] || 'CONTAINS';
                    return (
                      <div key={a.id} className="space-y-1">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => toggleAllergen(a.id, e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="text-sm text-slate-700">{a.name}</span>
                        </label>
                        {checked && (
                          <div className="ml-6 flex items-center gap-3 text-xs">
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="radio"
                                name={`severity-${a.id}`}
                                checked={severity === 'CONTAINS'}
                                onChange={() => setAllergenSeverity(a.id, 'CONTAINS')}
                                className="w-3 h-3"
                              />
                              Contains
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="radio"
                                name={`severity-${a.id}`}
                                checked={severity === 'MAY_CONTAIN'}
                                onChange={() => setAllergenSeverity(a.id, 'MAY_CONTAIN')}
                                className="w-3 h-3"
                              />
                              May Contain
                            </label>
                            <AllergenSourceBadge source={allergenSources[a.id] || 'MANUAL'} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );

              return (
                <>
                  <section className="border border-red-200 rounded-lg p-4">
                    <h3 className="text-xs uppercase tracking-wider text-red-500 font-semibold mb-3">
                      Allergens
                    </h3>
                    {allergens.length === 0 ? (
                      <p className="text-sm text-slate-500 italic">
                        No allergens seeded for this facility yet.
                      </p>
                    ) : (
                      renderGrid(allergens)
                    )}
                  </section>

                  {drugInteractions.length > 0 && (
                    <section className="border border-purple-200 rounded-lg p-4">
                      <h3 className="text-xs uppercase tracking-wider text-purple-500 font-semibold mb-3">
                        Drug Interactions
                      </h3>
                      {renderGrid(drugInteractions)}
                    </section>
                  )}
                </>
              );
            })()}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-slate-200 bg-slate-50">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-700 rounded hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {isNew ? 'Create Item' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>

      {/* USDA dialogs — rendered on top of the edit dialog (edit mode only) */}
      {!isNew && usdaSearchOpen && (
        <UsdaSearchDialog
          item={item!}
          onClose={() => setUsdaSearchOpen(false)}
          onSelectResult={(result) => setUsdaDetailResult(result)}
        />
      )}
      {!isNew && usdaDetailResult && (
        <UsdaDetailDialog
          item={item!}
          result={usdaDetailResult}
          onClose={() => setUsdaDetailResult(null)}
          onApplied={() => {
            setUsdaDetailResult(null);
            setUsdaSearchOpen(false);
            queryClient.invalidateQueries({ queryKey: ['items'] });
            onClose();
          }}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  );
}
