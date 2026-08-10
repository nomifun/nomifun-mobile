import { RefreshControl } from 'react-native';

/**
 * Native re-export. The web variant (`refresh-control.web.tsx`) exists because
 * react-native-web's RefreshControl silently drops `onRefresh`/`refreshing`
 * and renders a bare View, so pull-to-refresh does not exist in a browser.
 */
export { RefreshControl };
