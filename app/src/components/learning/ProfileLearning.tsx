import { useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/authContext";
import { getPublicLearning } from "@/lib/api/learning";
import { useLearningResource } from "@/lib/useLearning";
import { LearningFailure } from "@/components/learning/ReaderLearning";

export function ProfileLearning({ username }: { username: string }) {
  const { user, currentProfile, loading, rolesLoading } = useAuth();
  const load = useCallback(
    (signal: AbortSignal) => getPublicLearning(username, { signal }),
    [username]
  );
  const achievements = useLearningResource(
    `public-learning:${username}`,
    load,
    false
  );

  return (
    <section aria-label="Completed objectives" className="mb-8 space-y-3">
      {!loading &&
        !rolesLoading &&
        currentProfile?.id === user?.id &&
        currentProfile?.username === username && (
          <div className="flex flex-wrap gap-3">
            <Link to="/learning" className="btn-outline">
              Your learning
            </Link>
            <Link to="/settings/learning" className="btn-outline">
              Privacy settings
            </Link>
          </div>
        )}
      <h2 className="text-lg font-semibold">Completed objectives</h2>
      <LearningFailure
        error={achievements.error}
        refresh={achievements.refresh}
      />
      {achievements.loading && (
        <p role="status" className="text-sm">
          Loading...
        </p>
      )}
      {achievements.data?.objectives.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No shared completions yet.
        </p>
      )}
      <ul className="space-y-3">
        {achievements.data?.objectives.map((objective) => (
          <li
            key={`${objective.slug}:${objective.completed_revision_id}`}
            className="space-y-1 rounded-lg border p-3"
          >
            <Link
              to="/objectives/$slug/revisions/$revisionId"
              params={{
                slug: objective.slug,
                revisionId: objective.completed_revision_id,
              }}
              className="font-semibold underline"
            >
              {objective.title}
            </Link>
            <p className="text-sm text-muted-foreground">
              Completed {new Date(objective.completed_at).toLocaleDateString()}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
