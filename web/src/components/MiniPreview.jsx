// A real miniature ImpactCompiler product preview — reuses the same view
// model shape the full dashboard renders from, just condensed. Not a
// skeleton loader and not a screenshot: it's live React markup driven by
// demo data, so it stays honest to the actual product.
function MiniPreview({ view }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Artifact</p>
          <p className="mt-0.5 text-sm font-semibold text-gray-950">{view.artifactTitle}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-600">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {view.analysisStatus}
        </span>
      </div>

      <div className="grid grid-cols-2 divide-x divide-gray-200 border-b border-gray-200">
        <div className="px-5 py-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Top quantified impact</p>
          <p className="mt-1.5 text-lg font-semibold tracking-tight text-gray-950">{view.relativeChange.value}</p>
          <p className="mt-0.5 text-xs text-gray-500">{view.relativeChange.detail}</p>
        </div>
        <div className="px-5 py-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Scope</p>
          <p className="mt-1.5 text-lg font-semibold tracking-tight text-gray-950">{view.scope.value}</p>
          <p className="mt-0.5 text-xs text-gray-500">{view.scope.detail}</p>
        </div>
      </div>

      <div className="space-y-2.5 px-5 py-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">Evidence confidence</span>
          <span className="font-medium text-gray-900">{view.review.qualityProfile?.evidence_strength ? view.review.qualityProfile.evidence_strength : '—'}</span>
        </div>
        <div className="h-1 rounded-full bg-gray-100">
          <div
            className="h-1 rounded-full bg-gray-900"
            style={{ width: view.review.strong ? '92%' : '55%' }}
          />
        </div>
      </div>

      <div className="border-t border-gray-200 px-5 py-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Recommended impact</p>
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-gray-600">{view.claim.statement}</p>
      </div>
    </div>
  );
}

export default MiniPreview;
