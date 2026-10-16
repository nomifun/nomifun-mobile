/**
 * Accessibility state helper.
 *
 * react-native-web 0.21 forwards only bare `aria-*` props to the DOM — its View
 * prop allow-list has no `accessibilityState` entry, so `accessibilityState={{
 * expanded }}` is silently dropped in the browser (no warning). Native, in
 * turn, reads `accessibilityState` and ignores nothing. Spreading this helper
 * emits both shapes, so a control announces its state on every platform.
 */
export interface A11yState {
  expanded?: boolean;
  selected?: boolean;
  checked?: boolean;
  disabled?: boolean;
  busy?: boolean;
}

export function a11yState(state: A11yState) {
  return {
    accessibilityState: state,
    ...(state.expanded !== undefined && { 'aria-expanded': state.expanded }),
    ...(state.selected !== undefined && { 'aria-selected': state.selected }),
    ...(state.checked !== undefined && { 'aria-checked': state.checked }),
    ...(state.disabled !== undefined && { 'aria-disabled': state.disabled }),
    ...(state.busy !== undefined && { 'aria-busy': state.busy }),
  } as const;
}
