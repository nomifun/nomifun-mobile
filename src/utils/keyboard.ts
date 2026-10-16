interface EnterKeyEvent {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

/** IME confirmation must not submit a message. */
export function shouldSubmitOnEnter(event: EnterKeyEvent): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}
