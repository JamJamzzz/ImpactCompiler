/**
 * evidence/git-adapter.mjs — the ONE read-only git subprocess wrapper in
 * ImpactCompiler. Every function here calls a strictly read-only git
 * subcommand (show/log/diff/rev-parse/merge-base/branch/cat-file); none can
 * mutate the source repository, and none touch any host system's domain
 * model. Never sends the whole repository anywhere — `getCommitPatch`
 * truncates and records that it did.
 *
 * Exports two levels:
 *  - low-level primitives (getRepoIdentity, getHeadCommit, commitExists) —
 *    cheap, directly reusable by a host integration that needs a single git
 *    fact without running the full evidence pipeline or spawning the CLI.
 *  - buildCommitEvidencePacket — the full normalized packet the analysis
 *    pipeline consumes.
 */
import { execFileSync } from 'child_process';

const MAX_BUFFER = 20 * 1024 * 1024;

function git(repoPath, args) {
  return execFileSync('git', ['-C', repoPath, ...args], {
    encoding: 'utf-8', maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function tryGit(repoPath, args, fallback = null) {
  try {
    return git(repoPath, args);
  } catch {
    return fallback;
  }
}

/** @returns {string} remote origin URL if present, else the resolved local repo path. */
export function getRepoIdentity(repoPath) {
  const remote = tryGit(repoPath, ['remote', 'get-url', 'origin']);
  if (remote) return remote;
  return tryGit(repoPath, ['rev-parse', '--show-toplevel']) || repoPath;
}

/** @returns {string|null} current HEAD commit SHA, or null if unresolvable. */
export function getHeadCommit(repoPath) {
  return tryGit(repoPath, ['rev-parse', 'HEAD']);
}

/** @returns {boolean} whether `sha` resolves to a real commit in this repo. */
export function commitExists(repoPath, sha) {
  try {
    git(repoPath, ['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function getCommitMetadata(repoPath, sha) {
  if (!commitExists(repoPath, sha)) return null;
  const raw = git(repoPath, ['show', '-s', '--format=%H%x1f%an%x1f%ae%x1fID%x1f%cn%x1f%ce%x1f%cI%x1f%s%x1f%b', sha]);
  const [full, authorName, authorEmail, authoredAt, committerName, committerEmail, committedAt, subject, ...bodyParts] = raw.split('\x1f');
  return {
    sha: full,
    author_name: authorName,
    author_email: authorEmail,
    authored_at: authoredAt,
    committer_name: committerName,
    committer_email: committerEmail,
    committed_at: committedAt,
    subject,
    body: bodyParts.join('\x1f').trim(),
  };
}

/**
 * Provenance-only file/line-count stats — raw LOC must never become an
 * Impact metric; this exists purely so evidence can honestly say "N files
 * touched," never so a downstream claim can mint a metric from it.
 */
function getCommitFileStats(repoPath, sha) {
  const raw = tryGit(repoPath, ['diff-tree', '--no-commit-id', '--numstat', '-r', sha], '');
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => {
    const [add, del, file] = line.split('\t');
    return {
      file,
      additions: add === '-' ? null : Number(add),
      deletions: del === '-' ? null : Number(del),
    };
  });
}

/** @returns {{patch:string, truncated:boolean}} truncation is always recorded, never silent. */
function getCommitPatch(repoPath, sha, maxChars = 8000) {
  const full = tryGit(repoPath, ['show', '--patch', '--format=', sha], '') || '';
  if (full.length <= maxChars) return { patch: full, truncated: false };
  return { patch: `${full.slice(0, maxChars)}\n... [truncated, ${full.length - maxChars} more characters not sent]`, truncated: true };
}

function isAncestorOf(repoPath, sha, ref) {
  if (!tryGit(repoPath, ['rev-parse', '--verify', ref])) return null;
  try {
    git(repoPath, ['merge-base', '--is-ancestor', sha, ref]);
    return true;
  } catch {
    return false;
  }
}

function branchesContaining(repoPath, sha) {
  const raw = tryGit(repoPath, ['branch', '--all', '--contains', sha], '') || '';
  return raw.split('\n').map((l) => l.replace(/^\*?\s*/, '').trim()).filter(Boolean);
}

function getParents(repoPath, sha) {
  const raw = tryGit(repoPath, ['show', '-s', '--format=%P', sha], '') || '';
  return raw.split(/\s+/).filter(Boolean);
}

/**
 * Builds one minimized, normalized commit evidence record. Downstream code
 * should consume THIS, never re-shell out to git independently, and never
 * receive the full repository.
 * @param {string} repoPath
 * @param {string} sha
 * @param {{developRef?:string, mainRef?:string, patchMaxChars?:number}} [opts]
 * @returns {object|null} null if the commit does not exist.
 */
export function buildCommitEvidencePacket(repoPath, sha, opts = {}) {
  const metadata = getCommitMetadata(repoPath, sha);
  if (!metadata) return null;
  const fileStats = getCommitFileStats(repoPath, sha);
  const { patch, truncated } = getCommitPatch(repoPath, sha, opts.patchMaxChars);
  return {
    repo_identity: getRepoIdentity(repoPath),
    ...metadata,
    files_touched: fileStats.map((f) => f.file),
    file_stats: fileStats,
    parents: getParents(repoPath, sha),
    reachable_from_develop: opts.developRef ? isAncestorOf(repoPath, sha, opts.developRef) : null,
    reachable_from_main: opts.mainRef ? isAncestorOf(repoPath, sha, opts.mainRef) : null,
    branches_containing: branchesContaining(repoPath, sha),
    patch,
    patch_truncated: truncated,
  };
}
