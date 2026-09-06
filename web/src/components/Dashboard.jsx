import Reveal from './Reveal';

function StatCard({ label, value, detail }) {
  return (
    <div className="px-5 py-5 sm:px-6">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-gray-950">{value}</p>
      <p className="mt-1 text-xs text-gray-500">{detail}</p>
    </div>
  );
}

function Dashboard({ view, error }) {
  return (
    <>
      {/* Band 1 — artifact summary */}
      <section id="summary" className="scroll-mt-20 w-full bg-white">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          {error && (
            <div className="mb-8 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
              {error} Showing the previously loaded artifact instead.
            </div>
          )}

          <div className="mb-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Current artifact</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-gray-950">{view.artifactTitle}</h2>
            </div>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-gray-100 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {view.analysisStatus}
            </span>
          </div>

          <div className="grid grid-cols-2 divide-x divide-y divide-gray-100 rounded-2xl border border-gray-100 bg-white shadow-sm sm:grid-cols-4 sm:divide-y-0">
            <StatCard label="Top impact" value={view.topImpact.label} detail={view.topImpact.detail} />
            <StatCard label="Relative change" value={view.relativeChange.value} detail={view.relativeChange.detail} />
            <StatCard label="Scope" value={view.scope.value} detail={view.scope.detail} />
            <StatCard label="Attribution" value={view.attribution.value} detail={view.attribution.detail} />
          </div>
        </div>
      </section>

      {/* Band 2 — recommended impact + evidence trail */}
      <section id="evidence" className="scroll-mt-20 w-full bg-gray-50/60">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <Reveal className="mb-8">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Evidence</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-gray-950">Recommended impact and its evidence trail</h2>
          </Reveal>

          <Reveal className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
            <article className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-5">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Recommended impact</p>
                  <h3 className="mt-1.5 text-base font-semibold text-gray-950">{view.claim.confidence} confidence</h3>
                </div>
              </div>

              <p className="mt-6 text-base leading-8 text-gray-700">{view.claim.statement}</p>

              {view.claim.tags.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-1.5">
                  {view.claim.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-gray-100 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-7 border-t border-gray-100 pt-6">
                <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-gray-400">
                  <span>Measured movement</span>
                  <span>{view.counts.metrics} metric{view.counts.metrics === 1 ? '' : 's'}</span>
                </div>

                {view.metrics.length === 0 && (
                  <p className="mt-4 text-sm text-gray-500">No deterministic metrics in this artifact.</p>
                )}

                {view.metrics.map((m) => (
                  <div key={m.id} className="mt-5 border-t border-gray-100 pt-5 first:mt-5 first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-600">{m.name}</p>
                        <div className="mt-1.5 flex items-baseline gap-2">
                          <span className="text-lg font-semibold text-gray-400">{m.before}</span>
                          <span className="text-gray-300">→</span>
                          <span className="text-lg font-semibold text-gray-950">{m.after}</span>
                          <span className="text-xs text-gray-400">{m.unit}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">{m.outcome}</p>
                      </div>
                      <span className="rounded-full border border-gray-100 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700">
                        {m.relativeChangePercent}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <aside className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Evidence trail</p>
                <span className="text-xs font-medium text-gray-500">{view.counts.evidence} records</span>
              </div>

              {view.evidence.length === 0 && (
                <p className="mt-4 text-sm text-gray-500">No evidence records found.</p>
              )}

              <div className="mt-1 divide-y divide-gray-100">
                {view.evidence.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 py-3.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-100 bg-gray-50 text-[10px] text-gray-500">
                      ✓
                    </span>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{e.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{e.id} · {e.resolution}</p>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </Reveal>
        </div>
      </section>

      {/* Band 3 — review signal + open opportunity */}
      <section id="review" className="scroll-mt-20 w-full bg-white">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <Reveal className="mb-8">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Review</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-gray-950">Review signal and open opportunities</h2>
          </Reveal>

          <Reveal className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
            <article className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Review signal</p>
              <div className="mt-4 flex items-end gap-1.5">
                <span className="text-3xl font-semibold tracking-tight text-gray-950">{view.review.score}</span>
                <span className="pb-1 text-sm text-gray-400">/ 5</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-gray-600">{view.review.copy}</p>

              {view.review.qualityProfile && (
                <div className="mt-6 space-y-3 border-t border-gray-100 pt-5 text-xs">
                  {Object.entries(view.review.qualityProfile).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-gray-500">{key.replace(/_/g, ' ')}</span>
                      <span className="font-medium text-gray-900">{String(value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="flex flex-col justify-between rounded-2xl border border-gray-800 bg-gray-950 p-6 text-white shadow-sm sm:p-8">
              <div>
                <h3 className="text-lg font-semibold tracking-tight">Strengthen this impact</h3>
                <p className="mt-3 max-w-xl text-sm leading-6 text-gray-400">{view.opportunity}</p>
              </div>
            </article>
          </Reveal>
        </div>
      </section>
    </>
  );
}

export default Dashboard;
