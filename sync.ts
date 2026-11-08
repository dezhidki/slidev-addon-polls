/**
 * A Slidev sync method that mirrors the presenter's page, clicks and pointer over the poll
 * socket. Slidev's own sync (a `BroadcastChannel`, or its dev server) cannot reach another
 * device in a static build; this one can, through the poll server.
 *
 * Only the presenter's tab sends. Every other tab applies what arrives.
 *
 * @author Claude
 * @author Denis Zhidkikh
 */
import { PRESENTER_MAX_PAYLOAD, type SyncMessage } from "./protocol.ts";

/**
 * Slidev's sync interface, copied rather than imported: importing `@slidev/client` from a
 * `.ts` file makes `tsc` check Slidev's own sources. Matches Slidev 53,
 * node_modules/@slidev/client/state/syncState.ts lines 3-8; check it on an upgrade.
 */
type SyncWrite<State extends object> = (state: State, updating?: boolean) => void;
interface Sync {
  enabled?: boolean;
  init: <State extends object>(
    channelKey: string,
    onUpdate: (data: Partial<State>) => void,
    state: State,
    persist?: boolean,
  ) => SyncWrite<State> | undefined;
}

/** Milliseconds between two messages that only move the pointer. */
const POINTER_MS = 100;

export interface SlideSyncOptions {
  /** Puts one message on the poll socket. */
  send: (msg: SyncMessage) => void;
  /** Only the presenter tab's changes go out. */
  isPresenter: () => boolean;
  /** Whether the drawings channel is synced too (`polls.showDrawings`). */
  drawings: boolean;
}

/** What Slidev's shared state sends on, with a hidden pointer as `null` (JSON has no `undefined`). */
function pick(state: object) {
  const { page, clicks, clicksTotal, cursor, lastUpdate } = state as Record<string, unknown>;
  return {
    page: page ?? null,
    clicks: clicks ?? null,
    clicksTotal: clicksTotal ?? null,
    cursor: cursor ?? null,
    lastUpdate: lastUpdate ?? null,
  };
}
type Picked = ReturnType<typeof pick>;

export function createSlideSync(options: SlideSyncOptions) {
  const { send, isPresenter } = options;
  let onUpdate: ((data: Partial<object>) => void) | undefined;
  /** The state last sent, and the same as JSON for comparing. */
  let sent: Picked | undefined;
  let sentJson = "";
  /** The reactive object Slidev gave `init`, so a resend sees the live state, not the last write. */
  let live: object | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const warned = new Set<string>();
  /** The drawings channel: Slidev's reactive object, the last string sent per page, a flush timer. */
  let onDrawings: ((data: Partial<object>) => void) | undefined;
  let liveDrawings: Record<string, string | undefined> | undefined;
  const sentDrawings = new Map<string, string>();
  let drawTimer: ReturnType<typeof setTimeout> | undefined;

  /** Sends one message, unless it is over the presenter cap: then it warns, once per page. */
  function trySend(channel: SyncMessage["channel"], data: object, page: unknown): boolean {
    const msg = { type: "sync", channel, data } as SyncMessage;
    if (new TextEncoder().encode(JSON.stringify(msg)).length <= PRESENTER_MAX_PAYLOAD) {
      send(msg);
      return true;
    }
    const key = `${channel} ${page}`;
    if (!warned.has(key)) {
      warned.add(key);
      const what = channel === "drawings" ? "drawing" : "slide state";
      console.warn(
        `[slidev-addon-polls] The ${what} on page ${page} is too big to sync to the screens.`,
      );
    }
    return false;
  }

  /** Sends one page's drawing, unless it is too big. */
  function emitDrawing(page: string, svg: string): void {
    if (trySend("drawings", { [page]: svg }, page)) {
      sentDrawings.set(page, svg);
    }
  }

  /** Sends every page that differs from what was last sent (a cleared page as ""). */
  function flushDrawings(): void {
    drawTimer = undefined;
    for (const [page, svg = ""] of Object.entries(liveDrawings ?? {})) {
      if (svg !== (sentDrawings.get(page) ?? "")) {
        emitDrawing(page, svg);
      }
    }
  }

  function emit(picked: Picked, force = false): void {
    clearTimeout(timer);
    timer = undefined;
    const json = JSON.stringify(picked);
    if (!force && json === sentJson) {
      return;
    }
    if (trySend("shared", picked, picked.page)) {
      sent = picked;
      sentJson = json;
    }
  }

  const sync: Sync = {
    init(channelKey, update, state) {
      if (options.drawings && channelKey.endsWith(" - drawings")) {
        onDrawings = update as (data: Partial<object>) => void;
        liveDrawings = state as Record<string, string | undefined>;
        return (_current, updating) => {
          if (!isPresenter() || updating) {
            return;
          }
          drawTimer ??= setTimeout(flushDrawings, POINTER_MS);
        };
      }
      if (!channelKey.endsWith(" - shared")) {
        return undefined;
      }
      onUpdate = update as (data: Partial<object>) => void;
      live = state;
      return (current, updating) => {
        if (!isPresenter() || updating) {
          return;
        }
        const picked = pick(current);
        if (
          picked.page !== sent?.page ||
          picked.clicks !== sent?.clicks ||
          picked.clicksTotal !== sent?.clicksTotal
        ) {
          emit(picked);
        } else {
          // Not reset by later writes: one message per interval, with the latest state.
          timer ??= setTimeout(() => emit(pick(state)), POINTER_MS);
        }
      };
    },
  };

  return {
    /** For Slidev's `addSyncMethod`. */
    sync,
    /** A `sync` from the server; ignored in the presenter tab. */
    receive(msg: SyncMessage): void {
      if (isPresenter()) {
        return;
      }
      if (msg.channel === "drawings") {
        onDrawings?.(msg.data);
        return;
      }
      // The projector has each change from Slidev's BroadcastChannel a round trip before the
      // server's copy, so a fast presenter would send it back a slide. Same-time messages
      // still apply: pointer moves keep the lastUpdate of the page they are on.
      const time = msg.data.lastUpdate?.time;
      const shown = (live as { lastUpdate?: { time?: number } } | undefined)?.lastUpdate?.time;
      if (time !== undefined && shown !== undefined && time < shown) {
        return;
      }
      const data = Object.fromEntries(
        Object.entries(msg.data).map(([k, v]) => [k, v ?? undefined]),
      );
      onUpdate?.(data);
    },
    /** Sends every channel's full current state; called when a presenter socket opens. */
    resend(): void {
      if (live) {
        emit(pick(live), true);
      }
      for (const [page, svg = ""] of Object.entries(liveDrawings ?? {})) {
        if (svg || sentDrawings.has(page)) {
          emitDrawing(page, svg);
        }
      }
    },
  };
}
