import type { WebPilotFeatureFlags } from '../lifecycle/FeatureFlags';
import type {
  HealingClassification,
  HealingCommitDecision,
  HealingTransactionState,
} from './HealingTypes';

/**
 * Decide whether a heal may update trusted cache/inventory.
 *
 * - classification off + legacy commit: commit on action success (compat)
 * - classification off + postvalidated: commit only when action succeeded (still no silent cache-on-propose)
 * - shadow: classify for evidence; commit follows commitPolicy (does not block)
 * - enforce: only likely_intentional_refactor may commit
 */
export class HealingCommitPolicy {
  public static decide(
    classification: HealingClassification,
    flags: WebPilotFeatureFlags,
    opts: { actionSucceeded: boolean } = { actionSucceeded: true }
  ): HealingCommitDecision {
    const { actionSucceeded } = opts;

    if (!actionSucceeded) {
      return {
        commit: false,
        state: 'rejected',
        reason: 'Action did not succeed after heal — not committing',
        classification,
      };
    }

    if (flags.healingClassification === 'enforce') {
      if (classification.label === 'likely_intentional_refactor') {
        return {
          commit: true,
          state: 'committed',
          reason: 'enforce: likely intentional refactor with validated outcome',
          classification,
        };
      }
      const state: HealingTransactionState =
        classification.label === 'possible_regression' ? 'rejected' : 'quarantined';
      return {
        commit: false,
        state,
        reason: `enforce: ${classification.label} — proposal kept for review, trusted state unchanged`,
        classification,
      };
    }

    // shadow or off
    if (flags.healingCommitPolicy === 'postvalidated') {
      if (classification.label === 'possible_regression') {
        return {
          commit: false,
          state: 'rejected',
          reason: 'postvalidated: possible regression — not committing',
          classification,
        };
      }
      if (classification.label === 'likely_intentional_refactor') {
        return {
          commit: true,
          state: 'committed',
          reason:
            flags.healingClassification === 'shadow'
              ? 'shadow+postvalidated: committing validated refactor (classification recorded)'
              : 'postvalidated: committing validated refactor',
          classification,
        };
      }
      // inconclusive under postvalidated — do not commit trusted state
      return {
        commit: false,
        state: 'quarantined',
        reason: 'postvalidated: inconclusive — proposal only until business proof exists',
        classification,
      };
    }

    // legacy commit policy: allow commit after successful action (compat)
    return {
      commit: true,
      state: flags.healingClassification === 'shadow' ? 'committed' : 'legacy',
      reason:
        flags.healingClassification === 'shadow'
          ? 'shadow+legacy: committing after successful action; classification recorded for review'
          : 'legacy: committing after successful healed action',
      classification,
    };
  }
}
