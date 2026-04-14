/**
 * Inline badge showing how an allergen assignment was sourced.
 *
 * Sibling to Recipe's identical component — keep in sync.
 *
 * Used in:
 *   - Item Edit dialog (next to the severity radios)
 *   - Items list page (allergen column)
 */

const STYLES: Record<string, { label: string; cls: string }> = {
  USDA_VERIFIED: {
    label: 'USDA',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  AI_SUGGESTED: {
    label: 'AI',
    cls: 'bg-purple-50 text-purple-700 border-purple-200',
  },
  MANUAL: {
    label: 'Manual',
    cls: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  ROLLUP: {
    label: 'Rollup',
    cls: 'bg-slate-50 text-slate-600 border-slate-200',
  },
};

export function AllergenSourceBadge({ source }: { source: string }) {
  const style = STYLES[source] ?? {
    label: source,
    cls: 'bg-slate-50 text-slate-600 border-slate-200',
  };
  return (
    <span
      className={`inline-block text-[9px] font-medium px-1 py-0.5 rounded border leading-none ${style.cls}`}
    >
      {style.label}
    </span>
  );
}
