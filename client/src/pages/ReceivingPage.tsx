import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, CheckCircle, AlertCircle, PackageCheck } from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api';

interface Item {
  id: string;
  name: string;
  category: string | null;
  currentQty: number;
  itemCost: number | null;
  portionUnit: string | null;
  storageLocationName: string | null;
  vendors: Array<{ vendorId: string; vendorName: string; vendorSku: string | null; lastCost: number | null }>;
}

interface ItemsResponse {
  items: Item[];
  count: number;
}

interface VendorsResponse {
  vendors: Array<{ id: string; name: string }>;
}

export function ReceivingPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [reference, setReference] = useState('');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: itemsData } = useQuery<ItemsResponse>({
    queryKey: ['items', search],
    queryFn: () => apiRequest<ItemsResponse>('GET', `/api/v1/items?search=${encodeURIComponent(search)}&limit=20`),
    enabled: search.length >= 2,
  });

  const { data: vendorsData } = useQuery<VendorsResponse>({
    queryKey: ['vendors-list'],
    queryFn: () => apiRequest<VendorsResponse>('GET', '/api/v1/vendors?limit=100'),
  });

  const receiveMutation = useMutation({
    mutationFn: (payload: { quantity: number; unitCost: number; vendorId?: string; reference?: string }) =>
      apiRequest('POST', `/api/v1/items/${selectedItem!.id}/receive`, payload),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      setSuccessMsg(
        `Received ${vars.quantity} ${selectedItem?.portionUnit ?? 'units'} of ${selectedItem?.name} @ $${vars.unitCost.toFixed(2)}`,
      );
      setErrorMsg(null);
      setSelectedItem(null);
      setQuantity('');
      setUnitCost('');
      setVendorId('');
      setReference('');
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'Failed to receive item';
      setErrorMsg(msg);
      setSuccessMsg(null);
    },
  });

  function handleSelectItem(item: Item) {
    setSelectedItem(item);
    // Pre-fill unit cost from the selected vendor or item cost
    if (item.itemCost) setUnitCost(String(item.itemCost));
    setSuccessMsg(null);
    setErrorMsg(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedItem) return;
    const qty = parseFloat(quantity);
    const cost = parseFloat(unitCost);
    if (isNaN(qty) || qty <= 0) { setErrorMsg('Enter a valid quantity.'); return; }
    if (isNaN(cost) || cost < 0) { setErrorMsg('Enter a valid unit cost.'); return; }
    receiveMutation.mutate({
      quantity: qty,
      unitCost: cost,
      vendorId: vendorId || undefined,
      reference: reference || undefined,
    });
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Receiving</h1>
        <p className="text-sm text-slate-500 mt-1">
          Search for an item to receive stock. Creates a cost layer and updates on-hand quantity.
        </p>
      </div>

      {successMsg && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
          <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
          <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
          {errorMsg}
        </div>
      )}

      {/* Item Search */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">1. Select Item</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search items (min 2 chars)…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSelectedItem(null); }}
            className="w-full pl-9 pr-4 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {selectedItem ? (
          <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-50 border border-emerald-200">
            <div>
              <p className="text-sm font-medium text-slate-900">{selectedItem.name}</p>
              <p className="text-xs text-slate-500">
                On hand: {selectedItem.currentQty} {selectedItem.portionUnit ?? 'units'}
                {selectedItem.storageLocationName ? ` · ${selectedItem.storageLocationName}` : ''}
              </p>
            </div>
            <button
              onClick={() => { setSelectedItem(null); setSearch(''); }}
              className="text-xs text-slate-500 hover:text-slate-700 underline"
            >
              Change
            </button>
          </div>
        ) : (
          itemsData && itemsData.items.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden max-h-60 overflow-y-auto">
              {itemsData.items.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => handleSelectItem(item)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <p className="text-sm font-medium text-slate-900">{item.name}</p>
                    <p className="text-xs text-slate-500">
                      {item.category ?? '—'} · On hand: {item.currentQty} {item.portionUnit ?? 'units'}
                      {item.storageLocationName ? ` · ${item.storageLocationName}` : ''}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      {/* Receive Form */}
      {selectedItem && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">2. Enter Receipt Details</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Quantity <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder={`0 ${selectedItem.portionUnit ?? 'units'}`}
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Unit Cost ($) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.0001"
                min="0"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                placeholder="0.00"
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Vendor (optional)</label>
            <select
              value={vendorId}
              onChange={(e) => {
                setVendorId(e.target.value);
                // Pre-fill cost from item's vendor data
                const iv = selectedItem.vendors.find((v) => v.vendorId === e.target.value);
                if (iv?.lastCost) setUnitCost(String(iv.lastCost));
              }}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
            >
              <option value="">— None —</option>
              {vendorsData?.vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Reference / PO # (optional)
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="PO-12345 or invoice number…"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <button
            type="submit"
            disabled={receiveMutation.isPending}
            className="flex items-center gap-2 w-full justify-center px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-60 transition-colors"
          >
            <PackageCheck className="h-4 w-4" />
            {receiveMutation.isPending ? 'Receiving…' : 'Confirm Receipt'}
          </button>
        </form>
      )}
    </div>
  );
}
