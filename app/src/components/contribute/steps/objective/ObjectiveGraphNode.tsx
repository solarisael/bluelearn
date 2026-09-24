import { Handle, Position } from "@xyflow/react";
import { GuideGraphNode } from "@/components/graph/GuideGraphNode";
import { Card, CardHeader } from "@/components/ui/card";

// Matches GuideGraphNode's fixedWidth w-[260px], so the layout centres what is
// drawn.
export const OBJECTIVE_NODE_WIDTH = 260;

export type ObjectiveNodeData = {
  title: string;
  summary?: string;
  isTarget: boolean;
  isHovered: boolean;
  isDimmed: boolean;
};

type ObjectiveNodeProps = {
  data: ObjectiveNodeData;
};

// Flip these together with the row order in layoutObjectiveGraph.
const CANVAS_HANDLES = {
  target: Position.Bottom,
  source: Position.Top,
  className:
    "!h-3 !w-3 !cursor-crosshair rounded-full !border-none !bg-primary/70 transition-[width,height,background-color] hover:!h-4.5 hover:!w-4.5 hover:!bg-primary",
};

export function ObjectiveGuideNode({ data }: ObjectiveNodeProps) {
  return (
    <GuideGraphNode
      data={data}
      isSelected={false}
      handles={CANVAS_HANDLES}
      fixedWidth
      focusOnHover
    />
  );
}

export function ObjectiveRequestNode({ data }: ObjectiveNodeProps) {
  return (
    <GuideGraphNode
      data={data}
      isSelected={false}
      handles={CANVAS_HANDLES}
      fixedWidth
      focusOnHover
      isRequest
    />
  );
}

// The objective itself, as typed in Objective Details. Same width and dots as
// a guide card so layout and connecting treat it alike; the frame says which
// card the rest of the graph is for.
export function ObjectiveCardNode({ data }: ObjectiveNodeProps) {
  const { title, summary, isHovered, isDimmed } = data;
  const glow = isHovered
    ? "ring-2 ring-brand-bright-blue shadow-[0_0_16px_0] shadow-brand-bright-blue/40"
    : "";

  return (
    <div
      className={`relative w-[260px] cursor-pointer transition-opacity duration-150 select-none ${
        isDimmed ? "opacity-30" : ""
      }`}
    >
      <Card
        className={`relative gap-0 rounded-md border-2 border-brand-orange py-0 ring-0 transition-colors ${
          isHovered ? "bg-muted" : "bg-background"
        } ${glow}`}
      >
        <CardHeader className="[container-type:normal] gap-1 py-3.5">
          <p className="mono-micro text-brand-orange">Objective</p>
          <h3 className="text-lg font-semibold tracking-tight">
            {title || "Untitled objective"}
          </h3>
          {summary && (
            <p className="text-sm text-muted-foreground">{summary}</p>
          )}
        </CardHeader>
      </Card>

      {/* After the Card, so the handles paint over it and stay clickable. */}
      <Handle
        type="target"
        position={CANVAS_HANDLES.target}
        className={CANVAS_HANDLES.className}
      />
      <Handle
        type="source"
        position={CANVAS_HANDLES.source}
        className={CANVAS_HANDLES.className}
      />
    </div>
  );
}
