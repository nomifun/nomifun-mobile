# Mobile WebSocket contract

The active client implementation is `src/api/ws.ts`. Session synchronization is
owned by `src/features/sessions/sync.ts` and `provider.tsx`; chat frame projection
is in `stream.ts` and `hooks.ts`. Desktop wire definitions live in
`crates/backend/nomifun-api-types/src/websocket.rs` and its realtime handlers.

## Transport

- `/ws` uses the active verified connection. Web uses the current origin;
  native converts the configured HTTP(S) origin to WS(S).
- The device bearer credential is supplied as the first WebSocket subprotocol.
  It is not included in the URL. Token refresh and connection epoch changes
  invalidate the old socket.
- Incoming envelopes use `{name, data}`. A server `ping` is answered with
  `pong`, preserving the timestamp. `sync.resync-required` schedules a snapshot
  reconciliation; missed frames are not replayed.
- Close `1008` indicates an authentication-policy rejection. Heartbeat timeout
  `4408` reconnects; token-aged close `4409` refreshes the device credential.
  Reconnect and heartbeat ownership remain in the transport, outside screens.

## Snapshot synchronization

`ws.ready` is emitted on every successful connection, including the first.
`ws.reconnected` also covers delivery gaps and server-requested resynchronization.
The initial HTTP snapshot can precede subscription readiness, so the first ready
must reconcile too. Returning to the foreground always reconciles, even if the
OS still reports the socket as OPEN.

`attachSessionSync` subscribes before starting its first snapshot. These events
invalidate the connection-owned session data:

- `conversation.listChanged`
- `agentSession.agentChanged`
- `agentSession.knowledgeChanged`
- `turn.started`, `turn.completed`
- `ws.ready`, `ws.reconnected`

HTTP receipts confirm commands; WS delivery is an invalidation hint. Changes
during a read are retained by the catalog's dirty latch. Old connections and
superseded reads cannot publish into the active owner. See
[the Session contract](../PROJECT-SESSIONS-CONTRACT.md) for ownership and paging.

## Chat history and live frames

`message.stream` is scoped by `conversation_id`. Its stable merge identity is
the accepted `msg_id` plus render type; tools additionally merge by `call_id`.
The typed frame reducer is the contract for the supported text, thinking, tips,
tool and status presentations. It never reconstructs Agent execution authority.

`message.userCreated` and Turn lifecycle events update the current chat display.
After a delivery gap or foreground recovery, the chat re-reads message history
and authoritative runtime rather than trusting a retained local busy flag.
Generation fences prevent an older snapshot from closing a newer Turn.

The retired `/api/conversations/*`, confirmation polling, workspace rebinding
and desktop-only bridge implementation notes are intentionally absent. Current
AgentSession HTTP routes are documented in the Session contract and `api.ts`.
