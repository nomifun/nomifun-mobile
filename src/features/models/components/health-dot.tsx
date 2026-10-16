import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import type { HealthStatus } from '@/features/models/types';

/** Health dot for a model row. `unknown` renders as a hollow, muted dot. */
export function HealthDot({ status, size = 9 }: { status: HealthStatus; size?: number }) {
  const { colors } = useTheme();
  const color =
    status === 'healthy' ? colors.success : status === 'unhealthy' ? colors.danger : colors.border;
  return (
    <View
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: status === 'unknown' ? 'transparent' : color,
          borderColor: color,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: { borderWidth: 1.5 },
});
