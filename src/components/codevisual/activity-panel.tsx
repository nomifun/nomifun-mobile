import { useId, type ReactNode } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Interactive } from '@/components/ui/interactive';
import { Fonts, FontSize, Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';

export interface ActivityStep {
  key: string;
  kind: 'thinking' | 'tool';
  title: string;
  meta?: string;
  state: 'running' | 'done' | 'error' | 'pending';
  content?: ReactNode;
}

/** Native adaptation of codevisual-share's Tools disclosure and ActivityTimeline steps.
 * The caller supplies real states; the source gallery's simulated completion timers are omitted.
 */
export function ActivityPanel({
  title,
  summary,
  running,
  open,
  toggleLabel,
  onToggle,
  steps,
}: {
  title: string;
  summary: string;
  running: boolean;
  open: boolean;
  toggleLabel: string;
  onToggle: () => void;
  steps: readonly ActivityStep[];
}) {
  const { colors } = useTheme();
  const bodyId = useId();
  return (
    <View
      style={[styles.card, { backgroundColor: colors.surfaceMuted, borderColor: colors.borderLight }]}
    >
      <Interactive
        feedback={false}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={toggleLabel}
        {...a11yState({ expanded: open })}
        {...(Platform.OS === 'web' ? { 'aria-controls': open ? bodyId : undefined } : {})}
        onPress={onToggle}
        hitSlop={{ top: 6, bottom: 6 }}
        style={({ pressed }) => [
          styles.header,
          { backgroundColor: pressed ? colors.bgHover : 'transparent' },
        ]}
      >
        <View style={styles.headerIcon}>
          {running ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
          )}
        </View>
        <View style={styles.headerCopy}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.textSecondary }]}>
            {title}
          </Text>
          {summary ? (
            <Text numberOfLines={1} style={[styles.summary, { color: colors.textTertiary }]}>
              {summary}
            </Text>
          ) : null}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={colors.textTertiary} />
      </Interactive>
      {open ? (
        <View nativeID={bodyId} style={[styles.steps, { borderTopColor: colors.borderLight }]}>
          {steps.map((step, index) => (
            <ActivityTimelineStep
              key={step.key}
              step={step}
              last={index === steps.length - 1}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ActivityTimelineStep({ step, last }: { step: ActivityStep; last: boolean }) {
  const { colors } = useTheme();
  const error = step.state === 'error';
  const tone = error ? colors.danger : colors.textTertiary;
  const isTool = step.kind === 'tool';
  return (
    <View style={styles.step}>
      <View style={styles.rail}>
        <View
          style={[styles.node, { backgroundColor: error ? colors.dangerSoft : colors.primarySoft }]}
        >
          {step.state === 'running' ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons
              name={error ? 'alert-circle-outline' : isTool ? 'construct-outline' : 'bulb-outline'}
              size={13}
              color={tone}
            />
          )}
        </View>
        {!last ? <View style={[styles.connector, { backgroundColor: colors.borderLight }]} /> : null}
      </View>
      <View style={[styles.stepCopy, !last && styles.stepGap]}>
        <View style={styles.stepHeader}>
          <Text
            style={[styles.stepTitle, isTool && styles.toolName, { color: colors.textSecondary }]}
          >
            {step.title}
          </Text>
          {isTool && step.state === 'done' ? (
            <Ionicons name="checkmark-circle-outline" size={14} color={tone} />
          ) : null}
          {step.meta ? (
            <Text style={[styles.stepMeta, { color: tone }]}>{step.meta}</Text>
          ) : null}
        </View>
        {step.content}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: Radius.md,
    marginBottom: Spacing.sm,
    maxWidth: '100%',
  },
  header: {
    borderRadius: Radius.md,
    minHeight: Layout.compactControlHeight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  headerIcon: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { fontSize: FontSize.control, fontWeight: '500', lineHeight: 18 },
  summary: { flexShrink: 1, fontSize: FontSize.xs, lineHeight: 18 },
  steps: { borderTopWidth: 1, padding: Spacing.sm },
  step: { flexDirection: 'row', gap: Spacing.sm, minWidth: 0 },
  rail: { width: 24, alignItems: 'center' },
  node: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: { width: 1, flex: 1, marginVertical: Spacing.xs, minHeight: Spacing.sm },
  stepCopy: { flex: 1, minWidth: 0, paddingTop: 2 },
  stepGap: { paddingBottom: Spacing.sm },
  stepHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  stepTitle: { flexShrink: 1, fontSize: FontSize.control, fontWeight: '500', lineHeight: 20 },
  toolName: { fontFamily: Fonts.mono },
  stepMeta: { fontSize: FontSize.xs, lineHeight: 18 },
});
