/**
 * measurement/git-worktree.mjs — the ONE place ImpactCompiler creates or
 * removes a git worktree. Deliberately separate from evidence/git-adapter.mjs
 * (which is strictly read-only) because `git worktree add/remove` DOES
 * mutate repository state — but only its own administrative worktree
 * metadata and a brand-new temp directory, never the user's current
 * checkout, branches, commits, or untracked files. Every worktree this
 * module creates lives under a fresh `mkdtemp` directory and is always
 * removed (`removeWorktree`), which callers must invoke from a `finally`
 * block so cleanup runs even when the benchmark itself failed.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function git(args, cwd) {
  return execFileSync('git', args, {
    encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], cwd,
  }).trim();
}

/**
 * Resolves `ref` to a full commit SHA and verifies it names a real commit —
 * never a guess, never a partial match; `null` when it doesn't resolve.
 * @param {string} repoPath
 * @param {string} ref
 * @returns {string|null}
 */
export function resolveCommitSha(repoPath, ref) {
  try {
    return git(['-C', repoPath, 'rev-parse', '--verify', `${ref}^{commit}`]);
  } catch {
    return null;
  }
}

/**
 * Creates a fresh, detached git worktree checked out at `sha`, inside a new
 * temp directory — never touching the caller's current working tree.
 * @param {string} repoPath
 * @param {string} sha
 * @param {string} label - used only in the temp-dir name, for debuggability.
 * @returns {{worktreePath:string, parentDir:string}}
 */
export function createDetachedWorktree(repoPath, sha, label) {
  const parentDir = mkdtempSync(join(tmpdir(), `impact-compiler-wt-${label}-`));
  const worktreePath = join(parentDir, 'wt');
  git(['-C', repoPath, 'worktree', 'add', '--detach', worktreePath, sha]);
  return { worktreePath, parentDir };
}

/**
 * Removes a worktree created by `createDetachedWorktree`. Always attempted
 * even if the worktree/temp dir is already partly gone; failures are
 * returned as limitation strings — never thrown — so a cleanup problem is
 * recorded honestly without masking or replacing the original measurement
 * result/failure the caller is already handling in its own `finally`.
 * @returns {string[]} limitation strings, empty on full success.
 */
export function removeWorktree(repoPath, worktreePath, parentDir) {
  const limitations = [];
  try {
    git(['-C', repoPath, 'worktree', 'remove', '--force', worktreePath]);
  } catch (err) {
    limitations.push(`failed to remove git worktree "${worktreePath}": ${err.message}`);
  }
  try {
    rmSync(parentDir, { recursive: true, force: true });
  } catch (err) {
    limitations.push(`failed to remove temp directory "${parentDir}": ${err.message}`);
  }
  try {
    git(['-C', repoPath, 'worktree', 'prune']);
  } catch {
    // best-effort only — administrative metadata cleanup, not user data.
  }
  return limitations;
}
