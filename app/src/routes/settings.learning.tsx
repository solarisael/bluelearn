import { Link, createFileRoute } from "@tanstack/react-router";
import { updateLearningPreferences } from "@/lib/api/learning";
import { useLearningMutation, useLearningPreferences } from "@/lib/useLearning";
import { LearningFailure } from "@/components/learning/ReaderLearning";

export const Route = createFileRoute("/settings/learning")({
  ssr: false,
  component: LearningSettings,
});

function LearningSettings() {
  const preferences = useLearningPreferences();
  const mutation = useLearningMutation();
  const data = preferences.data;
  const disabled = !data || preferences.loading || mutation.pending;

  return (
    <section className="max-w-2xl space-y-6">
      <h1 className="font-mono text-sm tracking-[0.08em] uppercase">
        Learning preferences
      </h1>
      {preferences.loading && (
        <p role="status">Loading learning preferences...</p>
      )}
      <LearningFailure
        error={preferences.error}
        refresh={preferences.refresh}
      />
      <LearningFailure error={mutation.error} />
      <div className="space-y-2 border-b pb-6">
        <label className="flex items-center gap-3 font-semibold">
          <input
            type="checkbox"
            checked={data?.history_paused ?? false}
            disabled={disabled}
            onChange={(event) => {
              const history_paused = event.currentTarget.checked;
              void mutation.run(() =>
                updateLearningPreferences({ history_paused })
              );
            }}
          />
          Pause reading history
        </label>
        <p className="text-sm text-muted-foreground">
          Stops history. Progress still saves.
        </p>
        <p className="text-sm text-muted-foreground">
          History stays private for 90 days.{" "}
          <Link to="/history" className="underline">
            Manage history
          </Link>
        </p>
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-3 font-semibold">
          <input
            type="checkbox"
            checked={data?.show_completed_objectives ?? false}
            disabled={disabled}
            onChange={(event) => {
              const show_completed_objectives = event.currentTarget.checked;
              void mutation.run(() =>
                updateLearningPreferences({ show_completed_objectives })
              );
            }}
          />
          Share completed objectives
        </label>
        <p className="text-sm text-muted-foreground">
          Show completions on your profile. History and unfinished progress stay
          private.
        </p>
      </div>
      {mutation.pending && <p role="status">Saving preferences...</p>}
    </section>
  );
}
