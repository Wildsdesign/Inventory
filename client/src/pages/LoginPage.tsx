import { Package } from 'lucide-react';

export function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="flex items-center justify-center gap-3 mb-4">
          <Package className="h-10 w-10 text-emerald-600" />
          <h1 className="text-3xl font-bold text-slate-900">Inventory</h1>
        </div>
        <p className="text-slate-500 mb-8">Hospital Food Service Inventory Management</p>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 max-w-sm mx-auto">
          <p className="text-slate-600 text-sm">Demo mode is active. You are automatically signed in.</p>
          <a
            href="/"
            className="mt-4 block w-full bg-emerald-600 text-white text-center py-2.5 rounded-lg font-medium hover:bg-emerald-700 transition-colors"
          >
            Go to Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
