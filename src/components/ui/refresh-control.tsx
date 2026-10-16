import { RefreshControl as NativeRefreshControl, type RefreshControlProps } from 'react-native';

/**
 * Native adapter. The web variant (`refresh-control.web.tsx`) exists because
 * react-native-web's RefreshControl silently drops `onRefresh`/`refreshing`
 * and renders a bare View, so pull-to-refresh does not exist in a browser.
 */
export function RefreshControl({
  showButton: _showButton,
  ...props
}: RefreshControlProps & { showButton?: boolean }) {
  return <NativeRefreshControl {...props} />;
}
