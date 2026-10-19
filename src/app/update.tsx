import { useCallback, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { OFFICIAL_MOBILE_RELEASES_URL } from '@/api/releases';
import { Button, Card, Notice, PageHeading, Screen, SectionTitle } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useAppUpdate } from '@/features/app-update/hooks';
import { appUpdateController } from '@/features/app-update/runtime';
import { useTheme } from '@/hooks/use-theme';

export default function UpdateScreen() {
  const { t } = useTranslation('settings');
  const { colors } = useTheme();
  const update = useAppUpdate();
  const [opening, setOpening] = useState(false);
  const [linkFeedback, setLinkFeedback] = useState<'opened' | 'failed' | null>(null);
  const isAndroid = Platform.OS === 'android';
  const checking = update.status === 'checking';

  useFocusEffect(useCallback(() => {
    if (!isAndroid) return;
    void appUpdateController.check();
    const subscription = AppState.addEventListener('change', (state) => {
      // Installation is confirmed by reading the native version again, never by opening a URL.
      if (state === 'active') void appUpdateController.check();
    });
    return () => subscription.remove();
  }, [isAndroid]));

  const openReleasePage = async (url = OFFICIAL_MOBILE_RELEASES_URL) => {
    if (opening) return;
    setOpening(true);
    setLinkFeedback(null);
    try {
      await Linking.openURL(url);
    } catch {
      setLinkFeedback('failed');
    } finally {
      setOpening(false);
    }
  };

  const download = async () => {
    if (opening || checking || update.status !== 'available') return;
    setOpening(true);
    setLinkFeedback(null);
    try {
      // Revalidate the complete catalog before opening an APK that might have been withdrawn.
      await appUpdateController.check();
      const fresh = appUpdateController.getSnapshot();
      if (fresh.status !== 'available' || !fresh.release) return;
      await Linking.openURL(fresh.release.apk.url);
      setLinkFeedback('opened');
    } catch {
      setLinkFeedback('failed');
    } finally {
      setOpening(false);
    }
  };

  const row = (label: string, value: string) => (
    <View style={styles.row}>
      <Text style={[styles.label, { color: colors.textTertiary }]}>{label}</Text>
      <Text selectable style={[styles.value, { color: colors.text }]}>{value}</Text>
    </View>
  );

  const statusTone = update.status === 'error' ? 'danger'
    : update.status === 'unsupported' ? 'warning'
      : update.status === 'current' || update.status === 'ahead' ? 'success' : 'info';

  return (
    <Screen>
      <Stack.Screen options={{ title: t('update.title') }} />
      <View style={styles.column}>
        <PageHeading title={t('update.title')} />
        <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('update.independentHint')}</Text>
        <SectionTitle>{t('update.installedTitle')}</SectionTitle>
        <Card>
          {row(t('version'), update.installed.version ?? t('update.unknownVersion'))}
          {Platform.OS !== 'web' ? row(t('update.build'), update.installed.buildVersion ?? t('update.unknownVersion')) : null}
        </Card>

        {isAndroid ? (
          <>
            <Notice tone={statusTone}>
              {update.status === 'error'
                ? t(`update.errors.${update.errorCode ?? 'network'}`)
                : update.status === 'unsupported'
                  ? t(`update.unsupported.${update.reason ?? 'distribution'}`)
                  : t(`update.status.${update.status}`)}
            </Notice>
            {update.checkedAt ? (
              <Text style={[styles.hint, { color: colors.textTertiary }]}>
                {t('update.checkedAt', { time: new Date(update.checkedAt).toLocaleString() })}
              </Text>
            ) : null}
            <Button
              icon="refresh-outline"
              variant="secondary"
              loading={checking}
              disabled={opening}
              onPress={() => { setLinkFeedback(null); void appUpdateController.check(); }}
            >
              {t('update.check')}
            </Button>

            {update.release ? (
              <>
                <SectionTitle>{t('update.releaseTitle')}</SectionTitle>
                <Card>
                  {row(t('version'), update.release.version)}
                  {row(t('update.build'), String(update.release.android.versionCode))}
                  {row(t('update.packageSize'), t('update.megabytes', { size: (update.release.apk.bytes / 1024 / 1024).toFixed(1) }))}
                  {update.status === 'error' ? <Notice tone="warning">{t('update.staleHint')}</Notice> : null}
                  <Button icon="open-outline" variant="ghost" disabled={opening} onPress={() => void openReleasePage(update.release?.releaseUrl)}>
                    {t('update.releaseNotes')}
                  </Button>
                </Card>
              </>
            ) : null}

            {update.status === 'available' ? (
              <>
                <Notice>{t('update.installHint')}</Notice>
                <Button icon="download-outline" loading={opening} onPress={() => void download()}>
                  {t('update.download')}
                </Button>
              </>
            ) : update.status === 'unsupported' || update.status === 'error' ? (
              <Button icon="open-outline" variant="secondary" disabled={opening} onPress={() => void openReleasePage()}>
                {t('update.officialReleases')}
              </Button>
            ) : null}
            {linkFeedback ? <Notice tone={linkFeedback === 'failed' ? 'danger' : 'info'}>{t(`update.link.${linkFeedback}`)}</Notice> : null}
          </>
        ) : (
          <Notice>{t(Platform.OS === 'web' ? 'update.webHint' : 'update.iosHint')}</Notice>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  column: { maxWidth: 640, width: '100%', alignSelf: 'center', gap: Spacing.md },
  hint: { fontSize: FontSize.sm, lineHeight: 21 },
  row: { gap: Spacing.xs, marginBottom: Spacing.md },
  label: { fontSize: FontSize.xs },
  value: { fontSize: FontSize.sm, lineHeight: 21 },
});
