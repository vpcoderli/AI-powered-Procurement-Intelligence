"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * How a reused panel tells the page it sits on that it is writing.
 *
 * A panel that starts writes of its own (a precheck, a config save, an approval) calls its `onBusyChange` with `true`
 * when it goes from idle to having a write in flight, and with `false` once the last of them settled, so the page can
 * hold its other controls meanwhile. It is called from event handlers, promise settlement and effect cleanup, never
 * from render, and it must not throw.
 */
export type BusyChangeHandler = (busy: boolean) => void;

export interface BusyTracker {
  /**
   * Marks one write as started and returns the function that marks it settled. Overlapping writes are one busy
   * episode: `true` is reported when the first one starts and `false` when the last one settles. The returned
   * function is idempotent, and does nothing once `release()` dropped its write.
   */
  begin(): () => void;
  /**
   * A handler for a child that reports its own busy state (a dialog with a write of its own). While the child says
   * `true` it counts as one write in flight here; saying the same thing twice changes nothing.
   */
  forward(name: string): BusyChangeHandler;
  /**
   * The owner is going away: reports `false` when something was still in flight and forgets it, so the late settle
   * of that write (or the child's own cleanup) reports nothing more.
   */
  release(): void;
  /** Reports to `handler` from now on: the one the owner was last given. `undefined` reports to nobody. */
  reportTo(handler: BusyChangeHandler | undefined): void;
}

/**
 * The pure core of a panel's busy signal. Every write and every forwarded child is a key in one set, and the handler
 * is called only when that set goes from empty to non-empty (`true`) and back (`false`), so a caller sees exactly one
 * `true` and one `false` per busy episode however many writes overlapped in it.
 */
export function createBusyTracker(initial?: BusyChangeHandler): BusyTracker {
  const active = new Set<string>();
  let report = initial;
  let writes = 0;

  const set = (key: string, busy: boolean) => {
    if (active.has(key) === busy) return;
    if (busy) {
      // Reported before it is counted: a handler that throws leaves nothing counted, so the tracker never sticks busy.
      if (active.size === 0) report?.(true);
      active.add(key);
      return;
    }
    active.delete(key);
    if (active.size === 0) report?.(false);
  };

  return {
    begin() {
      writes += 1;
      const key = `write:${writes}`;
      set(key, true);
      return () => set(key, false);
    },
    forward(name) {
      const key = `forward:${name}`;
      return (busy) => set(key, busy);
    },
    release() {
      if (active.size === 0) return;
      active.clear();
      report?.(false);
    },
    reportTo(handler) {
      report = handler;
    },
  };
}

/**
 * Runs one write and keeps the owner's busy signal honest about it: `true` before `work` starts, `false` once it
 * settled however it ended (resolved, rejected, or threw before it returned a promise). `work` is called in the same
 * tick as the click that started it, before anything is awaited, so when the request goes out does not change.
 */
export async function trackBusy<T>(tracker: Pick<BusyTracker, "begin">, work: () => Promise<T>): Promise<T> {
  const end = tracker.begin();
  try {
    return await work();
  } finally {
    end();
  }
}

export interface PanelWriteHandlers<T> {
  /**
   * The server's answer. A throw in here is shown as the write's error, as it always was: the row is written, but the
   * panel could not take it in.
   */
  onWritten: (result: T) => void;
  /** What went wrong, the server's message verbatim: it names the field or leg it refused, and that is the actionable part. */
  onError: (message: string) => void;
  /** Runs last, however the write ended: where a panel clears its own "saving" flag. */
  onSettled: () => void;
}

/**
 * One write a panel starts itself (a PATCH, say): sends it, routes the answer or the failure to the panel, and reports
 * the write busy while it runs. However the write ends, the panel is told through `onWritten` or `onError`, then
 * `onSettled`, and then the write is idle (unless the panel unmounted meanwhile: its release reports idle at once); a
 * `send` that throws before it returns a promise ends the same way as one that rejects. It rejects only if a handler
 * throws: a busy handler on the start report sends nothing and skips `onSettled`; one on the end report, or a throwing
 * `onError`/`onSettled`, rejects after the fact. The handlers today are React state setters, which do not throw.
 */
export async function runPanelWrite<T>(
  tracker: Pick<BusyTracker, "begin">,
  send: () => Promise<T>,
  handlers: PanelWriteHandlers<T>,
): Promise<void> {
  await trackBusy(tracker, async () => {
    try {
      handlers.onWritten(await send());
    } catch (caught: unknown) {
      handlers.onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      handlers.onSettled();
    }
  });
}

/**
 * The busy signal of one panel: hands back the tracker its writes go through (`runPanelWrite(busy, ...)` or
 * `trackBusy(busy, ...)`), which reports to the latest `onBusyChange` the panel was given. Unmounting while a write is
 * in flight reports idle, so a page is never left locked by a panel that is gone.
 */
export function useBusyTracker(onBusyChange?: BusyChangeHandler): BusyTracker {
  const [tracker] = useState(() => createBusyTracker(onBusyChange));

  // The handler is swapped in an effect, never during render. A click handler only runs after the render it belongs
  // to has committed, so a write reports to the handler of the render that started it.
  useEffect(() => {
    tracker.reportTo(onBusyChange);
  }, [tracker, onBusyChange]);

  useEffect(() => () => tracker.release(), [tracker]);

  return tracker;
}

/**
 * The ids in `current` once `id` reports `busy`. Returns `current` itself when nothing changes, so a repeated report
 * (a panel's cleanup after its own idle) does not render the page again.
 */
export function nextBusyIds<Id extends string>(current: ReadonlySet<Id>, id: Id, busy: boolean): ReadonlySet<Id> {
  if (current.has(id) === busy) return current;
  const next = new Set(current);
  if (busy) next.add(id);
  else next.delete(id);
  return next;
}

/**
 * The page side: which of its panels are writing right now. Each panel reports under its own id, so a panel that
 * says idle twice (its write settled, then it unmounted) cannot free a lock that another panel still holds.
 */
export function useBusyIds<Id extends string>() {
  const [busyIds, setBusyIds] = useState<ReadonlySet<Id>>(() => new Set<Id>());
  const setBusy = useCallback((id: Id, busy: boolean) => setBusyIds((current) => nextBusyIds(current, id, busy)), []);
  return { busyIds, setBusy };
}
