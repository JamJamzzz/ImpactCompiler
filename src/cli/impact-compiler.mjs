#!/usr/bin/env node
/**
 * cli/impact-compiler.mjs — ImpactCompiler CLI.
 *
 * Usage:
 *   node src/cli/impact-compiler.mjs analyze
 *     [--repo <path> --commit <sha> ...]  (repeatable pair)
 *     [--benchmark <path> ...] [--test-artifact <path> ...]
 *     [--test-result <path> ...]                                              (V2 P1, repeatable)
 *     [--pr <path> ...] [--ticket <path> ...]                                  (V2, repeatable)
 *     [--production-metric <path> ...] [--log <path> ...] [--observability <path> ...]  (V3, repeatable)
 *     [--note <path> ...] [--slack-export <path> ...] [--document <path> ...]  (V4, repeatable)
 *     [--measurement-plan <path> ...]                                         (V5, repeatable)
 *     [--quantitative-fact <path> ...] [--derivation <path> ...]              (Resume-Impact, repeatable)
 *     --output <dir> [--provider claude-cli|off] [--json]
 *
 * Exit codes: 0 success (analyzed) / 1 usage or validation error /
 *   2 partial success (analysis_status: pending_llm — no LLM runtime available).
 */
import { analyzeImpact, writeImpactArtifact } from '../core/impact-compiler.mjs';
import { resolveProvider } from '../config/config.mjs';

function printUsage() {
  console.log(`
Usage:
  node src/cli/impact-compiler.mjs analyze --repo <path> --commit <sha> [--repo <path2> --commit <sha2>]
    [--benchmark <path> ...] [--test-artifact <path> ...] [--test-result <path> ...]
    [--pr <path> ...] [--ticket <path> ...]
    [--production-metric <path> ...] [--log <path> ...] [--observability <path> ...]
    [--note <path> ...] [--slack-export <path> ...] [--document <path> ...]
    [--measurement-plan <path> ...]
    [--quantitative-fact <path> ...] [--derivation <path> ...]
    --output <dir> [--provider claude-cli|off] [--json]
`);
}

const REPEATABLE_PATH_FLAGS = {
  '--benchmark': 'benchmarkPaths',
  '--test-artifact': 'testArtifactPaths',
  '--test-result': 'testResultPaths',
  '--pr': 'prPaths',
  '--ticket': 'ticketPaths',
  '--production-metric': 'productionMetricPaths',
  '--log': 'logPaths',
  '--observability': 'observabilityPaths',
  '--note': 'notePaths',
  '--slack-export': 'slackPaths',
  '--document': 'documentPaths',
  '--measurement-plan': 'measurementPlanPaths',
  '--quantitative-fact': 'quantitativeFactPaths',
  '--derivation': 'derivationPaths',
};

function parseAnalyzeArgs(argv) {
  const flags = { commits: [], provider: 'claude-cli', json: false };
  for (const field of Object.values(REPEATABLE_PATH_FLAGS)) flags[field] = [];

  let currentRepo = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo') { currentRepo = argv[++i]; }
    else if (arg === '--commit') {
      if (!currentRepo) { console.error('Error: --commit must follow a --repo'); process.exit(1); }
      flags.commits.push({ repo: currentRepo, sha: argv[++i] });
    } else if (REPEATABLE_PATH_FLAGS[arg]) flags[REPEATABLE_PATH_FLAGS[arg]].push(argv[++i]);
    else if (arg === '--output') flags.output = argv[++i];
    else if (arg === '--provider') flags.provider = argv[++i];
    else if (arg === '--json') flags.json = true;
    else { console.error(`Unknown argument: ${arg}`); printUsage(); process.exit(1); }
  }
  return flags;
}

async function cmdAnalyze(argv) {
  const flags = parseAnalyzeArgs(argv);
  if (!flags.output) { console.error('Error: --output <dir> is required.'); process.exit(1); }

  const hasAnyInput = flags.commits.length || Object.values(REPEATABLE_PATH_FLAGS).some((field) => flags[field].length);
  if (!hasAnyInput) {
    console.error('Error: supply at least one --repo/--commit pair, --benchmark, --test-artifact, --test-result, --pr, --ticket, --production-metric, --log, --observability, --note, --slack-export, --document, --measurement-plan, --quantitative-fact, or --derivation.');
    process.exit(1);
  }

  const { provider, reason } = resolveProvider({ provider: flags.provider });
  if (!provider && flags.provider !== 'off') console.error(`Warning: ${reason} — proceeding with analysis_status "pending_llm".`);

  let artifact;
  try {
    artifact = await analyzeImpact({
      commits: flags.commits,
      benchmarkPaths: flags.benchmarkPaths,
      testArtifactPaths: flags.testArtifactPaths,
      testResultPaths: flags.testResultPaths,
      prPaths: flags.prPaths,
      ticketPaths: flags.ticketPaths,
      productionMetricPaths: flags.productionMetricPaths,
      logPaths: flags.logPaths,
      observabilityPaths: flags.observabilityPaths,
      notePaths: flags.notePaths,
      slackPaths: flags.slackPaths,
      documentPaths: flags.documentPaths,
      measurementPlanPaths: flags.measurementPlanPaths,
      quantitativeFactPaths: flags.quantitativeFactPaths,
      derivationPaths: flags.derivationPaths,
      provider,
    });
  } catch (err) {
    console.error(`Error: analysis failed: ${err.message}`);
    process.exit(1);
  }

  const { impactJsonPath, reviewMdPath } = writeImpactArtifact(artifact, flags.output);

  if (flags.json) {
    console.log(JSON.stringify({
      status: artifact.run.analysis_status, impactJsonPath, reviewMdPath,
    }, null, 2));
  } else {
    console.log(`\nWrote:\n${impactJsonPath}\n${reviewMdPath}\n`);
    console.log(`Status: ${artifact.run.analysis_status}`);
    console.log(`Claims: ${artifact.claims.length}, Metrics: ${artifact.metrics.length}, Evidence: ${artifact.evidence.length}\n`);
  }

  process.exit(artifact.run.analysis_status === 'pending_llm' ? 2 : 0);
}

async function main() {
  const [, , command, ...rest] = process.argv;
  if (command === 'analyze') await cmdAnalyze(rest);
  else { printUsage(); process.exit(1); }
}

main();
