import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, AlertTriangle, Package } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { ItemEditDialog } from './items/ItemEditDialog';

interface Item {
  id: string;
  name: string;
  category: string | null;
  currentQty: number;
  itemCost: number | null;
  reorderPoint: number | null;
  reorderQty: number | null;
  portionSize: number | null;
  storageLocationId: string | null;
  isLowStock: boolean;
  storageLocationName: string | null;
  portionUnit: string | null;
  vendors: Array<{ vendorId: string; vendorName: string; vendorSku: string | null; lastCost: number | null }>;
  allergens: Array<{ allergenName: string; severity: string; isBigNine: boolean }>;
  nutrition: { calories: number | null } | null;
}

interface ItemsResponse {
  items: Item[];
  count: number;
}

export function ItemsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['items', search],
    queryFn: () =>
      apiRequest<ItemsResponse>('GET', `/v1/items${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/v1/items/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['items'] }),
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Items</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {data?.count ?? 0} items in inventory
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Item
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-400">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <Package className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">No items yet. Add your first item or import a vendor file.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Category</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">On Hand</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Avg Cost</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Storage</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Vendor</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                    item.isLowStock ? 'bg-amber-50/30' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {item.isLowStock && (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                      )}
                      <span className="font-medium text-slate-900">{item.name}</span>
                      {item.allergens.filter((a) => a.isBigNine).length > 0 && (
                        <span className="text-[10px] bg-red-50 text-red-600 border border-red-100 px-1 rounded">
                          allergens
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.category ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    <span className={item.isLowStock ? 'text-amber-600' : 'text-slate-900'}>
                      {item.currentQty}
                    </span>
                    {item.portionUnit && (
                      <span className="text-slate-400 ml-1 text-xs">{item.portionUnit}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">
                    {item.itemCost != null ? `$${item.itemCost.toFixed(4)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.storageLocationName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {item.vendors[0]?.vendorName ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => setEditItem(item)}
                        className="text-xs text-slate-500 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${item.name}"?`)) deleteItem.mutate(item.id);
                        }}
                        className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(editItem || showCreate) && (
        <ItemEditDialog
          item={editItem}
          onClose={() => {
            setEditItem(null);
            setShowCreate(false);
          }}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['items'] });
            setEditItem(null);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}
