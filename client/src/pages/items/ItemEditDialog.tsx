import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { X, Package, Truck, AlertCircle } from 'lucide-react';
import { apiRequest, ApiError } from '../../lib/api';

interface Item {
  id: string;
  name: string;
  category: string | null;
  currentQty: number;
  itemCost: number | null;
  reorderPoint: number | null;
  reorderQty: number | null;
  portionUnit: string | null;
  portionSize: number | null;
  storageLocationId: string | null;
  vendors: Array<{ vendorId: string; vendorName: string; vendorSku: string | null; lastCost: number | null }>;
}

interface StorageLocationsResponse {
  storageLocations: Array<{ id: string; name: string; category: string | null }>;
}

interface ReceivePayload {
  quantity: number;
  unitCost: number;
  vendorId?: string;
  reference?: string;
}

interface AdjustPayload {
  quantity: number;
  type: 'waste' | 'adjustment';
  reference?: string;
}

export function ItemEditDialog({
  item,
  onClose,
  onSaved,
}: {
  item: Item | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !item;
  const [tab, setTab] = useState<'details' | 'receive' | 'adjust'>('details');
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState(item?.name ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [portionUnit, setPortionUnit] = useState(item?.portionUnit ?? '');
  const [storageLocationId, setStorageLocationId] = useState(item?.storageLocationId ?? '');
  const [reorderPoint, setReorderPoint] = useState(item?.reorderPoint?.toString() ?? '');
  const [reorderQty, setReorderQty] = useState(item?.reorderQty?.toString() ?? '');

  // Receive form
  const [receiveQty, setReceiveQty] = useState('');
  const [receiveCost, setReceiveCost] = useState('');
  const [receiveRef, setReceiveRef] = useState('');

  // Adjust form
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustType, setAdjustType] = useState<'waste' | 'adjustment'>('adjustment');
  const [adjustRef, setAdjustRef] = useState('');

  const { data: locationsData } = useQuery({
    queryKey: ['storage-locations'],
    queryFn: () => apiRequest<StorageLocationsResponse>('GET', '/v1/storage-locations'),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isNew
        ? apiRequest('POST', '/v1/items', payload)
        : apiRequest('PUT', `/v1/items/${item!.id}`, payload),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Save failed'),
  });

  const receiveMutation = useMutation({
    mutationFn: (payload: ReceivePayload) =>
      apiRequest('POST', `/v1/items/${item!.id}/receive`, payload),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Receive failed'),
  });

  const adjustMutation = useMutation({
    mutationFn: (payload: AdjustPayload) =>
      apiRequest('POST', `/v1/items/${item!.id}/adjust`, payload),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Adjust failed'),
  });

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSave = () => {
    setError(null);
    if (!name.trim()) { setError('Name is required'); return; }
    saveMutation.mutate({
      name: name.trim(),
      category: category || null,
      portionUnit: portionUnit || null,
      storageLocationId: storageLocationId || null,
      reorderPoint: reorderPoint ? parseFloat(reorderPoint) : null,
      reorderQty: reorderQty ? parseFloat(reorderQty) : null,
    });
  };

  const handleReceive = () => {
    setError(null);
    const qty = parseFloat(receiveQty);
    const cost = parseFloat(receiveCost);
    if (isNaN(qty) || qty <= 0) { setError('Quantity must be positive'); return; }
    if (isNaN(cost) || cost < 0) { setError('Cost must be non-negative'); return; }
    receiveMutation.mutate({ quantity: qty, unitCost: cost, reference: receiveRef || undefined });
  };

  const handleAdjust = () => {
    setError(null);
    const qty = parseFloat(adjustQty);
    if (isNaN(qty)) { setError('Quantity is required'); return; }
    adjustMutation.mutate({ quantity: qty, type: adjustType, reference: adjustRef || undefined });
  };

  const locations = locationsData?.storageLocations ?? [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-emerald-600" />
            <h2 className="text-lg font-semibold text-slate-900">
              {isNew ? 'Add Item' : item.name}
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs (only for existing items) */}
        {!isNew && (
          <div className="flex border-b border-slate-100 px-5">
            {(['details', 'receive', 'adjust'] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(null); }}
                className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                  tab === t
                    ? 'border-emerald-500 text-emerald-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {t === 'details' ? 'Details' : t === 'receive' ? 'Receive Stock' : 'Adjust'}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700 mb-4">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {(tab === 'details' || isNew) && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="e.g. Chicken Breast"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Category</label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="e.g. Protein"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Unit</label>
                  <input
                    type="text"
                    value={portionUnit}
                    onChange={(e) => setPortionUnit(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="oz, lb, ea"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Storage Location</label>
                <select
                  value={storageLocationId}
                  onChange={(e) => setStorageLocationId(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">— None —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Reorder Point</label>
                  <input
                    type="number"
                    value={reorderPoint}
                    onChange={(e) => setReorderPoint(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="0"
                    min="0"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Reorder Qty</label>
                  <input
                    type="number"
                    value={reorderQty}
                    onChange={(e) => setReorderQty(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="0"
                    min="0"
                  />
                </div>
              </div>

              {!isNew && item.vendors.length > 0 && (
                <div className="pt-2 border-t border-slate-100">
                  <p className="text-xs font-medium text-slate-600 mb-2 flex items-center gap-1">
                    <Truck className="h-3.5 w-3.5" /> Vendors
                  </p>
                  {item.vendors.map((v) => (
                    <div key={v.vendorId} className="flex items-center justify-between text-sm py-1">
                      <span className="text-slate-800">{v.vendorName}</span>
                      <span className="text-slate-500">
                        {v.vendorSku && <span className="mr-3 text-xs">SKU: {v.vendorSku}</span>}
                        {v.lastCost != null && `$${v.lastCost.toFixed(4)}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'receive' && !isNew && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-blue-700">
                Current quantity: <strong>{item.currentQty}</strong>
                {item.itemCost != null && ` · Avg cost: $${item.itemCost.toFixed(4)}`}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Quantity Received *</label>
                  <input
                    type="number"
                    value={receiveQty}
                    onChange={(e) => setReceiveQty(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="0"
                    min="0"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Unit Cost *</label>
                  <input
                    type="number"
                    value={receiveCost}
                    onChange={(e) => setReceiveCost(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="0.00"
                    min="0"
                    step="0.0001"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Reference (PO#, Invoice#)</label>
                <input
                  type="text"
                  value={receiveRef}
                  onChange={(e) => setReceiveRef(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Optional"
                />
              </div>
            </div>
          )}

          {tab === 'adjust' && !isNew && (
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-700">
                Current quantity: <strong>{item.currentQty}</strong>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Adjustment Type</label>
                <div className="flex gap-3">
                  {(['adjustment', 'waste'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setAdjustType(t)}
                      className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                        adjustType === t
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {t === 'adjustment' ? 'Adjustment' : 'Waste / Spoilage'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">
                  Quantity (negative to remove, positive to add)
                </label>
                <input
                  type="number"
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="-5 or +10"
                  step="0.01"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Note</label>
                <input
                  type="text"
                  value={adjustRef}
                  onChange={(e) => setAdjustRef(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Optional reason"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
          >
            Cancel
          </button>
          {(tab === 'details' || isNew) && (
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="px-5 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {saveMutation.isPending ? 'Saving…' : isNew ? 'Create Item' : 'Save Changes'}
            </button>
          )}
          {tab === 'receive' && (
            <button
              onClick={handleReceive}
              disabled={receiveMutation.isPending}
              className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {receiveMutation.isPending ? 'Recording…' : 'Record Receipt'}
            </button>
          )}
          {tab === 'adjust' && (
            <button
              onClick={handleAdjust}
              disabled={adjustMutation.isPending}
              className="px-5 py-2 bg-slate-700 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {adjustMutation.isPending ? 'Saving…' : 'Save Adjustment'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
