/**
 * Pure planning logic for 渠道机器人绑定.
 *
 * `PUT /api/customer-service/agents/{cs_agent_id}/bindings` takes
 * `{channel_plugin_ids}` and is a **whole-set replacement** for that agent:
 * whatever is missing from the list is unbound, and a bot currently bound to
 * ANOTHER customer-service agent is re-bound (stolen) without complaint —
 * same-domain rebind is allowed and covered by server tests.
 *
 * Two consequences the UI must respect and this module makes explicit:
 * 1. every toggle sends "currently bound ± this one", never just the one bot —
 *    so the caller must know the authoritative bound set before writing
 *    (`nextBindingIds` refuses to guess: it works off the set it is given);
 * 2. an empty list unbinds everything, so `plan.unbindsAll` is surfaced and the
 *    screen confirms before sending it.
 *
 * No React, no I/O.
 */
import type { ChannelPluginStatus } from './types';

/** What a toggle means for one bot, and the exact list to PUT. */
export interface BindingPlan {
  /** `bind` = free bot, `steal` = taken from another agent, `unbind` = release. */
  kind: 'bind' | 'steal' | 'unbind';
  /** The FULL next binding set for this agent (what goes on the wire). */
  nextIds: string[];
  /** Only set for `steal`: the agent losing the bot. */
  fromAgentId?: string;
  /** True when the PUT sends `[]` — this agent stops serving visitors entirely. */
  unbindsAll: boolean;
}

/**
 * Plugin ids currently bound to `csAgentId`, in bot-pool display order.
 *
 * Derived from the same ownership map the rows render from, so the list we PUT
 * can never disagree with the tags the user is looking at.
 */
export function boundPluginIds(
  bots: readonly ChannelPluginStatus[],
  csAgentId: string,
  ownerByBot: ReadonlyMap<string, string>,
): string[] {
  return bots
    .filter((bot) => ownerByBot.get(bot.plugin_id) === csAgentId)
    .map((bot) => bot.plugin_id);
}

/**
 * Next full binding set: append (once) when binding, drop when unbinding.
 * Order is preserved so a no-op toggle round-trip produces the same list.
 */
export function nextBindingIds(
  current: readonly string[],
  pluginId: string,
  bind: boolean,
): string[] {
  if (!bind) return current.filter((id) => id !== pluginId);
  return current.includes(pluginId) ? [...current] : [...current, pluginId];
}

/**
 * Turn "the user tapped this row's switch" into the wire payload plus the
 * consequences the confirmation dialog has to state.
 */
export function planBindingChange(input: {
  pluginId: string;
  csAgentId: string;
  /** Authoritative ids currently bound to THIS agent. */
  boundIds: readonly string[];
  /** channel_plugin_id → owning cs_agent_id, across every agent. */
  ownerByBot: ReadonlyMap<string, string>;
}): BindingPlan {
  const { pluginId, csAgentId, boundIds, ownerByBot } = input;
  const owner = ownerByBot.get(pluginId);
  if (owner === csAgentId) {
    const nextIds = nextBindingIds(boundIds, pluginId, false);
    return { kind: 'unbind', nextIds, unbindsAll: nextIds.length === 0 };
  }
  const nextIds = nextBindingIds(boundIds, pluginId, true);
  return owner == null
    ? { kind: 'bind', nextIds, unbindsAll: false }
    : { kind: 'steal', nextIds, fromAgentId: owner, unbindsAll: false };
}

/**
 * Ownership map after a successful replacement, used for the optimistic
 * update: this agent owns exactly `nextIds`, and every id it took is removed
 * from whoever held it before (that is what the server does).
 */
export function ownershipAfterReplace(
  ownerByBot: ReadonlyMap<string, string>,
  csAgentId: string,
  nextIds: readonly string[],
): Map<string, string> {
  const next = new Map<string, string>();
  for (const [pluginId, agentId] of ownerByBot) {
    if (agentId === csAgentId) continue; // re-added below from nextIds
    if (nextIds.includes(pluginId)) continue; // stolen by this agent
    next.set(pluginId, agentId);
  }
  for (const pluginId of nextIds) next.set(pluginId, csAgentId);
  return next;
}
