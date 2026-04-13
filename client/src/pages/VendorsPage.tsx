import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Truck, X, AlertCircle } from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api';

interface Vendor {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  isActive: boolean;
  itemCount: number;
}

interface VendorsResponse {
  vendors: Vendor[];
}

function VendorDialog({
  vendor,
  onClose,
  onSaved,
}: {
  vendor: Vendor | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !vendor;
  const [name, setName] = useState(vendor?.name ?? '');
  const [contactName, setContactName] = useState(vendor?.contactName ?? '');
  const [contactEmail, setContactEmail] = useState(vendor?.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(vendor?.contactPhone ?? '');
  const [notes, setNotes] = useState(vendor?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isNew
        ? apiRequest('POST', '/v1/vendors', payload)
        : apiRequest('PUT', `/v1/vendors/${vendor!.id}`, payload),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Save failed'),
  });

  const handleSave = () => {
    setError(null);
    if (!name.trim()) { setError('Name is required'); return; }
    mutation.mutate({
      name: name.trim(),
      contactName: contactName || null,
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
      notes: notes || null,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-violet-600" />
            <h2 className="text-lg font-semibold text-slate-900">{isNew ? 'Add Vendor' : 'Edit Vendor'}</h2>
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
            <label className="text-xs font-medium text-slate-600 block mb-1">Company Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="e.g. Sysco" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Contact Name</label>
              <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Phone</label>
              <input type="text" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Email</label>
            <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">Cancel</button>
          <button onClick={handleSave} disabled={mutation.isPending}
            className="px-5 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50">
            {mutation.isPending ? 'Saving…' : isNew ? 'Create Vendor' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function VendorsPage() {
  const queryClient = useQueryClient();
  const [editVendor, setEditVendor] = useState<Vendor | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['vendors'],
    queryFn: () => apiRequest<VendorsResponse>('GET', '/v1/vendors'),
  });

  const deleteVendor = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/v1/vendors/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vendors'] }),
  });

  const vendors = data?.vendors ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Vendors</h1>
          <p className="text-sm text-slate-500 mt-0.5">{vendors.length} vendors</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-violet-700"
        >
          <Plus className="h-4 w-4" />Add Vendor
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-slate-400">Loading…</div>
      ) : vendors.length === 0 ? (
        <div className="text-center py-12">
          <Truck className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">No vendors yet.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {vendors.map((vendor) => (
            <div key={vendor.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-violet-50 p-2 rounded-lg">
                  <Truck className="h-5 w-5 text-violet-600" />
                </div>
                <div>
                  <p className="font-medium text-slate-900">{vendor.name}</p>
                  <p className="text-xs text-slate-500">
                    {vendor.itemCount} items
                    {vendor.contactName && ` · ${vendor.contactName}`}
                    {vendor.contactEmail && ` · ${vendor.contactEmail}`}
                    {!vendor.isActive && ' · Inactive'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setEditVendor(vendor)}
                  className="text-xs text-slate-500 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100">Edit</button>
                <button
                  onClick={() => { if (confirm(`Delete "${vendor.name}"?`)) deleteVendor.mutate(vendor.id); }}
                  className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(editVendor || showCreate) && (
        <VendorDialog
          vendor={editVendor}
          onClose={() => { setEditVendor(null); setShowCreate(false); }}
          onSaved={() => { queryClient.invalidateQueries({ queryKey: ['vendors'] }); setEditVendor(null); setShowCreate(false); }}
        />
      )}
    </div>
  );
}
