import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, MapPin, X, AlertCircle, GripVertical } from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api';

interface StorageLocation {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  sortOrder: number;
  isActive: boolean;
  itemCount: number;
}

interface StorageLocationsResponse {
  storageLocations: StorageLocation[];
}

const CATEGORIES = ['dry', 'refrigerated', 'frozen', 'production', 'receiving', 'specialty'] as const;
const CATEGORY_COLORS: Record<string, string> = {
  dry: 'bg-amber-50 text-amber-700',
  refrigerated: 'bg-blue-50 text-blue-700',
  frozen: 'bg-cyan-50 text-cyan-700',
  production: 'bg-orange-50 text-orange-700',
  receiving: 'bg-violet-50 text-violet-700',
  specialty: 'bg-slate-50 text-slate-700',
};

function LocationDialog({
  location,
  onClose,
  onSaved,
}: {
  location: StorageLocation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !location;
  const [name, setName] = useState(location?.name ?? '');
  const [description, setDescription] = useState(location?.description ?? '');
  const [category, setCategory] = useState(location?.category ?? '');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isNew
        ? apiRequest('POST', '/v1/storage-locations', payload)
        : apiRequest('PUT', `/v1/storage-locations/${location!.id}`, payload),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Save failed'),
  });

  const handleSave = () => {
    setError(null);
    if (!name.trim()) { setError('Name is required'); return; }
    mutation.mutate({ name: name.trim(), description: description || null, category: category || null });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-emerald-600" />
            <h2 className="text-lg font-semibold">{isNew ? 'Add Storage Location' : 'Edit Location'}</h2>
          </div>
          <button onClick={onClose}><X className="h-5 w-5 text-slate-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
              <AlertCircle className="h-4 w-4" />{error}
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="e.g. Walk-In Cooler" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="">— None —</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Description</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="Optional" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600">Cancel</button>
          <button onClick={handleSave} disabled={mutation.isPending}
            className="px-5 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            {mutation.isPending ? 'Saving…' : isNew ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function StorageLocationsPage() {
  const queryClient = useQueryClient();
  const [editLocation, setEditLocation] = useState<StorageLocation | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['storage-locations'],
    queryFn: () => apiRequest<StorageLocationsResponse>('GET', '/v1/storage-locations'),
  });

  const deleteLocation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/v1/storage-locations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['storage-locations'] }),
    onError: (e) => alert(e instanceof ApiError ? e.message : 'Delete failed'),
  });

  const locations = data?.storageLocations ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Storage Locations</h1>
          <p className="text-sm text-slate-500 mt-0.5">{locations.length} locations · ordered by walk order</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />Add Location
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-slate-400">Loading…</div>
      ) : locations.length === 0 ? (
        <div className="text-center py-12">
          <MapPin className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">No storage locations yet. Add your first location.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {locations.map((loc) => (
            <div key={loc.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
              <GripVertical className="h-4 w-4 text-slate-300 flex-shrink-0" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-900">{loc.name}</span>
                  {loc.category && (
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${CATEGORY_COLORS[loc.category] ?? 'bg-slate-50 text-slate-600'}`}>
                      {loc.category}
                    </span>
                  )}
                  {!loc.isActive && <span className="text-[10px] text-slate-400">inactive</span>}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {loc.itemCount} items
                  {loc.description && ` · ${loc.description}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setEditLocation(loc)}
                  className="text-xs text-slate-500 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100">Edit</button>
                <button
                  onClick={() => { if (confirm(`Delete "${loc.name}"?`)) deleteLocation.mutate(loc.id); }}
                  className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(editLocation || showCreate) && (
        <LocationDialog
          location={editLocation}
          onClose={() => { setEditLocation(null); setShowCreate(false); }}
          onSaved={() => { queryClient.invalidateQueries({ queryKey: ['storage-locations'] }); setEditLocation(null); setShowCreate(false); }}
        />
      )}
    </div>
  );
}
