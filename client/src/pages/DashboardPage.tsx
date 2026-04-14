import { useQuery } from '@tanstack/react-query';
import { Package, AlertTriangle, Truck, MapPin } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { Link } from 'react-router-dom';

interface ItemsResponse {
  items: Array<{ id: string; name: string; currentQty: number; isLowStock: boolean }>;
  count: number;
}

interface VendorsResponse {
  vendors: Array<{ id: string; name: string; isActive: boolean }>;
}

interface StorageLocationsResponse {
  locations: Array<{ id: string; name: string; itemCount: number }>;
  count: number;
}

interface LowStockResponse {
  items: Array<{ id: string; name: string; currentQty: number; reorderPoint: number | null }>;
  count: number;
}

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  href,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
  href: string;
}) {
  return (
    <Link
      to={href}
      className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4 hover:shadow-sm transition-shadow"
    >
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
        <p className="text-sm text-slate-500">{title}</p>
      </div>
    </Link>
  );
}

export function DashboardPage() {
  const { data: itemsData } = useQuery({
    queryKey: ['items'],
    queryFn: () => apiRequest<ItemsResponse>('GET', '/v1/items'),
  });

  const { data: vendorsData } = useQuery({
    queryKey: ['vendors'],
    queryFn: () => apiRequest<VendorsResponse>('GET', '/v1/vendors'),
  });

  const { data: locationsData } = useQuery({
    queryKey: ['storage-locations'],
    queryFn: () => apiRequest<StorageLocationsResponse>('GET', '/v1/storage-locations'),
  });

  const { data: lowStockData } = useQuery({
    queryKey: ['items', 'low-stock'],
    queryFn: () => apiRequest<LowStockResponse>('GET', '/v1/items/low-stock'),
  });

  const totalItems = itemsData?.count ?? 0;
  const activeVendors = vendorsData?.vendors.filter((v) => v.isActive).length ?? 0;
  const locations = locationsData?.count ?? locationsData?.locations.length ?? 0;
  const lowStockCount = lowStockData?.count ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Inventory overview</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Inventory"
          value={totalItems}
          icon={Package}
          color="bg-blue-50 text-blue-600"
          href="/items"
        />
        <StatCard
          title="Low Stock"
          value={lowStockCount}
          icon={AlertTriangle}
          color={lowStockCount > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-400'}
          href="/items"
        />
        <StatCard
          title="Active Vendors"
          value={activeVendors}
          icon={Truck}
          color="bg-violet-50 text-violet-600"
          href="/vendors"
        />
        <StatCard
          title="Storage Locations"
          value={locations}
          icon={MapPin}
          color="bg-emerald-50 text-emerald-600"
          href="/storage-locations"
        />
      </div>

      {lowStockCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <h2 className="font-semibold text-amber-900">Low Stock Items</h2>
          </div>
          <div className="space-y-2">
            {(lowStockData?.items ?? []).slice(0, 10).map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-800">{item.name}</span>
                <span className="text-amber-700 font-medium">
                  {item.currentQty} on hand
                  {item.reorderPoint != null && ` (reorder at ${item.reorderPoint})`}
                </span>
              </div>
            ))}
            {lowStockCount > 10 && (
              <Link to="/items" className="text-sm text-amber-700 hover:underline">
                + {lowStockCount - 10} more →
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="font-semibold text-slate-900 mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Link
            to="/items"
            className="text-center py-3 px-4 rounded-lg border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 text-sm text-slate-700 hover:text-emerald-700 transition-colors"
          >
            Add Item
          </Link>
          <Link
            to="/import"
            className="text-center py-3 px-4 rounded-lg border border-slate-200 hover:border-violet-300 hover:bg-violet-50 text-sm text-slate-700 hover:text-violet-700 transition-colors"
          >
            Import Vendor File
          </Link>
          <Link
            to="/vendors"
            className="text-center py-3 px-4 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-sm text-slate-700 hover:text-blue-700 transition-colors"
          >
            Manage Vendors
          </Link>
          <Link
            to="/storage-locations"
            className="text-center py-3 px-4 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-sm text-slate-700 transition-colors"
          >
            Storage Setup
          </Link>
        </div>
      </div>
    </div>
  );
}
