import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import {
  choiceFallbackLabel,
  choiceLabelKey,
  isAlwaysChoice,
  isDenyChoice,
  isRiskyConfirmation,
  type ConfirmationChoice,
  type PendingConfirmation,
} from '../confirmations';

interface ConfirmationCardProps {
  confirmation: PendingConfirmation;
  /** True while this card's answer is in flight. */
  busy?: boolean;
  /** Another card is answering — keep this one inert but visible. */
  locked?: boolean;
  onRespond: (choice: ConfirmationChoice) => void;
}

/**
 * One pending tool approval, pinned above the transcript.
 *
 * While a confirmation is open the server reports
 * `runtime.can_send_message === false`, so the composer is already disabled —
 * this card is the only way forward, and it must never cover the input.
 */
export function ConfirmationCard({
  confirmation,
  busy,
  locked,
  onRespond,
}: ConfirmationCardProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');
  /** Which option was tapped — only that button spins. */
  const [chosen, setChosen] = useState<string | null>(null);

  const risky = isRiskyConfirmation(confirmation);
  const accent = risky ? colors.warning : colors.primary;
  const title = confirmation.title?.trim() || t('confirmation.title');
  const detail = confirmation.description?.trim();
  const showDetail = !!detail && detail !== title;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: risky ? colors.warningSoft : colors.primarySoft,
          borderColor: accent,
        },
      ]}
    >
      <View style={styles.header}>
        <Ionicons
          name={risky ? 'warning-outline' : 'shield-checkmark-outline'}
          size={18}
          color={accent}
        />
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={3}>
          {title}
        </Text>
      </View>

      <View style={styles.metaRow}>
        {confirmation.action ? (
          <View style={[styles.pill, { backgroundColor: colors.surface }]}>
            <Ionicons name="construct-outline" size={11} color={colors.textTertiary} />
            <Text style={[styles.pillText, { color: colors.textSecondary }]} numberOfLines={1}>
              {confirmation.action}
            </Text>
          </View>
        ) : null}
        {confirmation.commandType ? (
          <View style={[styles.pill, { backgroundColor: colors.surface }]}>
            <Text style={[styles.pillText, { color: colors.textSecondary }]} numberOfLines={1}>
              {confirmation.commandType}
            </Text>
          </View>
        ) : null}
      </View>

      {showDetail ? (
        <Text style={[styles.detail, { color: colors.textSecondary }]} numberOfLines={8}>
          {detail}
        </Text>
      ) : null}

      {confirmation.screenshot ? (
        <Text style={[styles.note, { color: colors.textTertiary }]}>
          {t('confirmation.screenshotHint')}
        </Text>
      ) : null}

      {confirmation.options.length === 0 ? (
        <Text style={[styles.note, { color: colors.textTertiary }]}>
          {t('confirmation.noOptions')}
        </Text>
      ) : (
        <View style={styles.actions}>
          <Text style={[styles.prompt, { color: colors.textTertiary }]}>
            {t('confirmation.choose')}
          </Text>
          {confirmation.options.map((choice) => {
            const key = choiceLabelKey(choice);
            const deny = isDenyChoice(choice);
            const pending = busy && chosen === choice.value;
            return (
              <Button
                key={choice.value}
                // "Always" is the same decision as "once" with a wider scope —
                // muted so the safer one-shot stays the obvious default.
                variant={deny ? 'danger' : isAlwaysChoice(choice) ? 'secondary' : 'primary'}
                disabled={locked || (busy && !pending)}
                loading={pending}
                onPress={() => {
                  setChosen(choice.value);
                  onRespond(choice);
                }}
                style={styles.action}
              >
                {key ? t(key) : choiceFallbackLabel(choice)}
              </Button>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.md,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  title: { flex: 1, fontSize: FontSize.md, fontWeight: '600', lineHeight: 21 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    maxWidth: '100%',
  },
  pillText: { fontSize: FontSize.xs, fontWeight: '500', flexShrink: 1 },
  detail: { fontSize: FontSize.sm, lineHeight: 19 },
  note: { fontSize: FontSize.xs, lineHeight: 17 },
  prompt: { fontSize: FontSize.xs, marginBottom: Spacing.xs },
  actions: { gap: Spacing.sm },
  action: { alignSelf: 'stretch' },
});
