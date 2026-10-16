export interface RevealRun {
  id: number;
  text: string;
  startedAt: number;
}

export interface TextReveal {
  text: string;
  settled: number;
  runs: RevealRun[];
  sequence: number;
}

const MAX_REVEAL_RUNS = 6;

export function initialTextReveal(text: string, animate: boolean, now: number): TextReveal {
  return {
    text,
    settled: animate ? 0 : text.length,
    runs: animate && text ? [{ id: 0, text, startedAt: now }] : [],
    sequence: 1,
  };
}

/** Animate appended text only. Corrections and completion are authoritative immediately. */
export function advanceTextReveal(
  previous: TextReveal,
  text: string,
  animate: boolean,
  now: number,
  fadeDuration: number,
): TextReveal {
  if (!animate || !text.startsWith(previous.text)) return initialTextReveal(text, false, now);
  if (text === previous.text) return previous;
  const runs = [...previous.runs];
  let settled = previous.settled;
  while (runs.length && now - runs[0].startedAt >= fadeDuration) {
    settled += runs.shift()!.text.length;
  }
  runs.push({ id: previous.sequence, text: text.slice(previous.text.length), startedAt: now });
  while (runs.length > MAX_REVEAL_RUNS) settled += runs.shift()!.text.length;
  return { text, settled, runs, sequence: previous.sequence + 1 };
}

interface MarkdownIdentity {
  type: string;
  index?: number;
}

/** The Markdown library generates new random keys on every delta; use structural identities. */
export function markdownNodeKey(node: MarkdownIdentity, parents: readonly MarkdownIdentity[]) {
  return JSON.stringify(
    [...parents]
      .reverse()
      .concat(node)
      .map((item) => [item.type, item.index ?? 0]),
  );
}

export function createTextBuffer(
  publish: (text: string) => void,
  cadence: number,
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest = '';
  const clear = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  return {
    push(text: string, immediate: boolean) {
      latest = text;
      if (immediate) {
        clear();
        publish(text);
      } else if (timer === null) {
        timer = schedule(() => {
          timer = null;
          publish(latest);
        }, cadence);
      }
    },
    clear,
  };
}
