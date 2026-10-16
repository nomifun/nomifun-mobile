import type { ComponentProps } from 'react';
import { Button as BaseButton, Screen as BaseScreen } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

export function Button(props: ComponentProps<typeof BaseButton>) {
  const { colors } = useTheme();
  return <BaseButton {...props} themeColors={colors} />;
}
export function Screen(props: ComponentProps<typeof BaseScreen>) {
  const { colors } = useTheme();
  return <BaseScreen {...props} themeColors={colors} />;
}
