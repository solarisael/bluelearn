import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/authContext";
import { ApiError } from "@/lib/api/apiHelpers";
import { getLearningPreferences } from "@/lib/api/learning";

export function learningErrorCategory(error: unknown) {
  if (!(error instanceof ApiError)) return "network" as const;
  if (error.status === 409) return "conflict" as const;
  if (error.status === 401 || error.status === 403) return "forbidden" as const;
  if (error.status === 404 || error.status === 410)
    return "unavailable" as const;

  return "server" as const;
}

export function learningErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Could not save learning state.";
}

function refreshLearning() {
  window.dispatchEvent(new Event("bluelearn:learning-changed"));
}

export function useLearningResource<T>(
  resource: string,
  load: (signal: AbortSignal) => Promise<T>
) {
  const { user, loading: authLoading } = useAuth();
  const owner = user?.id;
  const key = !authLoading && owner ? `${owner}:${resource}` : null;
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data?: T;
    error?: Error;
    loading: boolean;
  } | null>(null);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    window.addEventListener("bluelearn:learning-changed", refresh);
    return () =>
      window.removeEventListener("bluelearn:learning-changed", refresh);
  }, [refresh]);

  useEffect(() => {
    if (!key) return;

    const controller = new AbortController();
    setResult((previous) => ({
      key,
      data: previous?.key === key ? previous.data : undefined,
      loading: true,
    }));
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setResult({ key, data, loading: false });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setResult((previous) => ({
            key,
            data: previous?.key === key ? previous.data : undefined,
            error:
              error instanceof Error
                ? error
                : new Error("Could not load learning state."),
            loading: false,
          }));
        }
      });

    return () => controller.abort();
  }, [key, load, version]);

  const current = key && result?.key === key ? result : null;

  return {
    data: current?.data,
    error: current?.error,
    loading: authLoading || Boolean(key && (!current || current.loading)),
    refresh,
  };
}

export function useLearningPreferences() {
  const load = useCallback(
    (signal: AbortSignal) => getLearningPreferences({ signal }),
    []
  );
  return useLearningResource("preferences", load);
}

export function useLearningMutation() {
  const { user, loading } = useAuth();
  const owner = !loading && user ? user.id : undefined;
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const inFlight = useRef<{ owner: string } | null>(null);
  const [result, setResult] = useState<{
    owner: string;
    pending: boolean;
    error?: Error;
  } | null>(null);

  useEffect(() => {
    currentOwner.current = owner;
    return () => {
      if (currentOwner.current === owner) currentOwner.current = undefined;
    };
  }, [owner]);

  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    if (
      !owner ||
      currentOwner.current !== owner ||
      inFlight.current?.owner === owner
    )
      return null;

    const account = owner;
    const request = { owner: account };
    inFlight.current = request;
    setResult({ owner: account, pending: true });

    try {
      const value = await action();

      if (currentOwner.current !== account || inFlight.current !== request)
        return null;

      setResult({ owner: account, pending: false });
      refreshLearning();
      return value;
    } catch (error) {
      if (currentOwner.current !== account || inFlight.current !== request)
        return null;

      setResult({
        owner: account,
        pending: false,
        error:
          error instanceof Error
            ? error
            : new Error("Could not save learning state."),
      });
      return null;
    } finally {
      if (inFlight.current === request) inFlight.current = null;
    }
  }

  return {
    run,
    pending: Boolean(result && result.owner === owner && result.pending),
    error: result && result.owner === owner ? result.error : undefined,
  };
}
