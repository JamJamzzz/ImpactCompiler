const demoArtifact = {
  run: { analysis_status: 'analyzed' }, compiler_version: '5.0.0',
  evidence: [
    { id: 'ev_benchmark', type: 'controlled_benchmark', resolution: 'resolved', measurement_quality: 'high' },
    { id: 'ev_commit', type: 'git_commit', resolution: 'resolved' },
    { id: 'ev_scope', type: 'benchmark_artifact', resolution: 'resolved' },
  ],
  metrics: [{ name: 'Batch processing time', before: 1.82, after: .47, unit: 'sec', relative_change_percent: 74.18, result: { outcome: 'improvement' } }],
  impact_candidates: [{ quality_profile: { resume_eligibility: 'strong' }, attribution: { strength: 'strong' }, measurement: { run_count: 30 }, scope: { records: 1000000 } }],
  claims: [{ statement: 'Refactored the customer-matching engine, reducing processing time across a one-million-record dataset from 1.82s to 0.47s, a 74.18% reduction.', confidence: 'high', quantification_type: 'measured', impact_level: 'L2', attribution: { strength: 'strong' }, scope: { records: 1000000 }, resume_variants: { short: 'Optimized the customer-matching engine, reducing processing time by 74.18% across a one-million-record dataset.', technical: 'Refactored the customer-matching engine and, across 30 controlled runs on a one-million-record dataset, reduced median processing time from 1.82s to 0.47s, a 74.18% reduction.' } }],
  impact_opportunities: [{ recommended_measurement: 'Add a production observation window to corroborate the benchmark.' }],
};

const $ = (id) => document.getElementById(id);
const escapeText = (value) => String(value ?? '').replace(/[<>]/g, '');
const number = (value) => typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : escapeText(value || '—');
const titleCase = (value) => escapeText(String(value || '').replaceAll('_', ' ')).replace(/\b\w/g, (c) => c.toUpperCase());

function render(artifact) {
  const evidence = artifact.evidence || [], metrics = artifact.metrics || [], claims = artifact.claims || [], candidates = artifact.impact_candidates || [];
  const claim = claims[0] || {};
  const candidate = candidates[0] || {};
  const metric = metrics[0] || {};
  $('artifact-title').textContent = claim.title || claim.change || 'Impact artifact';
  $('status-pill').innerHTML = `<span class="status-dot"></span> ${escapeText(artifact.run?.analysis_status || 'unknown')}`;
  const stats = [
    ['TOP IMPACT', claim.quantification_type === 'estimated' ? 'Estimated' : 'Measured', claim.impact_level || '—'],
    ['RELATIVE CHANGE', metric.relative_change_percent != null ? `${number(metric.relative_change_percent)}%` : '—', metric.name || 'No metric'],
    ['SCOPE', candidate.scope?.records ? number(candidate.scope.records) : claim.scope?.records ? number(claim.scope.records) : 'Traceable', candidate.scope?.records ? 'records' : 'evidence-linked'],
    ['ATTRIBUTION', titleCase(claim.attribution?.strength || candidate.attribution?.strength || 'unknown'), candidate.measurement?.run_count ? `${candidate.measurement.run_count} controlled runs` : 'provenance review'],
  ];
  $('stats-grid').innerHTML = stats.map(([label, value, sub]) => `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${escapeText(value)}</div><div class="stat-sub">${escapeText(sub)}</div></div>`).join('');
  $('featured-claim').textContent = claim.statement || 'No resume-ready claim was produced for this artifact.';
  $('confidence-badge').textContent = `${escapeText((claim.confidence || 'review').toUpperCase())} CONFIDENCE`;
  $('claim-footer').innerHTML = [claim.quantification_type, claim.impact_level, claim.attribution?.strength ? `${claim.attribution.strength} attribution` : null].filter(Boolean).map((tag) => `<span class="tag">${titleCase(tag)}</span>`).join('');
  $('metric-count').textContent = `${metrics.length} metric${metrics.length === 1 ? '' : 's'}`;
  $('metrics-list').innerHTML = metrics.length ? metrics.map((m) => `<div class="metric-row"><div class="metric-name">${escapeText(m.name || 'Unnamed metric')} <span class="metric-change">${m.relative_change_percent != null ? `${number(m.relative_change_percent)}%` : '—'}</span></div><div class="metric-values"><span class="metric-before">${number(m.before)}</span><span class="metric-arrow">→</span><span class="metric-after">${number(m.after)}</span><span class="metric-unit">${escapeText(m.unit || '')}</span></div><div class="metric-context">${escapeText(m.result?.outcome || 'outcome pending')} · deterministic calculation</div></div>`).join('') : '<p class="metric-context">No deterministic metrics in this artifact.</p>';
  $('evidence-count').textContent = `${evidence.length} records`;
  $('evidence-list').innerHTML = evidence.length ? evidence.map((e) => `<div class="evidence-row"><div class="evidence-icon">✓</div><div><div class="evidence-name">${titleCase(e.type)}</div><div class="evidence-type">${escapeText(e.id)} · ${escapeText(e.resolution || 'unresolved')}</div></div></div>`).join('') : '<p class="metric-context">No evidence records found.</p>';
  const strong = claim.attribution?.strength === 'strong' || candidate.attribution?.strength === 'strong';
  $('review-score').textContent = strong && metrics.length ? '4.8' : '3.2';
  $('review-copy').textContent = strong && metrics.length ? 'The headline is grounded in a controlled before/after measurement and keeps scope visible.' : 'Add explicit measurements and provenance before using this as a quantified resume claim.';
  $('opportunity-copy').textContent = artifact.impact_opportunities?.[0]?.recommended_measurement || 'No open evidence opportunities were reported.';
}

function loadFile(file) { const reader = new FileReader(); reader.onload = () => { try { render(JSON.parse(reader.result)); } catch { $('artifact-title').textContent = 'Could not read artifact'; } }; reader.readAsText(file); }
$('demo-button').addEventListener('click', () => render(demoArtifact));
$('artifact-input').addEventListener('change', (event) => { if (event.target.files[0]) loadFile(event.target.files[0]); });
render(demoArtifact);
