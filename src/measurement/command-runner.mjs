/**
 * measurement/command-runner.mjs — the ONE place a benchmark/setup command
 * is spawned. Always `executable + args` invoked via `execFile` — never
 * `shell: true`, never a concatenated shell string — so there is no command
 * injection surface even though `executable`/`args` come from a
 * user-authored JSON file, and paths containing spaces work correctly on
 * every platform (Node quotes argv for CreateProcess on Windows itself;
 * execFile never goes through a shell to begin with). A timeout and an
 * output-size cap are always applied; exit codes and failure reasons
 * (including timeouts) are always reported back, never swallowed.
 */
import { execFile } from 'node:child_process';

export const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB stdout/stderr cap per run

/**
 * @param {{executable:string, args?:string[], cwd:string, timeoutMs:number, maxBuffer?:number}} opts
 * @returns {Promise<{ok:true, stdout:string, stderr:string}|
 *   {ok:false, stdout:string, stderr:string, exitCode:number|null, timedOut:boolean, reason:string}>}
 *   Never rejects — every failure mode (non-zero exit, timeout, spawn
 *   failure) resolves to an explicit `ok:false` result with a reason, so
 *   callers can never accidentally let an execution failure vanish into an
 *   unhandled rejection.
 */
export function runCommand({
  executable, args = [], cwd, timeoutMs, maxBuffer = DEFAULT_MAX_BUFFER,
}) {
  return new Promise((resolve) => {
    execFile(executable, args, {
      cwd, timeout: timeoutMs, maxBuffer, windowsHide: true, env: process.env,
    }, (error, stdout, stderr) => {
      if (error) {
        const timedOut = error.killed === true && error.signal != null;
        resolve({
          ok: false,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode: typeof error.code === 'number' ? error.code : null,
          timedOut,
          reason: timedOut
            ? `command timed out after ${timeoutMs}ms`
            : `command failed (exit code ${error.code ?? 'unknown'}): ${(stderr || error.message || '').toString().trim().slice(0, 500)}`,
        });
        return;
      }
      resolve({ ok: true, stdout, stderr });
    });
  });
}
