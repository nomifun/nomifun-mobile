/**
 * 渠道机器人绑定 — bind / unbind on mobile; creation stays on the desktop.
 *
 * The PUT behind every switch replaces this agent's WHOLE binding set, so each
 * toggle sends "currently bound ± this bot" (`planBindingChange`). Two guards
 * follow from that contract:
 * - nothing is writable until the ownership map has loaded (`pool.ready`),
 *   otherwise a half-loaded set would silently unbind live bots;
 * - 抢绑 (the bot belongs to another 客服) and 解绑 both confirm first, and the
 *   confirmation names the consequence — the other agent loses the bot / this
 *   agent stops receiving visitors on it.
 *
 * Bot creation is still desktop-only: it drags in twelve platform credential
 * forms plus the WeChat QR login flow.
 */
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Card, ErrorState, Loading, Tag, toast } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { boundPluginIds, planBindingChange } from '../bindings';
import { confirmDestructive } from '../confirm';
import { useCsBotPool } from '../hooks';
import { botStatusKey, csBotBindingState } from '../normalize';
import type { ChannelPluginStatus } from '../types';

const STATUS_TONE = {
  connected: 'success',
  connecting: 'warning',
  error: 'danger',
  disabled: 'neutral',
  noToken: 'danger',
} as const;

export function BotsCard({ csAgentId }: { csAgentId: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation('customerService');
  const { t: tc } = useTranslation('common');
  const pool = useCsBotPool();
  const [busyBot, setBusyBot] = useState('');

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

  const boundIds = boundPluginIds(pool.bots, csAgentId, pool.ownerByBot);

  const write = (bot: ChannelPluginStatus, nextIds: readonly string[]) => {
    setBusyBot(bot.plugin_id);
    void pool
      .replaceBindings(csAgentId, nextIds)
      .then(() => toast.success(t('bots.saved')))
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : tc('feedback.requestFailed'));
      })
      .finally(() => setBusyBot(''));
  };

  const toggle = (bot: ChannelPluginStatus) => {
    // Never write from an unloaded ownership map: the PUT is a whole-set
    // replacement, so an id we have not seen yet equals an unbind.
    if (!pool.ready) {
      toast.info(t('bots.notReady'));
      return;
    }
    const plan = planBindingChange({
      pluginId: bot.plugin_id,
      csAgentId,
      boundIds,
      ownerByBot: pool.ownerByBot,
    });
    const label = bot.name || bot.type;

    if (plan.kind === 'bind') {
      write(bot, plan.nextIds);
      return;
    }

    if (plan.kind === 'steal') {
      const from = plan.fromAgentId
        ? (pool.agentNames.get(plan.fromAgentId) ?? t('bots.otherAgent'))
        : t('bots.otherAgent');
      confirmDestructive({
        title: t('bots.stealTitle'),
        message: t('bots.stealBody', { bot: label, from }),
        confirmLabel: t('bots.stealConfirm'),
        cancelLabel: tc('actions.cancel'),
        onConfirm: () => write(bot, plan.nextIds),
      });
      return;
    }

    confirmDestructive({
      title: t('bots.unbindTitle'),
      message: plan.unbindsAll
        ? t('bots.unbindLastBody', { bot: label })
        : t('bots.unbindBody', { bot: label }),
      confirmLabel: t('bots.unbindConfirm'),
      cancelLabel: tc('actions.cancel'),
      onConfirm: () => write(bot, plan.nextIds),
    });
  };

  const bound = pool.bots.filter((bot) => boundIds.includes(bot.plugin_id));
  const others = pool.bots.filter((bot) => !boundIds.includes(bot.plugin_id));

  const renderBot = (bot: ChannelPluginStatus, last: boolean) => {
    const state = csBotBindingState(bot.plugin_id, csAgentId, pool.ownerByBot);
    const statusKey = botStatusKey(bot);
    const busy = busyBot === bot.plugin_id;
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
          <View style={styles.tags}>
            <Tag tone={STATUS_TONE[statusKey]}>{t(`bots.status.${statusKey}`)}</Tag>
            {state.kind === 'boundToOther' ? (
              <Tag tone="warning">
                {t('bots.boundToOther', {
                  name: pool.agentNames.get(state.csAgentId) ?? t('bots.otherAgent'),
                })}
              </Tag>
            ) : null}
          </View>
        </View>
        <Switch
          value={state.kind === 'boundToThis'}
          disabled={busy || !pool.ready}
          onValueChange={() => toggle(bot)}
          trackColor={{ true: colors.primary, false: colors.border }}
          accessibilityLabel={t('bots.toggleA11y', { bot: bot.name || bot.type })}
        />
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
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 },
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
