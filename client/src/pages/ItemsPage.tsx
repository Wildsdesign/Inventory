/**
 * Items page — feature-parity sibling of Recipe's ItemsPage.
 *
 * Layout is deliberately identical to Recipe (stat cards, search + filter
 * pills, table) so an operator moving between the apps feels at home.
 *
 * Inventory divergences:
 *   - Fourth stat card is "Low Stock" (Recipe shows "Recipes")
 *   - Extra columns: On Hand, Avg Cost, Vendor
 *   - Extra filter pill: "Low stock"
 *   - No Recipe/Singles filters, no ChefHat icon, no isRecipe flag
 *   - Trash icon delete with confirm
 *   - Plus button in the header to create a new item
 */

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Edit,
  Package,
  ShieldAlert,
  FlaskConical,
  CheckCircle2,
  Loader2,
  Plus,
  Trash2,
  AlertTriangle,
  X,
} from 'lucide-react';
import { AllergenSourceBadge } from '../components/AllergenSourceBadge';
import { itemsApi, allergensApi, type Item, type USDASearchResult } from '../lib/items-api';
import { ItemEditDialog } from './items/ItemEditDialog';
import { UsdaSearchDialog } from './items/UsdaSearchDialog';
import { UsdaDetailDialog } from './items/UsdaDetailDialog';

type FilterKey = 'all' | 'lowStock' | 'needsNutrition' | 'needsAllergens';

type Toast = { type: 'success' | 'error' | 'info'; message: string } | null;

