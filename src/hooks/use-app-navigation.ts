import { createContext, useContext } from 'react';

export interface AppNavigationState {
  permanent: boolean;
  open: () => void;
}

export const AppNavigationContext = createContext<AppNavigationState | null>(null);

export function useAppNavigation() {
  return useContext(AppNavigationContext);
}
