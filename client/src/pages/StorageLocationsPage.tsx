/**
 * Storage Locations — facility-scoped CRUD with setup wizard.
 *
 * Unified with Recipe so both apps share the exact same page. Two entry
 * points:
 *   1. Setup Wizard — opens a dialog with the standard hospital kitchen
 *      template (30 locations across 6 categories). Operator picks what
 *      they want, clicks "Create selected", done.
 *   2. Manual CRUD — add/edit/delete individual locations, reorder with
 *      up/down arrows for the walking order.
 *
 * The walking order (sortOrder) controls how locations group in reports
 * and pull lists — a facility arranges it to match their actual physical
 * kitchen layout.
 */

import { useState, FormEvent, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package,
  Plus,
  Edit,
  Trash2,
  ChevronUp,
  ChevronDown,
  X,
  Snowflake,
  Thermometer,
  Wheat,
  AlertCircle,
  Sparkles,
  CheckSquare,
  Factory,
  Truck,
  Star,
} from 'lucide-react';
import {
  storageLocationsApi,
  type StorageLocation,
  type TemplateCategory,
} from '../lib/storage-locations-api';

const CATEGORIES = [
  { value: 'refrigerated', label: 'Refrigerated', icon: Thermometer, color: 'blue' },
  { value: 'frozen', label: 'Frozen', icon: Snowflake, color: 'cyan' },
  { value: 'dry', label: 'Dry Storage', icon: Wheat, color: 'amber' },
  { value: 'production', label: 'Production', icon: Factory, color: 'purple' },
  { value: 'receiving', label: 'Receiving', icon: Truck, color: 'slate' },
  { value: 'specialty', label: 'Specialty', icon: Star, color: 'emerald' },
] as const;

type CategoryValue = (typeof CATEGORIES)[number]['value'];

function categoryLabel(value: string | null): string {
  if (!value) return 'Uncategorized';
  const match = CATEGORIES.find((c) => c.value === value);
  return match?.label ?? value;
}

