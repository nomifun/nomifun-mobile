/**
 * Multi-select state for the requirements list — a small pure reducer so the
 * screen stays a renderer.
 *
 * Rules encoded here (all of them exist to keep `POST /api/requirements/batch-delete`
 * safe to reach from a phone):
 * - selection mode is entered by a long-press, which also selects that row;
 * - while it is active, tapping a row toggles it instead of navigating;
 * - deselecting the last row leaves the mode entirely, so "删除" can never be
 *   pressed with an empty set;
 * - after any refresh the selection is pruned against the rows that still
 *   exist, so a row deleted elsewhere cannot linger in a batch.
 *
 * No React, no I/O.
 */

export interface SelectionState {
  /** Multi-select mode is on: rows toggle, the action bar is visible. */
  active: boolean;
  /** Selected requirement ids, in pick order. */
  ids: readonly string[];
}

export const NO_SELECTION: SelectionState = { active: false, ids: [] };

/** Long-press: enter the mode with that row already selected. */
export function beginSelection(requirementId: string): SelectionState {
  return { active: true, ids: [requirementId] };
}

/**
 * Tap while selecting. Removing the last id exits the mode — an active bar with
 * "已选 0 项" is a trap, not a state.
 */
export function toggleSelection(state: SelectionState, requirementId: string): SelectionState {
  if (!state.active) return beginSelection(requirementId);
  if (!state.ids.includes(requirementId)) {
    return { active: true, ids: [...state.ids, requirementId] };
  }
  const ids = state.ids.filter((id) => id !== requirementId);
  return ids.length === 0 ? NO_SELECTION : { active: true, ids };
}

/** Every currently visible row is selected (and there is at least one). */
export function allSelected(state: SelectionState, visibleIds: readonly string[]): boolean {
  return visibleIds.length > 0 && visibleIds.every((id) => state.ids.includes(id));
}

/**
 * 全选 / 取消全选 over the rows currently on screen. Selecting all replaces the
 * set with exactly the visible rows, so what the count says is what will be
 * deleted; clearing exits the mode.
 */
export function toggleAll(state: SelectionState, visibleIds: readonly string[]): SelectionState {
  if (visibleIds.length === 0) return state;
  return allSelected(state, visibleIds) ? NO_SELECTION : { active: true, ids: [...visibleIds] };
}

/** Drop ids that no longer exist; an empty result exits the mode. */
export function pruneSelection(
  state: SelectionState,
  existingIds: readonly string[],
): SelectionState {
  if (!state.active) return state;
  const ids = state.ids.filter((id) => existingIds.includes(id));
  if (ids.length === 0) return NO_SELECTION;
  return ids.length === state.ids.length ? state : { active: true, ids };
}

export function isSelected(state: SelectionState, requirementId: string): boolean {
  return state.active && state.ids.includes(requirementId);
}
