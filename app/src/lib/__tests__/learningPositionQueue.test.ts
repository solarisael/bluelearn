import { describe, expect, it } from "vitest";
import { queueLearningPosition } from "@/lib/learningPositionQueue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("position write ordering within one tab", () => {
  it("waits for delayed A before saving B for the same account and objective", async () => {
    const delayed = deferred();
    const started: Array<string> = [];
    let position: string | undefined;
    const first = queueLearningPosition(
      "ordering:objective",
      () => true,
      async () => {
        started.push("A");
        await delayed.promise;
        position = "A";
        return "A";
      }
    );
    const second = queueLearningPosition(
      "ordering:objective",
      () => true,
      () => {
        started.push("B");
        position = "B";
        return Promise.resolve("B");
      }
    );

    expect(started).toEqual(["A"]);
    delayed.resolve();

    expect(await Promise.all([first, second])).toEqual(["A", "B"]);
    expect(started).toEqual(["A", "B"]);
    expect(position).toBe("B");
  });

  it("drops a queued write when its owner becomes stale before execution", async () => {
    const delayed = deferred();
    let current = true;
    let saved = false;
    const first = queueLearningPosition(
      "stale:objective",
      () => true,
      () => delayed.promise
    );
    const queued = queueLearningPosition(
      "stale:objective",
      () => current,
      () => {
        saved = true;
        return Promise.resolve();
      }
    );
    current = false;
    delayed.resolve();

    await first;
    expect(await queued).toBeNull();
    expect(saved).toBe(false);
  });

  it("keeps only the latest pending position while a write is in flight", async () => {
    const delayed = deferred();
    const completed: Array<string> = [];
    const first = queueLearningPosition(
      "bounded:objective",
      () => true,
      () => delayed.promise
    );
    const superseded = queueLearningPosition(
      "bounded:objective",
      () => true,
      () => {
        completed.push("B");
        return Promise.resolve();
      }
    );
    const latest = queueLearningPosition(
      "bounded:objective",
      () => true,
      () => {
        completed.push("C");
        return Promise.resolve();
      }
    );

    expect(await superseded).toBeNull();
    delayed.resolve();
    await Promise.all([first, latest]);
    expect(completed).toEqual(["C"]);
  });

  it("does not block another account or objective and continues after failure", async () => {
    const delayed = deferred();
    const first = queueLearningPosition(
      "failure:objective",
      () => true,
      async () => {
        await delayed.promise;
        throw new Error("write failed");
      }
    );
    const rejected = first.catch((error: Error) => error.message);
    const next = queueLearningPosition(
      "failure:objective",
      () => true,
      () => Promise.resolve("next")
    );
    const independent = queueLearningPosition(
      "other:objective",
      () => true,
      () => Promise.resolve("independent")
    );

    expect(await independent).toBe("independent");
    delayed.resolve();
    expect(await rejected).toBe("write failed");
    expect(await next).toBe("next");
    expect(
      await queueLearningPosition(
        "failure:objective",
        () => true,
        () => Promise.resolve("later")
      )
    ).toBe("later");
  });
});