function categoryBadgeStyle(value: string | null): string {
  if (!value) return 'bg-slate-100 text-slate-700 border-slate-200';
  const palette: Record<string, string> = {
    refrigerated: 'bg-blue-50 text-blue-700 border-blue-200',
    frozen: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    dry: 'bg-amber-50 text-amber-700 border-amber-200',
    production: 'bg-purple-50 text-purple-700 border-purple-200',
    receiving: 'bg-slate-50 text-slate-700 border-slate-200',
    specialty: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  return palette[value] ?? 'bg-slate-100 text-slate-700 border-slate-200';
}

function CategoryIcon({ category }: { category: string | null }) {
  const match = CATEGORIES.find((c) => c.value === category);
  if (!match) return <Package className="h-4 w-4" />;
  const Icon = match.icon;
  return <Icon className="h-4 w-4" />;
}

export function StorageLocationsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<StorageLocation | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['storage-locations'],
    queryFn: () => storageLocationsApi.list(),
  });

  const reorderMutation = useMutation({
    mutationFn: (order: Array<{ id: string; sortOrder: number }>) =>
      storageLocationsApi.reorder(order),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['storage-locations'] }),
    onError: (e) => setError(e instanceof Error ? e.message : 'Reorder failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => storageLocationsApi.delete(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['storage-locations'] }),
    onError: (e) => setError(e instanceof Error ? e.message : 'Delete failed'),
  });

  const locations = data?.locations ?? [];

  const moveLocation = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= locations.length) return;
    const a = locations[index];
    const b = locations[newIndex];
    reorderMutation.mutate([
      { id: a.id, sortOrder: b.sortOrder },
      { id: b.id, sortOrder: a.sortOrder },
    ]);
  };

  const handleDelete = (loc: StorageLocation) => {
    if (loc.itemCount > 0) {
      setError(
        `Cannot delete "${loc.name}" — ${loc.itemCount} item${loc.itemCount === 1 ? '' : 's'} still reference it. Reassign them first.`,
      );
      return;
    }
    if (!confirm(`Delete "${loc.name}"?`)) return;
    deleteMutation.mutate(loc.id);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
            <Package className="h-6 w-6 text-emerald-600" />
            Storage Locations
          </h1>
          <p className="text-sm text-slate-600">
            Walking order for your kitchen. Use arrows to arrange by your physical layout.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWizardOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 text-sm font-medium"
          >
            <Sparkles className="h-4 w-4" />
            Setup Wizard
          </button>
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50 text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Add Custom
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded bg-red-50 border border-red-200 text-red-800 text-sm p-3">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Loading...</div>
        ) : locations.length === 0 ? (
          <div className="p-12 text-center">
            <Package className="h-12 w-12 mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-medium text-slate-700">No storage locations yet</p>
            <p className="text-xs text-slate-500 mt-1 mb-4">
              Start with the Setup Wizard to add standard hospital kitchen locations.
            </p>
            <button
              onClick={() => setWizardOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 text-sm font-medium"
            >
              <Sparkles className="h-4 w-4" />
              Open Setup Wizard
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-slate-700 w-20">Walk Order</th>
                <th className="text-left px-4 py-2 font-medium text-slate-700">Name</th>
                <th className="text-left px-4 py-2 font-medium text-slate-700">Category</th>
                <th className="text-left px-4 py-2 font-medium text-slate-700">Items</th>
                <th className="text-right px-4 py-2 font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc, idx) => (
                <tr key={loc.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => moveLocation(idx, -1)}
                        disabled={idx === 0 || reorderMutation.isPending}
                        className="p-0.5 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move up"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => moveLocation(idx, 1)}
                        disabled={idx === locations.length - 1 || reorderMutation.isPending}
                        className="p-0.5 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move down"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <span className="text-[10px] text-slate-400 ml-1 w-4 text-center">{idx + 1}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <CategoryIcon category={loc.category} />
                      <div>
                        <div className="font-medium text-slate-900">{loc.name}</div>
                        {loc.description && (
                          <div className="text-xs text-slate-500">{loc.description}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded border ${categoryBadgeStyle(loc.category)}`}
                    >
                      {categoryLabel(loc.category)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {loc.itemCount}
                    {loc.itemCount === 1 ? ' item' : ' items'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => setEditing(loc)}
                      className="p-1.5 rounded hover:bg-slate-100 text-slate-600"
                      title="Edit"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(loc)}
                      className="p-1.5 rounded hover:bg-red-50 text-red-600"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(isCreating || editing) && (
        <StorageLocationDialog
          location={editing}
          onClose={() => {
            setIsCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setIsCreating(false);
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ['storage-locations'] });
          }}
        />
      )}

      {wizardOpen && (
        <SetupWizardDialog
          onClose={() => setWizardOpen(false)}
          onComplete={() => {
            setWizardOpen(false);
            queryClient.invalidateQueries({ queryKey: ['storage-locations'] });
          }}
        />
      )}
    </div>
  );
}

// ── Setup Wizard Dialog ────────────────────────────────────────────────

function SetupWizardDialog({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['storage-location-templates'],
    queryFn: () => storageLocationsApi.templates(),
  });

  const setupMutation = useMutation({
    mutationFn: (names: string[]) => storageLocationsApi.setup(names),
    onSuccess: () => onComplete(),
  });

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Pre-select recommended locations for a typical hospital
  useEffect(() => {
    if (!data) return;
    const defaults = new Set<string>();
    for (const cat of data.categories) {
      for (const loc of cat.locations) {
        if (!loc.alreadyExists) {
          // Pre-select the first 2-3 from each category as a sensible default
          const selectableInCat = cat.locations.filter((l) => !l.alreadyExists);
          const shouldPreselect = selectableInCat.indexOf(loc) < 3;
          if (shouldPreselect) defaults.add(loc.name);
        }
      }
    }
    setSelected(defaults);
  }, [data]);

  const toggleLocation = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleCategory = (cat: TemplateCategory) => {
    const selectable = cat.locations.filter((l) => !l.alreadyExists).map((l) => l.name);
    const allSelected = selectable.every((n) => selected.has(n));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        selectable.forEach((n) => next.delete(n));
      } else {
        selectable.forEach((n) => next.add(n));
      }
      return next;
    });
  };

  const selectAll = () => {
    if (!data) return;
    const all = new Set<string>();
    for (const cat of data.categories) {
      for (const loc of cat.locations) {
        if (!loc.alreadyExists) all.add(loc.name);
      }
    }
    setSelected(all);
  };

  const selectNone = () => setSelected(new Set());

  const selectedCount = selected.size;

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-start gap-2">
            <Sparkles className="h-5 w-5 text-emerald-600 mt-0.5" />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Storage Location Setup
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Select the storage areas that match your kitchen. You can customize names and
                walking order after setup.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-500">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="text-center py-8 text-slate-500 text-sm">Loading templates...</div>
          ) : !data ? (
            <div className="text-center py-8 text-slate-500 text-sm">Failed to load templates</div>
          ) : (
            <div className="space-y-6">
              {/* Quick actions */}
              <div className="flex items-center gap-3 text-xs">
                <button
                  onClick={selectAll}
                  className="text-emerald-600 hover:text-emerald-700 font-medium"
                >
                  Select all
                </button>
                <span className="text-slate-300">|</span>
                <button
                  onClick={selectNone}
                  className="text-slate-600 hover:text-slate-900 font-medium"
                >
                  Clear all
                </button>
                <span className="flex-1" />
                <span className="text-slate-500">
                  {selectedCount} selected
                  {data.existingCount > 0 && (
                    <> · {data.existingCount} already exist</>
                  )}
                </span>
              </div>

              {/* Category sections */}
              {data.categories.map((cat) => {
                const selectable = cat.locations.filter((l) => !l.alreadyExists);
                const allCatSelected =
                  selectable.length > 0 && selectable.every((l) => selected.has(l.name));
                return (
                  <div key={cat.category}>
                    {/* Category header with select-all */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-2 py-1 rounded border ${categoryBadgeStyle(cat.category)}`}
                        >
                          <CategoryIcon category={cat.category} />
                          {cat.label}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {cat.locations.length} locations
                        </span>
                      </div>
                      {selectable.length > 0 && (
                        <button
                          onClick={() => toggleCategory(cat)}
                          className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                        >
                          <CheckSquare className="h-3 w-3" />
                          {allCatSelected ? 'Deselect all' : 'Select all'}
                        </button>
                      )}
                    </div>

                    {/* Location checkboxes */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {cat.locations.map((loc) => {
                        const isSelected = selected.has(loc.name);
                        const disabled = loc.alreadyExists;
                        return (
                          <label
                            key={loc.name}
                            className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${
                              disabled
                                ? 'bg-slate-50 border-slate-200 opacity-60 cursor-default'
                                : isSelected
                                  ? 'bg-emerald-50 border-emerald-300'
                                  : 'bg-white border-slate-200 hover:border-emerald-200'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected || disabled}
                              disabled={disabled}
                              onChange={() => !disabled && toggleLocation(loc.name)}
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-slate-900">
                                {loc.name}
                                {disabled && (
                                  <span className="ml-2 text-[10px] text-slate-500 font-normal">
                                    Already exists
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 mt-0.5">{loc.description}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-6 py-3 border-t border-slate-200 bg-slate-50">
          <p className="text-xs text-slate-500">
            {selectedCount > 0
              ? `${selectedCount} location${selectedCount === 1 ? '' : 's'} will be created`
              : 'Select locations to get started'}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-700 rounded hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={() => setupMutation.mutate(Array.from(selected))}
              disabled={selectedCount === 0 || setupMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {setupMutation.isPending ? 'Creating...' : `Create ${selectedCount} location${selectedCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Create/Edit dialog ─────────────────────────────────────────────────

function StorageLocationDialog({
  location,
  onClose,
  onSaved,
}: {
  location: StorageLocation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = location !== null;
  const [name, setName] = useState(location?.name ?? '');
  const [description, setDescription] = useState(location?.description ?? '');
  const [category, setCategory] = useState<CategoryValue | ''>(
    (location?.category as CategoryValue) ?? '',
  );
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      storageLocationsApi.create({
        name: name.trim(),
        description: description.trim() || null,
        category: category || null,
      }),
    onSuccess: () => onSaved(),
    onError: (e) => setError(e instanceof Error ? e.message : 'Save failed'),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      storageLocationsApi.update(location!.id, {
        name: name.trim(),
        description: description.trim() || null,
        category: category || null,
      }),
    onSuccess: () => onSaved(),
    onError: (e) => setError(e instanceof Error ? e.message : 'Save failed'),
  });

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (isEdit) updateMutation.mutate();
    else createMutation.mutate();
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">
            {isEdit ? 'Edit Storage Location' : 'New Storage Location'}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-500">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-3">
          {error && (
            <div className="rounded bg-red-50 border border-red-200 text-red-800 text-xs p-2">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              placeholder="e.g. Walk-In Cooler"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Fresh proteins, prepped items"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as CategoryValue | '')}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Uncategorized</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-700 rounded hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 font-medium"
            >
              {isPending ? 'Saving...' : isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
