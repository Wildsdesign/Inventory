import { useState, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Upload, FileText, CheckCircle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api';

interface Vendor {
  id: string;
  name: string;
}

interface VendorsResponse {
  vendors: Vendor[];
}

interface PreviewRow {
  rowIndex: number;
  name: string;
  vendorSku: string | null;
  vendorItemName: string | null;
  packSize: string | null;
  unitCost: number | null;
  category: string | null;
  matchType: 'new' | 'sku_match' | 'name_match' | 'fuzzy_match';
  itemId: string | null;
  itemName: string | null;
  confidence: number;
  action: 'create' | 'update' | 'skip';
}

interface PreviewResponse {
  previewRows: PreviewRow[];
  columnMappings: Record<string, string | null>;
  totalRows: number;
  rowsWithName: number;
  skippedRows: number;
  newCount: number;
  updateCount: number;
}

interface ApplyResponse {
  importJobId: string;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
}

const MATCH_COLORS: Record<string, string> = {
  new: 'bg-emerald-50 text-emerald-700',
  sku_match: 'bg-blue-50 text-blue-700',
  name_match: 'bg-blue-50 text-blue-700',
  fuzzy_match: 'bg-amber-50 text-amber-700',
};

const MATCH_LABELS: Record<string, string> = {
  new: 'New',
  sku_match: 'SKU Match',
  name_match: 'Name Match',
  fuzzy_match: 'Fuzzy Match',
};

export function ImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [vendorId, setVendorId] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [result, setResult] = useState<ApplyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMappings, setShowMappings] = useState(false);

  const { data: vendorsData } = useQuery({
    queryKey: ['vendors'],
    queryFn: () => apiRequest<VendorsResponse>('GET', '/v1/vendors'),
  });

  const previewMutation = useMutation({
    mutationFn: (payload: { vendorId?: string; fileContent: string; fileName: string }) =>
      apiRequest<PreviewResponse>('POST', '/v1/import/preview', payload),
    onSuccess: (data) => {
      setPreview(data);
      setRows(data.previewRows);
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Preview failed'),
  });

  const applyMutation = useMutation({
    mutationFn: (payload: { vendorId?: string; fileName: string; rows: PreviewRow[] }) =>
      apiRequest<ApplyResponse>('POST', '/v1/import/apply', payload),
    onSuccess: (data) => {
      setResult(data);
      setPreview(null);
      setRows([]);
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Import failed'),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setPreview(null);
    setResult(null);
    setError(null);

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'csv') {
      const reader = new FileReader();
      reader.onload = (ev) => setFileContent(ev.target?.result as string);
      reader.readAsText(file);
    } else if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = btoa(
          new Uint8Array(ev.target?.result as ArrayBuffer)
            .reduce((data, byte) => data + String.fromCharCode(byte), ''),
        );
        setFileContent(base64);
      };
      reader.readAsArrayBuffer(file);
    } else {
      setError('Unsupported file type. Upload a .csv, .xlsx, or .xls file.');
    }
  };

  const handlePreview = () => {
    if (!fileContent) { setError('Please select a file first'); return; }
    previewMutation.mutate({ vendorId: vendorId || undefined, fileContent, fileName });
  };

  const handleApply = () => {
    applyMutation.mutate({
      vendorId: vendorId || undefined,
      fileName,
      rows: rows.map((r) => ({ ...r, action: r.action })),
    });
  };

  const updateRowAction = (rowIndex: number, action: 'create' | 'update' | 'skip') => {
    setRows((prev) => prev.map((r) => r.rowIndex === rowIndex ? { ...r, action } : r));
  };

  const vendors = vendorsData?.vendors ?? [];

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Vendor File Import</h1>
        <p className="text-sm text-slate-500 mt-0.5">Upload a vendor invoice or catalog — AI maps the columns automatically.</p>
      </div>

      {/* Step 1: Select file + vendor */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="font-semibold text-slate-900 mb-4">Step 1: Select File</h2>
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label className="text-xs font-medium text-slate-600 block mb-1">Vendor (optional)</label>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="">— No vendor —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium text-slate-600 block mb-1">File (.csv, .xlsx, .xls)</label>
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-slate-200 rounded-lg px-4 py-3 flex items-center gap-3 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 transition-colors"
            >
              <Upload className="h-4 w-4 text-slate-400 flex-shrink-0" />
              <span className="text-sm text-slate-600 truncate">
                {fileName || 'Click to select file…'}
              </span>
            </div>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} className="hidden" />
          </div>
        </div>
        {fileContent && !preview && (
          <div className="mt-4">
            <button
              onClick={handlePreview}
              disabled={previewMutation.isPending}
              className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              {previewMutation.isPending ? 'Analyzing…' : 'Preview Import'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />{error}
        </div>
      )}

      {/* Step 2: Preview */}
      {preview && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Step 2: Review &amp; Apply</h2>
            <div className="flex gap-3 text-sm">
              <span className="text-emerald-700 font-medium">{rows.filter((r) => r.action !== 'skip').length} to import</span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-500">{rows.filter((r) => r.action === 'skip').length} skipped</span>
            </div>
          </div>

          {/* Column mappings toggle */}
          <button
            onClick={() => setShowMappings((v) => !v)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
          >
            {showMappings ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Column mappings
          </button>
          {showMappings && (
            <div className="bg-slate-50 rounded-lg p-3 text-xs grid grid-cols-2 gap-x-4 gap-y-1">
              {Object.entries(preview.columnMappings).map(([header, field]) => (
                <div key={header} className="flex items-center justify-between">
                  <span className="text-slate-600 truncate">{header}</span>
                  <span className={field ? 'text-emerald-600 font-medium' : 'text-slate-400'}>
                    {field ?? 'unmapped'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Preview table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 px-2 font-medium text-slate-500">Name</th>
                  <th className="text-left py-2 px-2 font-medium text-slate-500">SKU</th>
                  <th className="text-right py-2 px-2 font-medium text-slate-500">Cost</th>
                  <th className="text-left py-2 px-2 font-medium text-slate-500">Match</th>
                  <th className="text-left py-2 px-2 font-medium text-slate-500">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.rowIndex} className={`border-b border-slate-50 ${row.action === 'skip' ? 'opacity-40' : ''}`}>
                    <td className="py-2 px-2 font-medium text-slate-800">{row.name}</td>
                    <td className="py-2 px-2 text-slate-500">{row.vendorSku ?? '—'}</td>
                    <td className="py-2 px-2 text-right text-slate-600">
                      {row.unitCost != null ? `$${row.unitCost.toFixed(4)}` : '—'}
                    </td>
                    <td className="py-2 px-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${MATCH_COLORS[row.matchType]}`}>
                        {MATCH_LABELS[row.matchType]}
                      </span>
                    </td>
                    <td className="py-2 px-2">
                      <select
                        value={row.action}
                        onChange={(e) => updateRowAction(row.rowIndex, e.target.value as 'create' | 'update' | 'skip')}
                        className="border border-slate-200 rounded px-1 py-0.5 text-xs"
                      >
                        <option value="create">Create</option>
                        <option value="update">Update</option>
                        <option value="skip">Skip</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end">
            <button
              onClick={handleApply}
              disabled={applyMutation.isPending || rows.filter((r) => r.action !== 'skip').length === 0}
              className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {applyMutation.isPending ? 'Importing…' : `Import ${rows.filter((r) => r.action !== 'skip').length} Items`}
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="h-5 w-5 text-emerald-600" />
            <h2 className="font-semibold text-emerald-900">Import Complete</h2>
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-2xl font-bold text-emerald-700">{result.importedCount}</p>
              <p className="text-emerald-600">Imported</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-500">{result.skippedCount}</p>
              <p className="text-slate-500">Skipped</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-red-500">{result.errorCount}</p>
              <p className="text-red-500">Errors</p>
            </div>
          </div>
          <button
            onClick={() => { setResult(null); setFileContent(''); setFileName(''); if (fileRef.current) fileRef.current.value = ''; }}
            className="mt-4 text-sm text-emerald-700 hover:underline"
          >
            Import another file →
          </button>
        </div>
      )}
    </div>
  );
}
