/**
 * 渠道机器人绑定 — READ-ONLY on mobile.
 *
 * The bind PUT is a full-set replacement that *steals* a bot from another
 * agent, and bot creation drags in twelve platform credential forms plus the
 * WeChat QR login flow. Both stay on the desktop; the phone shows the honest
 * state of the pool instead of a half-working control.
 *
 * The three-state ownership tag needs the whole bot → agent map, which
 * `useCsBotPool` builds by fanning bindings out across every agent.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Card, ErrorState, Loading, Tag } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { useCsBotPool } from '../hooks';
import { botStatusKey, csBotBindingState } from '../normalize';
import type { ChannelPluginStatus } from '../types';

const STATUS_TONE = {
  connected: 'success',
  connecting: 'warning',
  disabled: 'neutral',
  noToken: 'danger',
} as const;

export function BotsCard({ csAgentId }: { csAgentId: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation('customerService');
  const { t: tc } = useTranslation('common');
  const pool = useCsBotPool();

  if (pool.isLoading && pool.bots.length === 0) {
    return (
      <Card>
        <Loading label={tc('state.loading')} />
      </Card>
    );
  }

  if (pool.error && pool.bots.length === 0) {
    return (
      <Card>
        <ErrorState
          message={pool.error.message || tc('feedback.requestFailed')}
          onRetry={() => void pool.refresh()}
          retryLabel={tc('actions.retry')}
        />
      </Card>
    );
  }

  const bound = pool.bots.filter(
    (bot) => csBotBindingState(bot.plugin_id, csAgentId, pool.ownerByBot).kind === 'boundToThis',
  );
  const others = pool.bots.filter((bot) => !bound.includes(bot));

  const renderBot = (bot: ChannelPluginStatus, last: boolean) => {
    const state = csBotBindingState(bot.plugin_id, csAgentId, pool.ownerByBot);
    const statusKey = botStatusKey(bot);
    return (
      <View
        key={bot.plugin_id}
        style={[
          styles.row,
          !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
        ]}
      >
        <View style={[styles.icon, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons name="hardware-chip-outline" size={18} color={colors.textSecondary} />
        </View>
        <View style={styles.body}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {bot.name || bot.type}
          </Text>
          <Text style={[styles.meta, { color: colors.textTertiary }]} numberOfLines={1}>
            {bot.botUsername ? `${bot.type} · ${bot.botUsername}` : bot.type}
          </Text>
        </View>
        <View style={styles.tags}>
          <Tag tone={STATUS_TONE[statusKey]}>{t(`bots.status.${statusKey}`)}</Tag>
          {state.kind === 'boundToThis' ? (
            <Tag tone="primary">{t('bots.boundToThis')}</Tag>
          ) : state.kind === 'boundToOther' ? (
            <Tag tone="warning">
              {t('bots.boundToOther', {
                name: pool.agentNames.get(state.csAgentId) ?? t('bots.otherAgent'),
              })}
            </Tag>
          ) : (
            <Tag tone="neutral">{t('bots.unbound')}</Tag>
          )}
        </View>
      </View>
    );
  };

  return (
    <Card>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('bots.domainHint')}</Text>

      {pool.bots.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons name="hardware-chip-outline" size={22} color={colors.textTertiary} />
          <Text style={[styles.emptyText, { color: colors.textTertiary }]}>{t('bots.noBots')}</Text>
        </View>
      ) : (
        <>
          {bound.length > 0 ? (
            <>
              <Text style={[styles.group, { color: colors.textTertiary }]}>
                {t('bots.groupBound')}
              </Text>
              {bound.map((bot, index) => renderBot(bot, index === bound.length - 1))}
            </>
          ) : (
            <View style={[styles.empty, { backgroundColor: colors.surfaceMuted }]}>
              <Ionicons name="link-outline" size={22} color={colors.textTertiary} />
              <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                {t('bots.noneBoundHere')}
              </Text>
            </View>
          )}

          {others.length > 0 ? (
            <>
              <Text style={[styles.group, { color: colors.textTertiary }]}>
                {t('bots.groupPool')}
              </Text>
              {others.map((bot, index) => renderBot(bot, index === others.length - 1))}
            </>
          ) : null}
        </>
      )}

      <View style={[styles.desktop, { borderTopColor: colors.border }]}>
        <Ionicons name="desktop-outline" size={14} color={colors.textTertiary} />
        <Text style={[styles.desktopText, { color: colors.textTertiary }]}>
          {t('bots.desktopOnly')}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: FontSize.xs, lineHeight: 17, marginBottom: Spacing.sm },
  group: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 60,
    paddingVertical: Spacing.sm,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  name: { fontSize: FontSize.md, fontWeight: '600' },
  meta: { fontSize: FontSize.xs },
  tags: { alignItems: 'flex-end', gap: 4, maxWidth: '42%' },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    marginTop: Spacing.sm,
  },
  emptyText: { flex: 1, fontSize: FontSize.xs, lineHeight: 17 },
  desktop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  desktopText: { flex: 1, fontSize: FontSize.xs, lineHeight: 16 },
});