export function ItemsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [usdaSearchItem, setUsdaSearchItem] = useState<Item | null>(null);
  const [usdaDetailResult, setUsdaDetailResult] = useState<USDASearchResult | null>(null);
  const [aiDetectingId, setAiDetectingId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['items'],
    queryFn: () => itemsApi.list(),
  });

  // Auto-dismiss toast after 5 seconds
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // AI allergen detection
  const aiAllergenMutation = useMutation({
    mutationFn: (itemId: string) => allergensApi.detectAI(itemId),
    onMutate: (itemId) => {
      setAiDetectingId(itemId);
      setToast(null);
    },
    onSuccess: (result, itemId) => {
      const item = data?.items.find((i) => i.id === itemId);
      const itemName = item?.name || 'item';

      if (result.applied === 0) {
        setToast({
          type: 'info',
          message: `No allergens detected for ${itemName}`,
        });
      } else {
        const names = result.allergens.map((a) => a.allergenName).join(', ');
        setToast({
          type: 'success',
          message: `${itemName}: ${result.applied} allergen${result.applied === 1 ? '' : 's'} added${names ? ` (${names})` : ''}`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (err: unknown) => {
      setToast({
        type: 'error',
        message: `AI detection failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    },
    onSettled: () => {
      setAiDetectingId(null);
    },
  });

  // Delete
  const deleteMutation = useMutation({
    mutationFn: (id: string) => itemsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      setToast({ type: 'success', message: 'Item deleted' });
    },
    onError: (err: unknown) => {
      setToast({
        type: 'error',
        message: `Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    },
  });

  const filteredItems = useMemo(() => {
    if (!data) return [];
    let items = data.items;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.category && i.category.toLowerCase().includes(q)) ||
          (i.healthTouchItemId && i.healthTouchItemId.toLowerCase().includes(q)),
      );
    }

    switch (filter) {
      case 'lowStock':
        items = items.filter((i) => i.isLowStock);
        break;
      case 'needsNutrition':
        items = items.filter((i) => i.nutrition === null);
        break;
      case 'needsAllergens':
        items = items.filter((i) => i.allergens.length === 0);
        break;
    }

    return items;
  }, [data, search, filter]);

  const stats = useMemo(() => {
    if (!data) return { total: 0, enriched: 0, withAllergens: 0, lowStock: 0 };
    return {
      total: data.items.length,
      enriched: data.items.filter((i) => i.nutrition !== null).length,
      withAllergens: data.items.filter((i) => i.allergens.length > 0).length,
      lowStock: data.items.filter((i) => i.isLowStock).length,
    };
  }, [data]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Items</h1>
          <p className="text-sm text-slate-600">
            Manage inventory items. Enrich with USDA nutrition and AI-detected allergens.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Item
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total items"
          value={stats.total}
          icon={<Package className="h-4 w-4" />}
          color="slate"
        />
        <StatCard
          label="Enriched"
          value={`${stats.enriched}/${stats.total}`}
          icon={<CheckCircle2 className="h-4 w-4" />}
          color="emerald"
        />
        <StatCard
          label="With allergens"
          value={`${stats.withAllergens}/${stats.total}`}
          icon={<ShieldAlert className="h-4 w-4" />}
          color="amber"
        />
        <StatCard
          label="Low stock"
          value={stats.lowStock}
          icon={<AlertTriangle className="h-4 w-4" />}
          color="red"
        />
      </div>

      {/* Search + filter bar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-md min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or category..."
            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />
        </div>
        <div className="flex gap-1 text-sm">
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </FilterChip>
          <FilterChip active={filter === 'lowStock'} onClick={() => setFilter('lowStock')}>
            Low stock
          </FilterChip>
          <FilterChip
            active={filter === 'needsNutrition'}
            onClick={() => setFilter('needsNutrition')}
          >
            Needs nutrition
          </FilterChip>
          <FilterChip
            active={filter === 'needsAllergens'}
            onClick={() => setFilter('needsAllergens')}
          >
            Needs allergens
          </FilterChip>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Loading items...</div>
        ) : filteredItems.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            <Package className="h-12 w-12 mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-medium">
              {data?.items.length === 0 ? 'No items yet' : 'No items match your filters'}
            </p>
            <p className="text-xs mt-1">
              {data?.items.length === 0
                ? 'Add your first item or import a vendor invoice.'
                : 'Try adjusting your search or filters.'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-700">Item</th>
                <th className="text-right px-4 py-2 font-medium text-slate-700">On Hand</th>
                <th className="text-right px-4 py-2 font-medium text-slate-700">Avg Cost</th>
                <th className="text-left px-4 py-2 font-medium text-slate-700">Storage</th>
                <th className="text-left px-4 py-2 font-medium text-slate-700">Vendor</th>
                <th className="text-left px-4 py-2 font-medium text-slate-700">Nutrition</th>
                <th className="text-left px-4 py-2 font-medium text-slate-700">Allergens</th>
                <th className="text-right px-4 py-2 font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr
                  key={item.id}
                  className={`border-b border-slate-100 hover:bg-slate-50 ${
                    item.isLowStock ? 'bg-amber-50/30' : ''
                  }`}
                >
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-slate-400 shrink-0" />
                      <span className="font-medium text-slate-900">{item.name}</span>
                      {item.category && (
                        <span className="text-[10px] text-slate-500 bg-slate-100 border border-slate-200 rounded px-1">
                          {item.category}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex items-center gap-1 justify-end">
                      {item.isLowStock && (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      )}
                      <span
                        className={`font-medium ${
                          item.isLowStock ? 'text-amber-600' : 'text-slate-900'
                        }`}
                      >
                        {item.currentQty}
                      </span>
                      {item.portionUnit && (
                        <span className="text-slate-400 text-xs ml-1">{item.portionUnit}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right text-slate-600">
                    {item.itemCost != null ? `$${item.itemCost.toFixed(4)}` : '—'}
                  </td>
                  <td className="px-4 py-2">
                    {item.storageLocationName ? (
                      <span className="text-slate-600">{item.storageLocationName}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {item.vendors.length > 0 ? (
                      <div className="flex items-center gap-1">
                        <span className="text-slate-600">{item.vendors[0].vendorName}</span>
                        {item.vendors.length > 1 && (
                          <span className="text-[10px] text-slate-500">
                            +{item.vendors.length - 1}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {item.nutrition?.calories != null ? (
                      <span className="inline-flex items-center gap-1 text-xs">
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                        <span className="text-slate-600">
                          {Math.round(item.nutrition.calories)} kcal
                        </span>
                        {item.nutrition.source === 'usda' && (
                          <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-medium border border-emerald-200">
                            USDA
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Not set</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {item.allergens.length > 0 ? (
                      <div className="flex flex-wrap gap-0.5">
                        {item.allergens.slice(0, 6).map((a) => {
                          const isDI = a.category === 'DRUG_INTERACTION';
                          return (
                            <span
                              key={a.id}
                              className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium border ${
                                isDI
                                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                                  : a.severity === 'CONTAINS'
                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-slate-50 text-slate-600 border-slate-200'
                              }`}
                              title={`${isDI ? 'Drug Interaction' : a.severity} · ${a.source}`}
                            >
                              {a.allergenName}
                              <AllergenSourceBadge source={a.source} />
                            </span>
                          );
                        })}
                        {item.allergens.length > 6 && (
                          <span className="text-[9px] text-slate-500">
                            +{item.allergens.length - 6}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">None</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <ActionButton
                        title="USDA Lookup"
                        onClick={() => setUsdaSearchItem(item)}
                      >
                        <FlaskConical className="h-4 w-4 text-emerald-600" />
                      </ActionButton>
                      <ActionButton
                        title="AI Allergen Detection"
                        onClick={() => aiAllergenMutation.mutate(item.id)}
                        disabled={aiDetectingId !== null}
                      >
                        {aiDetectingId === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
                        ) : (
                          <ShieldAlert className="h-4 w-4 text-purple-600" />
                        )}
                      </ActionButton>
                      <ActionButton title="Edit" onClick={() => setEditingItem(item)}>
                        <Edit className="h-4 w-4" />
                      </ActionButton>
                      <ActionButton
                        title="Delete"
                        onClick={() => {
                          if (confirm(`Delete "${item.name}"? This cannot be undone.`)) {
                            deleteMutation.mutate(item.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </ActionButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Toast notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-start gap-3 max-w-md rounded-lg shadow-lg border p-4 ${
            toast.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : toast.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-900'
                : 'bg-slate-50 border-slate-200 text-slate-900'
          }`}
        >
          {toast.type === 'success' && (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          )}
          {toast.type === 'error' && (
            <ShieldAlert className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          )}
          {toast.type === 'info' && (
            <ShieldAlert className="h-5 w-5 text-slate-600 shrink-0 mt-0.5" />
          )}
          <p className="text-sm flex-1">{toast.message}</p>
          <button
            onClick={() => setToast(null)}
            className="text-slate-500 hover:text-slate-700 shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {(editingItem || showCreate) && (
        <ItemEditDialog
          item={editingItem}
          onClose={() => {
            setEditingItem(null);
            setShowCreate(false);
          }}
        />
      )}
      {usdaSearchItem && (
        <UsdaSearchDialog
          item={usdaSearchItem}
          onClose={() => setUsdaSearchItem(null)}
          onSelectResult={(result) => setUsdaDetailResult(result)}
        />
      )}
      {usdaSearchItem && usdaDetailResult && (
        <UsdaDetailDialog
          item={usdaSearchItem}
          result={usdaDetailResult}
          onClose={() => setUsdaDetailResult(null)}
          onApplied={() => {
            setUsdaDetailResult(null);
            setUsdaSearchItem(null);
          }}
        />
      )}
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: 'slate' | 'emerald' | 'amber' | 'blue' | 'red';
}) {
  const colors = {
    slate: 'bg-slate-50 text-slate-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    blue: 'bg-blue-50 text-blue-700',
    red: 'bg-red-50 text-red-700',
  };
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-600">{label}</span>
        <div className={`rounded-md p-1 ${colors[color]}`}>{icon}</div>
      </div>
      <div className="text-xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${
        active
          ? 'bg-emerald-600 border-emerald-600 text-white'
          : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}

function ActionButton({
  onClick,
  title,
  disabled,
  children,
}: {
  onClick?: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="p-1.5 rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}
