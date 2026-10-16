import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { connectionErrorKey } from '@/api/connection-errors';
import {
  InvalidPairingUrlError,
  redeemConnectionPayload,
} from '@/api/pairing';
import { PairingAttemptLock, type PairingAttemptStatus } from '@/api/pairing-intake';
import { Button, Screen, toast } from '@/components/ui';
import { FontSize, Palette, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useConnection } from '@/hooks/use-connection';
import { connectionStore } from '@/api/connection';

/**
 * In-app QR scanner. A pairing ticket is one-shot and failure is rate-limited,
 * so acquire the lock before parsing and only resume after an explicit rescan.
 */
export default function ScanScreen() {
  const connection = useConnection();
  const { colors } = useTheme();
  const { t } = useTranslation('connect');
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [error, setError] = useState('');
  const [scanState, setScanState] = useState<PairingAttemptStatus>('ready');
  const attemptRef = useRef(new PairingAttemptLock());
  const busy = scanState === 'pending';

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void getPermission().catch(() => setError(t('cameraSettingsFailed')));
    });
    return () => subscription.remove();
  }, [getPermission, t]);

  if (Platform.OS === 'web') {
    return (
      <Screen>
        <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
          {t('webSameOrigin')}
        </Text>
      </Screen>
    );
  }

  if (!permission?.granted) {
    const needsSettings = permission?.canAskAgain === false;
    const onGrantPermission = async () => {
      setError('');
      try {
        if (needsSettings) await Linking.openSettings();
        else await requestPermission();
      } catch {
        setError(t('cameraSettingsFailed'));
      }
    };
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={[styles.permText, { color: colors.textSecondary }]}>
            {t(needsSettings ? 'cameraSettingsHint' : 'cameraPermission')}
          </Text>
          <Button onPress={() => void onGrantPermission()}>
            {t(needsSettings ? 'openSettings' : 'grantCamera')}
          </Button>
          {error ? <Text style={[styles.permText, { color: colors.danger }]}>{error}</Text> : null}
        </View>
      </Screen>
    );
  }

  const onScanned = async ({ data }: { data: string }) => {
    const epoch = connection.epoch;
    if (connectionStore.epoch() !== epoch) return;
    if (!attemptRef.current.tryStart()) return;
    setScanState(attemptRef.current.status);
    setError('');
    try {
      const receipt = await redeemConnectionPayload(data, epoch);
      if (connectionStore.epoch() !== receipt.epoch) return;
      attemptRef.current.succeed();
      setScanState(attemptRef.current.status);
      toast.success(t('connectedAs', { username: receipt.user.username }));
      router.dismissAll();
    } catch (err) {
      if (connectionStore.epoch() !== epoch) return;
      attemptRef.current.fail();
      setScanState(attemptRef.current.status);
      if (err instanceof InvalidPairingUrlError) {
        setError(t('qrInvalid'));
      } else {
        setError(t(connectionErrorKey(err)));
      }
    }
  };

  const onScanAgain = () => {
    if (!attemptRef.current.resetForRescan()) return;
    setError('');
    setScanState(attemptRef.current.status);
  };

  return (
    <View style={styles.fill}>
      <CameraView
        style={styles.fill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanState === 'ready' ? (e) => void onScanned(e) : undefined}
      />
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.frame} pointerEvents="none" />
        <Text style={styles.overlayText}>
          {busy ? t('connecting') : scanState === 'failed' ? t('scanPaused') : t('scanHint')}
        </Text>
        {error ? <Text style={[styles.overlayText, styles.overlayError]}>{error}</Text> : null}
        {scanState === 'failed' ? (
          <Button style={styles.scanAgain} themeColors={Palette.dark} onPress={onScanAgain}>
            {t('scanAgain')}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: Palette.dark.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.lg },
  permText: { fontSize: FontSize.md, textAlign: 'center' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  frame: {
    width: 230,
    height: 230,
    borderRadius: Radius.md,
    borderWidth: 3,
    borderColor: Palette.dark.text,
    marginBottom: Spacing.xl,
  },
  overlayText: {
    color: Palette.dark.text,
    fontSize: FontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
    textShadowColor: Palette.dark.background,
    textShadowRadius: 6,
    maxWidth: 300,
  },
  overlayError: { color: Palette.dark.danger, marginTop: Spacing.sm, fontWeight: '600' },
  scanAgain: { marginTop: Spacing.lg, minWidth: 180 },
});
