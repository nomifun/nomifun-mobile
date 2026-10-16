import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Markdown, { MarkdownIt, renderRules, type RenderRules } from 'react-native-markdown-display';

import { Motion } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import {
  advanceTextReveal,
  createTextBuffer,
  initialTextReveal,
  markdownNodeKey,
} from './response-motion';

const responseParser = new MarkdownIt({ typographer: true });

/** AiChat port: short staggered fades on new output, without replaying the existing transcript. */
export const AiResponse = memo(function AiResponse({
  text,
  streaming,
  style,
}: {
  text: string;
  streaming: boolean;
  style: Record<string, TextStyle | ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const animate = streaming && !reduced;
  const [painted, setPainted] = useState(text);
  const buffer = useMemo(() => createTextBuffer(setPainted, Motion.responseCadence), []);
  useLayoutEffect(() => {
    if (!animate || !text.startsWith(painted)) buffer.push(text, true);
    else if (text !== painted) buffer.push(text, false);
  }, [animate, buffer, painted, text]);
  useEffect(() => () => buffer.clear(), [buffer]);
  const visible = animate && text.startsWith(painted) ? painted : text;
  const rules = useMemo<RenderRules>(
    () =>
      Object.fromEntries(
        Object.entries(renderRules).map(([type, render]) => [
          type,
          (node, children, parents, styles, ...extra) => {
            const key = markdownNodeKey(node, parents);
            if (type === 'text') {
              return (
                <RevealText
                  key={key}
                  text={node.content}
                  animate={animate}
                  style={[extra[0], styles.text]}
                />
              );
            }
            return render?.({ ...node, key }, children, parents, styles, ...extra);
          },
        ]),
      ),
    [animate],
  );
  return (
    <Markdown style={style} rules={rules} markdownit={responseParser}>
      {visible}
    </Markdown>
  );
});

function RevealText({
  text,
  animate,
  style,
}: {
  text: string;
  animate: boolean;
  style: StyleProp<TextStyle>;
}) {
  const [reveal, setReveal] = useState(() => initialTextReveal(text, animate, Date.now()));
  // Updating during render prevents a frame with stale text, including authoritative replacements.
  const current =
    reveal.text !== text || (!animate && reveal.runs.length > 0)
      ? advanceTextReveal(reveal, text, animate, Date.now(), Motion.responseFade)
      : reveal;
  if (current !== reveal) setReveal(current);
  return (
    <Text style={style}>
      {text.slice(0, current.settled)}
      {current.runs.map((run) => (
        <FadingText key={run.id} text={run.text} />
      ))}
    </Text>
  );
}

function FadingText({ text }: { text: string }) {
  const opacity = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: Motion.responseFade,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return <Animated.Text style={{ opacity }}>{text}</Animated.Text>;
}
