/**
 * config/config.mjs — resolves which LLMProvider implementation to use.
 * Currently only 'claude-cli' is implemented; 'off' explicitly disables
 * provider analysis (result: analysis_status "pending_llm" by design, not
 * as a fallback from an unavailable CLI).
 */
import { ClaudeCliProvider, claudeCliAvailable } from '../providers/claude-cli-provider.mjs';

/**
 * @param {{provider?:string, providerOptions?:object}} flags
 * @returns {{provider:import('../providers/llm-provider.mjs').default|null, reason?:string}}
 */
export function resolveProvider(flags = {}) {
  const name = flags.provider ?? 'claude-cli';
  if (name === 'off') return { provider: null, reason: 'provider explicitly disabled (--provider off)' };
  if (name === 'claude-cli') {
    if (!claudeCliAvailable(flags.providerOptions)) {
      return { provider: null, reason: 'claude CLI not available on this system' };
    }
    return { provider: new ClaudeCliProvider(flags.providerOptions) };
  }
  throw new Error(`unknown provider "${name}" — supported: claude-cli, off`);
}
