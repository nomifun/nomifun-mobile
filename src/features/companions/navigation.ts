/**
 * Navigation helper. `router.push` takes expo-router's `Href`, which becomes a
 * strict union once typed routes are generated — deriving the parameter type
 * keeps a runtime-built path compiling either way.
 */
import { router } from 'expo-router';

type PushHref = Parameters<typeof router.push>[0];

export function pushPath(path: string) {
  router.push(path as PushHref);
}

/** The companion's canonical conversation lives on the shared chat screen. */
export function pushConversation(conversationId: string) {
  pushPath(`/session/${conversationId}`);
}
