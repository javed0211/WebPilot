import { ConfigManager } from '../ConfigManager';

/**
 * Self-heal on ActHistory locator failure is ON by default.
 * Disable with: --no-heal  or  WEBPILOT_REPLAY_HEAL=0
 * Force on with: --heal   or  WEBPILOT_REPLAY_HEAL=1
 */
export function isReplayHealEnabled(): boolean {
  const env = process.env.WEBPILOT_REPLAY_HEAL?.trim().toLowerCase();
  if (env === '0' || env === 'false' || env === 'off' || env === 'no') return false;
  if (env === '1' || env === 'true' || env === 'on' || env === 'yes') return true;
  try {
    const cfg = ConfigManager.getInstance().get('framework.replayHeal', true);
    return cfg !== false;
  } catch {
    return true;
  }
}
