/**
 * USDA Detail dialog — mirror of Recipe's implementation.
 * Shows grouped nutrients (Macros / Minerals / Vitamins) and applies
 * selected food to the item.
 */

import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  usdaApi,
  type USDASearchResult,
  type USDADetail,
  type Item,
} from '../../lib/items-api';

interface UsdaDetailDialogProps {
  item: Item;
  result: USDASearchResult;
  onClose: () => void;
  onApplied: () => void;
}

function NutrientRow({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | null | undefined;
  unit: string;
}) {
  if (value == null) return null;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">{label}:</span>
      <span className="font-medium text-slate-900">
        {Math.round(value * 10) / 10}
        {unit}
      </span>
    </div>
  );
}

export function UsdaDetailDialog({ item, result, onClose, onApplied }: UsdaDetailDialogProps) {
  const queryClient = useQueryClient();
  const [overwrite, setOverwrite] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Fetch full USDA detail by FDC ID (includes all nutrients, not just the preview)
  const { data: detail, isLoading } = useQuery({
    queryKey: ['usda-detail', result.fdcId],
    queryFn: () => usdaApi.detail(result.fdcId),
  });

  const applyMutation = useMutation({
    mutationFn: () => usdaApi.apply(item.id, result.fdcId, overwrite),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      onApplied();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Apply failed');
    },
  });

  // Use detail data once loaded, otherwise fall back to preview from search
  const display: USDADetail | null = detail || null;
  const mapped = display?.mapped || result.nutrientPreview || {};
  const ingredients = display?.ingredients || result.ingredients;
  const servingSize = display?.servingSize || result.servingSize;
  const servingUnit = display?.servingSizeUnit || result.servingSizeUnit;
  const brandOwner = display?.brandOwner || result.brandOwner;
  const brandName = display?.brandName || result.brandName;

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-slate-900 truncate">{result.description}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {result.dataType} · FDC ID: {result.fdcId}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 text-slate-500 ml-2 shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {isLoading && (
            <div className="text-center text-slate-500 py-6">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
              <span className="text-sm">Loading full nutrition detail...</span>
            </div>
          )}

          {error && (
            <div className="rounded bg-red-50 border border-red-200 text-red-800 text-sm p-3">
              {error}
            </div>
          )}

          {!isLoading && (
            <>
              {/* Macros */}
              <Section title="Macros">
                <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                  <NutrientRow label="Calories" value={mapped.calories} unit=" kcal" />
                  <NutrientRow label="Protein" value={mapped.protein} unit="g" />
                  <NutrientRow label="Carbohydrates" value={mapped.carbohydrate} unit="g" />
                  <NutrientRow label="Total Fat" value={mapped.totalFat} unit="g" />
                  <NutrientRow label="Saturated Fat" value={mapped.saturatedFat} unit="g" />
                  <NutrientRow label="Trans Fat" value={mapped.transFat} unit="g" />
                  <NutrientRow label="Fiber" value={mapped.fiber} unit="g" />
                  <NutrientRow label="Sugar" value={mapped.sugar} unit="g" />
                  <NutrientRow label="Added Sugar" value={mapped.addedSugar} unit="g" />
                  <NutrientRow label="Cholesterol" value={mapped.cholesterol} unit="mg" />
                </div>
              </Section>

              {/* Minerals */}
              <Section title="Minerals">
                <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                  <NutrientRow label="Sodium" value={mapped.sodium} unit="mg" />
                  <NutrientRow label="Potassium" value={mapped.potassium} unit="mg" />
                  <NutrientRow label="Calcium" value={mapped.calcium} unit="mg" />
                  <NutrientRow label="Iron" value={mapped.iron} unit="mg" />
                  <NutrientRow label="Phosphorus" value={mapped.phosphorus} unit="mg" />
                  <NutrientRow label="Magnesium" value={mapped.magnesium} unit="mg" />
                  <NutrientRow label="Zinc" value={mapped.zinc} unit="mg" />
                </div>
              </Section>

              {/* Vitamins */}
              <Section title="Vitamins">
                <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                  <NutrientRow label="Vitamin A" value={mapped.vitaminA} unit="µg" />
                  <NutrientRow label="Vitamin C" value={mapped.vitaminC} unit="mg" />
                  <NutrientRow label="Vitamin D" value={mapped.vitaminD} unit="IU" />
                </div>
              </Section>

              {/* Serving + Source */}
              <div className="grid grid-cols-2 gap-8">
                <Section title="Serving">
                  <div className="space-y-1 text-sm">
                    {servingSize ? (
                      <p>
                        <span className="text-slate-600">Size:</span>{' '}
                        <span className="font-medium">
                          {servingSize} {servingUnit || ''}
                        </span>
                      </p>
                    ) : (
                      <p className="text-slate-400 italic">Not specified</p>
                    )}
                  </div>
                </Section>
                <Section title="Source">
                  <div className="space-y-1 text-sm">
                    <p>
                      <span className="text-slate-600">Brand:</span>{' '}
                      <span className="font-medium">{brandOwner || brandName || '—'}</span>
                    </p>
                    <p>
                      <span className="text-slate-600">Data Type:</span>{' '}
                      <span className="font-medium">{result.dataType}</span>
                    </p>
                  </div>
                </Section>
              </div>

              {/* Ingredients */}
              {ingredients && (
                <Section title="Ingredients">
                  <p className="text-sm text-slate-700 leading-relaxed">{ingredients}</p>
                </Section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-200">
            <label className="flex items-center gap-2 text-sm cursor-pointer flex-1">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-slate-700">Overwrite existing nutrition</span>
            </label>
            {overwrite && (
              <span className="flex items-center gap-1 text-xs text-amber-700">
                <AlertTriangle className="h-3 w-3" />
                Replaces all values
              </span>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 px-6 py-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-700 rounded hover:bg-slate-200"
            >
              Close
            </button>
            <button
              onClick={() => {
                setError(null);
                applyMutation.mutate();
              }}
              disabled={applyMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {applyMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Apply to Item
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-emerald-600 uppercase tracking-wider border-b border-slate-200 pb-1 mb-2">
        {title}
      </h4>
      {children}
    </div>
  );
}
