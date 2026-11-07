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
import { PRESENTER_MAX_PAYLOAD, type SharedSync, type SyncMessage } from "./protocol.ts";

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

export interface SlideSync {
  /** For Slidev's `addSyncMethod`. */
  sync: Sync;
  /** A `sync` from the server; ignored in the presenter tab. */
  receive(msg: SyncMessage): void;
  /** Sends every channel's full current state; called when a presenter socket opens. */
  resend(): void;
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

export function createSlideSync(options: SlideSyncOptions): SlideSync {
  const { send, isPresenter } = options;
  let onUpdate: ((data: Partial<object>) => void) | undefined;
  /** The state last sent, and the same as JSON for comparing. */
  let sent: Picked | undefined;
  let sentJson = "";
  let latest: Picked | undefined;
  /** The reactive object Slidev gave `init`, so a resend sees the live state, not the last write. */
  let live: object | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const warned = new Set<string>();
  /** The drawings channel: Slidev's reactive object, the last string sent per page, a flush timer. */
  let onDrawings: ((data: Partial<object>) => void) | undefined;
  let liveDrawings: Record<string, string | undefined> | undefined;
  const sentDrawings = new Map<string, string>();
  let drawTimer: ReturnType<typeof setTimeout> | undefined;

  function warnOnce(key: string, text: string): void {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[slidev-addon-polls] ${text}`);
    }
  }

  /** Sends one page's drawing, unless it is too big; true when it went out. */
  function emitDrawing(page: string, svg: string): boolean {
    const msg = { type: "sync", channel: "drawings", data: { [page]: svg } } as SyncMessage;
    if (new TextEncoder().encode(JSON.stringify(msg)).length > PRESENTER_MAX_PAYLOAD) {
      warnOnce(
        `drawings ${page}`,
        `The drawing on page ${page} is too big to sync to the screens.`,
      );
      return false;
    }
    sentDrawings.set(page, svg);
    send(msg);
    return true;
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
    const msg = { type: "sync", channel: "shared", data: picked } as SyncMessage;
    if (new TextEncoder().encode(JSON.stringify(msg)).length > PRESENTER_MAX_PAYLOAD) {
      warnOnce(
        `shared ${picked.page}`,
        `The slide state on page ${picked.page} is too big to sync to the screens.`,
      );
      return;
    }
    sent = picked;
    sentJson = json;
    send(msg);
  }

  const sync: Sync = {
    init(channelKey, update, state) {
      if (options.drawings && channelKey.endsWith(" - drawings")) {
        onDrawings = update as (data: Partial<object>) => void;
        liveDrawings = state as Record<string, string | undefined>;
        return (current, updating) => {
          if (!isPresenter() || updating) {
            return;
          }
          liveDrawings = current as Record<string, string | undefined>;
          drawTimer ??= setTimeout(flushDrawings, POINTER_MS);
        };
      }
      if (!channelKey.endsWith(" - shared")) {
        return undefined;
      }
      onUpdate = update as (data: Partial<object>) => void;
      live = state;
      latest = pick(state);
      return (current, updating) => {
        if (!isPresenter() || updating) {
          return;
        }
        const picked = pick(current);
        latest = picked;
        if (JSON.stringify(picked) === sentJson) {
          return;
        }
        if (
          picked.page !== sent?.page ||
          picked.clicks !== sent?.clicks ||
          picked.clicksTotal !== sent?.clicksTotal
        ) {
          emit(picked);
        } else {
          // Not reset by later writes: one message per interval, with the latest state.
          timer ??= setTimeout(() => latest && emit(latest), POINTER_MS);
        }
      };
    },
  };

  return {
    sync,
    receive(msg) {
      if (isPresenter()) {
        return;
      }
      if (msg.channel === "drawings") {
        onDrawings?.(msg.data);
        return;
      }
      if (msg.channel !== "shared") {
        return;
      }
      const data = Object.fromEntries(
        Object.entries(msg.data satisfies SharedSync).map(([k, v]) => [k, v ?? undefined]),
      );
      onUpdate?.(data);
    },
    resend() {
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
