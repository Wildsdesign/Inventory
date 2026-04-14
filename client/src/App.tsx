import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Package, Truck, Upload, MapPin, LayoutDashboard, LogOut } from 'lucide-react';
import { useAuth } from './contexts/auth-context';
import { DashboardPage } from './pages/DashboardPage';
import { ItemsPage } from './pages/ItemsPage';
import { VendorsPage } from './pages/VendorsPage';
import { ImportPage } from './pages/ImportPage';
import { StorageLocationsPage } from './pages/StorageLocationsPage';
import { ReceivingPage } from './pages/ReceivingPage';
import { LoginPage } from './pages/LoginPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-500">Loading…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function NavLink({ to, icon: Icon, children }: { to: string; icon: React.ElementType; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const isActive = to === '/' ? pathname === '/' : pathname.startsWith(to);
  return (
    <Link
      to={to}
      className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
        isActive
          ? 'bg-emerald-50 text-emerald-700'
          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
      }`}
    >
      <Icon className="h-4 w-4" />
      {children}
    </Link>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { user, demoMode } = useAuth();

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Package className="h-6 w-6 text-emerald-600" />
            <span className="text-lg font-semibold text-slate-900">Inventory</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{user?.facilityName}</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <NavLink to="/" icon={LayoutDashboard}>Dashboard</NavLink>
          <NavLink to="/items" icon={Package}>Inventory</NavLink>
          <NavLink to="/vendors" icon={Truck}>Vendors</NavLink>
          <NavLink to="/import" icon={Upload}>Import</NavLink>
          <NavLink to="/storage-locations" icon={MapPin}>Storage</NavLink>
        </nav>
        <div className="p-3 border-t border-slate-200">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-500">
              <p className="font-medium text-slate-700">{user?.name}</p>
              <p>{user?.role}</p>
            </div>
            {demoMode && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                Demo
              </span>
            )}
            {!demoMode && (
              <button className="text-slate-400 hover:text-slate-600">
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell>
              <DashboardPage />
            </AppShell>
          </RequireAuth>
        }
      />
      <Route
        path="/items"
        element={
          <RequireAuth>
            <AppShell>
              <ItemsPage />
            </AppShell>
          </RequireAuth>
        }
      />
      <Route
        path="/vendors"
        element={
          <RequireAuth>
            <AppShell>
              <VendorsPage />
            </AppShell>
          </RequireAuth>
        }
      />
      <Route
        path="/import"
        element={
          <RequireAuth>
            <AppShell>
              <ImportPage />
            </AppShell>
          </RequireAuth>
        }
      />
      <Route
        path="/storage-locations"
        element={
          <RequireAuth>
            <AppShell>
              <StorageLocationsPage />
            </AppShell>
          </RequireAuth>
        }
      />
      <Route
        path="/receiving"
        element={
          <RequireAuth>
            <AppShell>
              <ReceivingPage />
            </AppShell>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
