import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Button, Card, EmptyState, ErrorState, Loading, Tag } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteProviderConnection } from '@/features/models/api';
import { confirmDestructive } from '@/features/models/confirm';
import { errorMessage } from '@/features/models/errors';
import { isVolcArkPlatform } from '@/features/models/connection-form';
import { useProviderConnections } from '@/features/models/hooks';
import type { ProviderConnectionResponse } from '@/features/models/types';
import { ProviderConnectionSheet } from './provider-connection-sheet';
import { a11yState } from '@/utils/a11y';

interface ProviderConnectionsSectionProps {
  providerId: string;
  platform: string;
  readOnly?: boolean;
}

interface EditorState {
  editing?: ProviderConnectionResponse;
  prefillRole?: string;
  prefillScheme?: string;
}

/**
 * Named connection profiles are intentionally separate from the provider's
 * default connection. The section is compact on mobile, while the editor
 * remains a full bottom sheet with inline validation feedback.
 */
export function ProviderConnectionsSection({
  providerId,
  platform,
  readOnly = false,
}: ProviderConnectionsSectionProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');
  const { connections, error, isLoading, mutate } = useProviderConnections(
    providerId,
    !readOnly,
  );
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busyRole, setBusyRole] = useState('');
  const [actionError, setActionError] = useState('');

  if (readOnly) return null;

  const namedConnections = connections.filter((connection) => connection.role !== 'default');
  const showVoiceHint = isVolcArkPlatform(platform);

  const remove = (connection: ProviderConnectionResponse) => {
    confirmDestructive({
      title: t('connections.delete'),
      message: t('connections.deleteConfirm', { role: connection.role }),
      confirmLabel: tc('actions.delete'),
      cancelLabel: tc('actions.cancel'),
      onConfirm: () => {
        void (async () => {
          setBusyRole(connection.role);
          setActionError('');
          try {
            await deleteProviderConnection(providerId, connection.role);
            await mutate();
          } catch (reason) {
            setActionError(errorMessage(reason, tc('feedback.requestFailed')));
          } finally {
            setBusyRole('');
          }
        })();
      },
    });
  };

  return (
    <>
      <View style={styles.heading}>
        <View style={styles.headingText}>
          <Text style={[styles.title, { color: colors.text }]}>{t('connections.title')}</Text>
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            {t('connections.hint')}
          </Text>
        </View>
        <Button
          small
          variant="secondary"
          onPress={() => {
            setActionError('');
            setEditor({});
          }}
        >
          {t('connections.add')}
        </Button>
      </View>

      <Card>
        {showVoiceHint ? (
          <View style={[styles.voiceHint, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="mic-outline" size={18} color={colors.primary} />
            <View style={styles.flex}>
              <Text style={[styles.voiceText, { color: colors.primary }]}>
                {t('connections.voiceHint')}
              </Text>
              <Button
                small
                variant="ghost"
                onPress={() =>
                  setEditor({
                    prefillRole: 'voice',
                    prefillScheme: 'volc_voice',
                  })
                }
              >
                {t('connections.voiceHintAction')}
              </Button>
            </View>
          </View>
        ) : null}

        {isLoading && connections.length === 0 ? (
          <Loading label={tc('state.loading')} />
        ) : null}
        {error && connections.length === 0 ? (
          <ErrorState
            message={t('connections.loadFailed')}
            onRetry={() => void mutate()}
            retryLabel={tc('actions.retry')}
          />
        ) : null}
        {!isLoading && !error && namedConnections.length === 0 ? (
          <EmptyState
            icon="link-outline"
            title={t('connections.empty')}
            description={t('connections.emptyHint')}
          />
        ) : null}

        {namedConnections.map((connection) => (
          <View
            key={connection.connection_id || connection.role}
            style={[styles.connection, { borderColor: colors.border }]}
          >
            <View style={styles.connectionInfo}>
              <View style={styles.connectionTitle}>
                <Tag tone="primary">{connection.role}</Tag>
                {connection.label ? (
                  <Text style={[styles.labelText, { color: colors.text }]} numberOfLines={1}>
                    {connection.label}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.url, { color: colors.textSecondary }]} numberOfLines={2}>
                {connection.base_url}
              </Text>
              <View style={styles.meta}>
                <Tag tone="neutral">{connection.auth_scheme}</Tag>
                <Tag tone={connection.has_credentials ? 'success' : 'warning'}>
                  {connection.has_credentials
                    ? t('connections.hasCredentials')
                    : t('connections.noCredentials')}
                </Tag>
              </View>
            </View>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('connections.edit')}
                disabled={!!busyRole}
                {...a11yState({ disabled: !!busyRole })}
                onPress={() => {
                  setActionError('');
                  setEditor({ editing: connection });
                }}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.iconButton,
                  { opacity: busyRole ? 0.4 : pressed ? 0.6 : 1 },
                ]}
              >
                <Ionicons name="create-outline" size={18} color={colors.textSecondary} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('connections.delete')}
                disabled={!!busyRole}
                {...a11yState({ disabled: !!busyRole })}
                onPress={() => remove(connection)}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.iconButton,
                  { opacity: busyRole ? 0.4 : pressed ? 0.6 : 1 },
                ]}
              >
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </Pressable>
            </View>
          </View>
        ))}
        {actionError ? (
          <Text style={[styles.error, { color: colors.danger }]}>{actionError}</Text>
        ) : null}
      </Card>

      <ProviderConnectionSheet
        visible={editor !== null}
        providerId={providerId}
        editing={editor?.editing}
        prefillRole={editor?.prefillRole}
        prefillScheme={editor?.prefillScheme}
        onClose={() => setEditor(null)}
        onSaved={() => {
          setEditor(null);
          void mutate();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: Spacing.xs },
  heading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  headingText: { flex: 1, gap: 2 },
  title: { fontSize: FontSize.md, fontWeight: '700' },
  hint: { fontSize: FontSize.xs, lineHeight: 17 },
  voiceHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  voiceText: { fontSize: FontSize.xs, lineHeight: 17 },
  connection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.md,
  },
  connectionInfo: { flex: 1, gap: Spacing.xs },
  connectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minWidth: 0,
  },
  labelText: { flex: 1, fontSize: FontSize.sm, fontWeight: '600' },
  url: { fontSize: FontSize.xs, lineHeight: 17 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  actions: { flexDirection: 'row', gap: Spacing.xs },
  iconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  error: { fontSize: FontSize.sm, lineHeight: 19, marginTop: Spacing.sm },
});
