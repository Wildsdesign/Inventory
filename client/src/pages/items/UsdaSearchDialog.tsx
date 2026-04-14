/**
 * USDA Search dialog — mirror of Recipe's implementation.
 * Auto-searches the item name on open; shows calories / protein / sodium
 * preview per result.
 */

import { useState, useEffect, FormEvent } from 'react';
import { X, Search, Loader2, FlaskConical, Eye, AlertCircle } from 'lucide-react';
import { usdaApi, type USDASearchResult, type Item } from '../../lib/items-api';

interface UsdaSearchDialogProps {
  item: Item;
  onClose: () => void;
  onSelectResult: (result: USDASearchResult) => void;
}

export function UsdaSearchDialog({ item, onClose, onSelectResult }: UsdaSearchDialogProps) {
  const [query, setQuery] = useState(item.name);
  const [results, setResults] = useState<USDASearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Auto-search on open
  useEffect(() => {
    handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;

    setSearching(true);
    setError(null);
    try {
      const res = await usdaApi.search(query.trim());
      setResults(res.results);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-emerald-600" />
              <h2 className="text-lg font-semibold text-slate-900">USDA Nutrition Lookup</h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Search USDA FoodData Central to enrich &ldquo;{item.name}&rdquo;
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 text-slate-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-4 flex-1 overflow-hidden flex flex-col">
          {/* Search bar */}
          <form onSubmit={handleSearch} className="flex gap-2 mb-4">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search USDA database..."
              className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              autoFocus
            />
            <button
              type="submit"
              disabled={searching || !query.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Search
            </button>
          </form>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded bg-red-50 border border-red-200 text-red-800 text-sm p-3 mb-3">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Search failed</p>
                <p className="text-xs mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {/* Results */}
          <div className="flex-1 overflow-y-auto space-y-2 -mx-1 px-1">
            {searching && !searched && (
              <div className="text-center text-slate-500 text-sm py-8">
                <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                Searching USDA...
              </div>
            )}

            {searched && !searching && results.length === 0 && !error && (
              <div className="text-center text-slate-500 text-sm py-8">
                No results. Try a different search term.
              </div>
            )}

            {results.map((result) => (
              <div
                key={result.fdcId}
                onClick={() => onSelectResult(result)}
                className="border border-slate-200 rounded p-3 cursor-pointer hover:border-emerald-300 hover:bg-emerald-50/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-slate-900">{result.description}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {result.dataType}
                      {result.brandOwner && ` · ${result.brandOwner}`}
                      {' · '}
                      FDC ID: {result.fdcId}
                    </p>
                    {result.nutrientPreview && (
                      <div className="flex gap-3 mt-1.5 text-xs text-slate-600">
                        {result.nutrientPreview.calories != null && (
                          <span>
                            <span className="font-medium">{Math.round(result.nutrientPreview.calories)}</span> cal
                          </span>
                        )}
                        {result.nutrientPreview.protein != null && (
                          <span>
                            <span className="font-medium">{Math.round(result.nutrientPreview.protein)}g</span> protein
                          </span>
                        )}
                        {result.nutrientPreview.sodium != null && (
                          <span>
                            <span className="font-medium">{Math.round(result.nutrientPreview.sodium)}mg</span> sodium
                          </span>
                        )}
                      </div>
                    )}
                    {result.ingredients && (
                      <p className="text-xs text-slate-500 italic mt-1 line-clamp-2">
                        {result.ingredients.length > 150
                          ? result.ingredients.slice(0, 150) + '...'
                          : result.ingredients}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectResult(result);
                    }}
                    className="shrink-0 flex items-center gap-1 px-2 py-1 text-xs border border-slate-300 rounded hover:bg-white text-slate-700"
                  >
                    <Eye className="h-3 w-3" />
                    View
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
