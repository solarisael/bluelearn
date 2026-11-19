import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelLeftOpen } from "lucide-react";
import type {
  GuideListItem,
  Objective,
  ObjectiveSnapshot,
} from "@bluelearn/schemas";
import type { LearningStep } from "@/lib/api/learning";
import { GuideGraph } from "@/components/graph/GuideGraph";
import { ObjectiveLearningNode } from "@/components/objective/ObjectiveLearningNode";
import { WalkthroughPanel } from "@/components/graph/WalkthroughPanel";
import { buildObjectiveGraph, defaultTargetId } from "@/lib/objectiveGraph";

const nodeTypes = { walkthroughNode: ObjectiveLearningNode };

type ObjectiveGraphProps = {
  objective: Pick<Objective, "slug" | "title">;
  snapshot: ObjectiveSnapshot;
  guides: Array<GuideListItem>;
  learningSteps?: ReadonlyArray<LearningStep>;
  revisionId?: string;
  targetId?: string | null;
  // Owned by the page so a switch to the linear view and back keeps it.
  // Null means nothing was clicked yet, so the panel stays hidden.
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  // The contribution preview renders an unsaved draft, so nothing may
  // navigate away from it.
  preview?: boolean;
};

// Inspecting a prerequisite must not change the reader's active target.
// The initial ids restore a place the learner left; an id that is not a
// target falls back to the default like any other.
export function useObjectiveSelection(
  snapshot: Pick<ObjectiveSnapshot, "nodes">,
  initial: { selectedId?: string | null; targetId?: string | null } = {}
) {
  const [selectedId, setSelectedId] = useState<string | null>(
    initial.selectedId ?? null
  );
  const [chosenTargetId, setChosenTargetId] = useState<string | null>(
    initial.targetId ?? null
  );

  const targetNode = (id: string | null | undefined) => {
    if (!id) return undefined;

    return snapshot.nodes.find(
      (node) =>
        (node.id === id || node.guide_base_id === id) &&
        node.is_included &&
        node.is_target
    );
  };
  const targetId =
    targetNode(chosenTargetId)?.id ??
    targetNode(initial.targetId)?.id ??
    defaultTargetId(snapshot);

  const select = (id: string | null) => {
    setSelectedId(id);
    const target = targetNode(id);

    if (target) setChosenTargetId(target.id);
  };

  return { selectedId, targetId, select };
}

export function ObjectiveGraph({
  objective,
  snapshot,
  guides,
  learningSteps,
  revisionId,
  targetId,
  selectedId,
  onSelect,
  preview = false,
}: ObjectiveGraphProps) {
  const { walkthrough, nodes, defaultId } = useMemo(
    () => buildObjectiveGraph(snapshot, guides),
    [snapshot, guides]
  );

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const selectedNode =
    walkthrough.nodes.find((node) => node.id === selectedId) ??
    walkthrough.nodes.find((node) => node.id === defaultId);
  const selectedNodeId = selectedNode?.id;
  const readsByGuide = useMemo(
    () => new Map(learningSteps?.map((step) => [step.guide_id, step])),
    [learningSteps]
  );

  const getNodeState = useCallback(
    (id: string) => {
      const node = nodes.get(id)!;
      const read = node.guideId ? readsByGuide.get(node.guideId) : undefined;
      let readState = read?.state;

      if (node.isRequest) readState = "requested";
      else if (node.guideSlug === null) readState = "unavailable";

      return {
        isSelected: id === selectedNodeId,
        isTarget: node.isTarget,
        isRequest: node.isRequest,
        isIncluded: node.isIncluded,
        readState: node.isIncluded ? readState : undefined,
        hasNewerRevision: read?.has_newer_revision,
      };
    },
    [selectedNodeId, nodes, readsByGuide]
  );

  useEffect(() => {
    if (!isFullscreen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen]);

  if (!selectedNode) {
    return (
      <p className="text-sm text-muted-foreground">
        This objective has no included guides yet.
      </p>
    );
  }

  const selected = nodes.get(selectedNode.id)!;
  const selectedLearning = getNodeState(selectedNode.id);
  // Closed, the panel folds into a rail; the rail opens on the default node.
  const isOpen = selectedId !== null;

  return (
    <div
      className={
        isOpen
          ? "flex flex-col-reverse gap-3 md:grid md:grid-cols-[320px_1fr] md:gap-3"
          : "flex flex-col-reverse gap-3 md:grid md:grid-cols-[48px_1fr] md:gap-2"
      }
    >
      {isOpen ? (
        <WalkthroughPanel
          node={selectedNode}
          objective={objective}
          guideSlug={selected.guideSlug}
          isRequest={selected.isRequest}
          variantSlug={selected.variantSlug}
          objectiveSearch={{
            objective: objective.slug,
            target: targetId ?? undefined,
            revision: revisionId,
          }}
          readState={selectedLearning.readState}
          hasNewerRevision={selectedLearning.hasNewerRevision}
          isIncluded={selected.isIncluded}
          preview={preview}
          onClose={() => onSelect(null)}
        />
      ) : (
        <div className="flex items-center justify-center py-2 md:h-full md:items-start md:py-4">
          <button
            type="button"
            onClick={() => onSelect(selectedNode.id)}
            aria-label="Open panel"
            title="Open panel"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      )}
      <div
        className={
          isFullscreen
            ? "fixed inset-0 z-50 bg-background"
            : "h-[500px] min-w-0 overflow-hidden rounded-xl border border-border bg-muted/10"
        }
      >
        <GuideGraph
          walkthroughData={walkthrough}
          targetSlug={objective.slug}
          hoveredGuide={hoveredId}
          onHoverGuide={setHoveredId}
          nodeType="walkthroughNode"
          nodeTypes={nodeTypes}
          getNodeState={getNodeState}
          onNodeClick={onSelect}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => setIsFullscreen((value) => !value)}
          showFitView={false}
        />
      </div>
    </div>
  );
}
