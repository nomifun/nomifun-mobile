/**
 * "Working directory" field of the create-project form: shows the chosen
 * absolute path (full path, not a basename — this is the one place the user
 * must be able to double-check what the agent will get) or invites a pick.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, Card } from '@/components/ui';
import { Fonts, FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface DirectoryFieldProps {
  /** Canonical absolute path from the picker, or undefined when unset. */
  path?: string;
  error?: string;
  onPress: () => void;
}

export function DirectoryField({ path, error, onPress }: DirectoryFieldProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('project');

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {t('create.directoryLabel')}
      </Text>

      <Card style={[styles.card, error ? { borderColor: colors.danger } : null]}>
        {path ? (
          <>
            <View style={styles.pathRow}>
              <Ionicons name="folder-open-outline" size={18} color={colors.primary} />
              <Text style={[styles.path, { color: colors.text }]} selectable>
                {path}
              </Text>
            </View>
            <Button variant="secondary" small onPress={onPress} style={styles.action}>
              {t('create.change')}
            </Button>
          </>
        ) : (
          <>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {t('create.unselectedTitle')}
            </Text>
            <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
              {t('create.unselectedHint')}
            </Text>
            <Button onPress={onPress} style={styles.action}>
              {t('create.pick')}
            </Button>
          </>
        )}
      </Card>

      {error ? (
        <Text style={[styles.footnote, { color: colors.danger }]}>{error}</Text>
      ) : (
        <Text style={[styles.footnote, { color: colors.textTertiary }]}>
          {t('create.intro')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: Spacing.lg },
  label: { fontSize: FontSize.sm, fontWeight: '500', marginBottom: Spacing.xs },
  card: { gap: Spacing.md },
  pathRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  path: { flex: 1, fontSize: FontSize.sm, lineHeight: 20, fontFamily: Fonts.mono },
  emptyTitle: { fontSize: FontSize.md, fontWeight: '600' },
  emptyHint: { fontSize: FontSize.sm, lineHeight: 19 },
  action: { alignSelf: 'flex-start' },
  footnote: { fontSize: FontSize.xs, lineHeight: 17, marginTop: Spacing.xs },
});
