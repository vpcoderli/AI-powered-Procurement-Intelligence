import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createBusyTracker, nextBusyIds, runPanelWrite, trackBusy } from "./busy-reporting";

/** A tracker whose reports are logged, in order. */
function tracked() {
  const reports: boolean[] = [];
  const tracker = createBusyTracker((busy) => {
    reports.push(busy);
  });
  return { reports, tracker };
}

describe("createBusyTracker", () => {
  it("reports busy when a write starts and idle once it ended, once each way", () => {
    const { reports, tracker } = tracked();

    const end = tracker.begin();
    expect(reports).toEqual([true]);

    end();
    expect(reports).toEqual([true, false]);
  });

  it("reports nothing more when the same write ends twice", () => {
    const { reports, tracker } = tracked();

    const end = tracker.begin();
    end();
    end();

    expect(reports).toEqual([true, false]);
  });

  it("treats overlapping writes as one busy episode: idle only once the last one ended, in whatever order", () => {
    const { reports, tracker } = tracked();

    const first = tracker.begin();
    const second = tracker.begin();
    expect(reports).toEqual([true]);

    first();
    expect(reports).toEqual([true]);
    second();
    expect(reports).toEqual([true, false]);

    const third = tracker.begin();
    const fourth = tracker.begin();
    fourth();
    expect(reports).toEqual([true, false, true]);
    third();
    expect(reports).toEqual([true, false, true, false]);
  });

  describe("forward (a child that reports its own busy state)", () => {
    it("counts a child's write as one write in flight, however often it says the same thing", () => {
      const { reports, tracker } = tracked();
      const approval = tracker.forward("approval");

      approval(true);
      approval(true);
      expect(reports).toEqual([true]);

      approval(false);
      approval(false);
      expect(reports).toEqual([true, false]);
    });

    it("shares one episode with the owner's own writes", () => {
      const { reports, tracker } = tracked();
      const approval = tracker.forward("approval");

      const end = tracker.begin();
      approval(true);
      end();
      // The child is still writing.
      expect(reports).toEqual([true]);

      approval(false);
      expect(reports).toEqual([true, false]);
    });

    it("keeps children with different names apart", () => {
      const { reports, tracker } = tracked();
      const approval = tracker.forward("approval");
      const other = tracker.forward("other");

      approval(true);
      other(true);
      approval(false);
      expect(reports).toEqual([true]);

      other(false);
      expect(reports).toEqual([true, false]);
    });
  });

  describe("release (the owner unmounts)", () => {
    it("reports idle for a write still in flight and forgets it, so its late end reports nothing more", () => {
      const { reports, tracker } = tracked();
      const end = tracker.begin();

      tracker.release();
      expect(reports).toEqual([true, false]);

      end();
      tracker.release();
      expect(reports).toEqual([true, false]);
    });

    it("reports nothing when nothing is in flight", () => {
      const { reports, tracker } = tracked();

      tracker.release();
      const end = tracker.begin();
      end();
      tracker.release();

      expect(reports).toEqual([true, false]);
    });

    it("also frees a forwarded child that never said idle, and ignores the child's own cleanup afterwards", () => {
      const { reports, tracker } = tracked();
      const approval = tracker.forward("approval");
      approval(true);

      tracker.release();
      approval(false);

      expect(reports).toEqual([true, false]);
    });

    it("leaves the tracker usable, and the stale end of an earlier write cannot free a later one", () => {
      // A dev-mode remount reuses the same tracker after its cleanup ran.
      const { reports, tracker } = tracked();
      const stale = tracker.begin();
      tracker.release();

      const current = tracker.begin();
      expect(reports).toEqual([true, false, true]);

      stale();
      expect(reports).toEqual([true, false, true]);

      current();
      expect(reports).toEqual([true, false, true, false]);
    });
  });

  it("never sticks busy when the handler throws while going busy: nothing was counted", () => {
    let fail = true;
    const reports: boolean[] = [];
    const tracker = createBusyTracker((busy) => {
      if (fail) throw new Error("handler broke");
      reports.push(busy);
    });

    expect(() => tracker.begin()).toThrow("handler broke");

    fail = false;
    const end = tracker.begin();
    end();
    expect(reports).toEqual([true, false]);
  });

  it("reports to the handler it was last given, and to nobody when it has none", () => {
    const tracker = createBusyTracker();
    tracker.begin()();

    const first = vi.fn();
    const second = vi.fn();
    tracker.reportTo(first);
    const end = tracker.begin();
    // The handler of the render a write ends in hears about it, not the one it started in.
    tracker.reportTo(second);
    end();

    expect(first.mock.calls).toEqual([[true]]);
    expect(second.mock.calls).toEqual([[false]]);

    tracker.reportTo(undefined);
    tracker.begin()();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("trackBusy", () => {
  it("reports busy before the work starts and idle after it resolved, and hands its value back", async () => {
    const log: string[] = [];
    const tracker = createBusyTracker((busy) => {
      log.push(busy ? "busy" : "idle");
    });

    const value = await trackBusy(tracker, async () => {
      log.push("work");
      return 42;
    });

    expect(value).toBe(42);
    expect(log).toEqual(["busy", "work", "idle"]);
  });

  it("goes busy and starts the work in the same tick as the call, before anything is awaited", async () => {
    const { reports, tracker } = tracked();
    const work = vi.fn(() => Promise.resolve());

    const running = trackBusy(tracker, work);

    expect(reports).toEqual([true]);
    expect(work).toHaveBeenCalledTimes(1);
    await running;
    expect(reports).toEqual([true, false]);
  });

  it("stays busy for as long as the work is pending", async () => {
    const { reports, tracker } = tracked();
    let finish!: () => void;

    const running = trackBusy(tracker, () => new Promise<void>((resolve) => (finish = resolve)));
    await Promise.resolve();
    await Promise.resolve();
    expect(reports).toEqual([true]);

    finish();
    await running;
    expect(reports).toEqual([true, false]);
  });

  it("reports idle when the work failed, and the failure still reaches the caller", async () => {
    const { reports, tracker } = tracked();

    await expect(
      trackBusy(tracker, () => Promise.reject(new Error("PATCH refused"))),
    ).rejects.toThrow("PATCH refused");

    expect(reports).toEqual([true, false]);
  });

  it("reports idle when the work throws before it returns a promise", async () => {
    const { reports, tracker } = tracked();

    await expect(
      trackBusy(tracker, (): Promise<never> => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");

    expect(reports).toEqual([true, false]);
  });

  it("reports idle for a rejection that is not an Error", async () => {
    const { reports, tracker } = tracked();

    await expect(trackBusy(tracker, () => Promise.reject("gateway timeout"))).rejects.toBe("gateway timeout");

    expect(reports).toEqual([true, false]);
  });

  it("keeps two overlapping writes in one episode", async () => {
    const { reports, tracker } = tracked();
    const finish: Array<() => void> = [];
    const pending = () => new Promise<void>((resolve) => finish.push(resolve));

    const first = trackBusy(tracker, pending);
    const second = trackBusy(tracker, pending);
    expect(reports).toEqual([true]);

    finish[0]();
    await first;
    expect(reports).toEqual([true]);

    finish[1]();
    await second;
    expect(reports).toEqual([true, false]);
  });

  it("does not report a second idle for a write the owner's unmount already released", async () => {
    const { reports, tracker } = tracked();
    let finish!: () => void;

    const running = trackBusy(tracker, () => new Promise<void>((resolve) => (finish = resolve)));
    tracker.release();
    expect(reports).toEqual([true, false]);

    finish();
    await running;
    expect(reports).toEqual([true, false]);
  });
});

// The three PATCH writes a panel starts itself (the crawler config save, the base URL adoption, the ledgered approval)
// all go through this one function, so the rule "busy, then the panel is told, then idle" is tested here by behaviour.
describe("runPanelWrite", () => {
  interface Row {
    source: { id: string };
  }
  const row: Row = { source: { id: "bidnet_co_denver" } };

  /** A write whose every step is logged in order, with the busy signal in between. */
  function recorded(send: () => Promise<Row>) {
    const log: string[] = [];
    const tracker = createBusyTracker((busy) => {
      log.push(busy ? "busy" : "idle");
    });
    const run = () =>
      runPanelWrite(
        tracker,
        () => {
          log.push("send");
          return send();
        },
        {
          onWritten: (written) => {
            log.push(`written:${written.source.id}`);
          },
          onError: (message) => {
            log.push(`error:${message}`);
          },
          onSettled: () => {
            log.push("settled");
          },
        },
      );
    return { log, run, tracker };
  }

  it("goes busy, sends, hands the answer to the panel, lets it settle, and only then goes idle", async () => {
    const { log, run } = recorded(async () => row);

    await run();

    expect(log).toEqual(["busy", "send", "written:bidnet_co_denver", "settled", "idle"]);
  });

  it("goes busy and sends in the same tick as the click, before anything is awaited", async () => {
    const { log, run } = recorded(async () => row);

    const running = run();
    expect(log).toEqual(["busy", "send"]);

    await running;
  });

  it("stays busy for as long as the request is in flight", async () => {
    let respond!: (answer: Row) => void;
    const { log, run } = recorded(() => new Promise<Row>((resolve) => (respond = resolve)));

    const running = run();
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(["busy", "send"]);

    respond(row);
    await running;
    expect(log).toEqual(["busy", "send", "written:bidnet_co_denver", "settled", "idle"]);
  });

  it("shows a failure's message verbatim, lets the panel settle, and goes idle", async () => {
    const { log, run } = recorded(() => Promise.reject(new Error("Approval requires a compliance reviewer")));

    await expect(run()).resolves.toBeUndefined();

    expect(log).toEqual(["busy", "send", "error:Approval requires a compliance reviewer", "settled", "idle"]);
  });

  it("stringifies a rejection that is not an Error", async () => {
    const { log, run } = recorded(() => Promise.reject("gateway timeout"));

    await run();

    expect(log).toEqual(["busy", "send", "error:gateway timeout", "settled", "idle"]);
  });

  it("treats a request that throws before it returns a promise like one that rejects", async () => {
    const { log, run } = recorded(() => {
      throw new Error("offline");
    });

    await expect(run()).resolves.toBeUndefined();

    expect(log).toEqual(["busy", "send", "error:offline", "settled", "idle"]);
  });

  it("shows a panel that cannot take the answer in as a failed write, as it always did, and still settles and goes idle", async () => {
    const log: string[] = [];
    const tracker = createBusyTracker((busy) => {
      log.push(busy ? "busy" : "idle");
    });

    await runPanelWrite(tracker, async () => row, {
      onWritten: () => {
        throw new Error("could not apply the row");
      },
      onError: (message) => {
        log.push(`error:${message}`);
      },
      onSettled: () => {
        log.push("settled");
      },
    });

    expect(log).toEqual(["busy", "error:could not apply the row", "settled", "idle"]);
  });

  it("does not call onWritten for a failure, nor onError for a success", async () => {
    const onWritten = vi.fn();
    const onError = vi.fn();
    const tracker = createBusyTracker();

    await runPanelWrite(tracker, async () => row, { onWritten, onError, onSettled: () => undefined });
    expect([onWritten.mock.calls.length, onError.mock.calls.length]).toEqual([1, 0]);

    await runPanelWrite(tracker, () => Promise.reject(new Error("nope")), { onWritten, onError, onSettled: () => undefined });
    expect([onWritten.mock.calls.length, onError.mock.calls.length]).toEqual([1, 1]);
  });

  it("reports idle for a write whose panel unmounted meanwhile, once", async () => {
    let respond!: (answer: Row) => void;
    const { log, run, tracker } = recorded(() => new Promise<Row>((resolve) => (respond = resolve)));

    const running = run();
    tracker.release();
    respond(row);
    await running;

    // The page was freed by the unmount; the write's own end adds no second idle. The panel still hears the answer.
    expect(log).toEqual(["busy", "send", "idle", "written:bidnet_co_denver", "settled"]);
  });
});

describe("nextBusyIds", () => {
  type Panel = "precheck" | "config";

  it("adds an id that goes busy and removes one that goes idle, without touching the set it was given", () => {
    const empty: ReadonlySet<Panel> = new Set();

    const busy = nextBusyIds(empty, "config", true);
    expect([...busy]).toEqual(["config"]);
    expect(empty.size).toBe(0);

    const idle = nextBusyIds(busy, "config", false);
    expect(idle.size).toBe(0);
    expect([...busy]).toEqual(["config"]);
  });

  it("returns the very same set when nothing changes, so a repeated report renders nothing", () => {
    const empty: ReadonlySet<Panel> = new Set();
    const busy: ReadonlySet<Panel> = new Set<Panel>(["precheck"]);

    expect(nextBusyIds(empty, "precheck", false)).toBe(empty);
    expect(nextBusyIds(busy, "precheck", true)).toBe(busy);
  });

  it("keeps one panel's idle from freeing the lock another panel holds", () => {
    let ids: ReadonlySet<Panel> = new Set();
    ids = nextBusyIds(ids, "precheck", true);
    ids = nextBusyIds(ids, "config", true);

    ids = nextBusyIds(ids, "precheck", false);
    expect([...ids]).toEqual(["config"]);
    // The panel's cleanup after its own idle.
    ids = nextBusyIds(ids, "precheck", false);
    expect([...ids]).toEqual(["config"]);

    ids = nextBusyIds(ids, "config", false);
    expect(ids.size).toBe(0);
  });
});

// The hooks cannot run in this node environment (no DOM, no effects on the server); what they must and must not do is
// pinned by their source, and the pure core above carries the behaviour.
describe("busy-reporting hooks", () => {
  const source = readFileSync(new URL("busy-reporting.ts", import.meta.url), "utf8");

  it("swaps the tracker's handler in an effect, never during render", () => {
    expect(source).toContain("const [tracker] = useState(() => createBusyTracker(onBusyChange));");
    expect(source).toMatch(/useEffect\(\(\) => \{\n\s*tracker\.reportTo\(onBusyChange\);\n\s*\}, \[tracker, onBusyChange\]\);/);
  });

  it("reports idle from the cleanup of an unmounting panel, so a page is never left locked", () => {
    expect(source).toContain("useEffect(() => () => tracker.release(), [tracker]);");
  });

  it("sets the page's state only from the callback a panel reports through, never from an effect or a render", () => {
    expect(source.match(/setBusyIds\(/g)).toHaveLength(1);
    expect(source).toContain("useCallback((id: Id, busy: boolean) => setBusyIds((current) => nextBusyIds(current, id, busy)), [])");
  });
});
