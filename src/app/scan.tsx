import { useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { ApiError } from '@/api/types';
import {
  InvalidPairingUrlError,
  parseConnectionPayload,
  redeemConnectionPayload,
} from '@/api/pairing';
import { Button, Screen, toast } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * In-app QR scanner. IMPORTANT: the desktop QR token is one-shot with a
 * 5-minute TTL, and the auth endpoint rate-limits failures (5 per 15 min) —
 * so we lock after the first hit and never auto-retry.
 */
export default function ScanScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('connect');
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const consumedRef = useRef(false);

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
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={[styles.permText, { color: colors.textSecondary }]}>
            {t('cameraPermission')}
          </Text>
          <Button onPress={() => void requestPermission()}>{t('grantCamera')}</Button>
        </View>
      </Screen>
    );
  }

  const onScanned = async ({ data }: { data: string }) => {
    if (consumedRef.current || busy) return;
    if (!parseConnectionPayload(data)) {
      setError(t('qrInvalid'));
      return;
    }
    consumedRef.current = true;
    setBusy(true);
    setError('');
    try {
      const user = await redeemConnectionPayload(data);
      toast.success(t('connectedAs', { username: user.username }));
      router.dismissAll();
    } catch (err) {
      consumedRef.current = false;
      if (err instanceof InvalidPairingUrlError) {
        setError(t('qrInvalid'));
      } else if (err instanceof ApiError && (err.status === 401 || err.status === 400)) {
        setError(t('qrExpired'));
      } else {
        setError(t('probeFailed'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.fill}>
      <CameraView
        style={styles.fill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={(e) => void onScanned(e)}
      />
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.frame} />
        <Text style={styles.overlayText}>{busy ? t('connecting') : t('scanHint')}</Text>
        {error ? <Text style={[styles.overlayText, styles.overlayError]}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
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
    borderRadius: 18,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
    marginBottom: Spacing.xl,
  },
  overlayText: {
    color: '#FFF',
    fontSize: FontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowRadius: 6,
    maxWidth: 300,
  },
  overlayError: { color: '#FF8A80', marginTop: Spacing.sm, fontWeight: '600' },
});
