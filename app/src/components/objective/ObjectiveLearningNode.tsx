import type { ComponentProps } from "react";
import type { ReadState } from "@/components/learning/ReadStatus";
import { WalkthroughNode } from "@/components/graph/WalkthroughNode";
import { ReadStatus } from "@/components/learning/ReadStatus";

type Props = ComponentProps<typeof WalkthroughNode> & {
  data: {
    readState?: ReadState;
    hasNewerRevision?: boolean;
    isIncluded?: boolean;
  };
};

export function ObjectiveLearningNode({ data }: Props) {
  return (
    <div className="space-y-1">
      <WalkthroughNode data={data} />
      {data.isIncluded === false ? (
        <p className="text-xs text-muted-foreground">
          Skipped · Does not count toward completion
        </p>
      ) : (
        <ReadStatus state={data.readState} newer={data.hasNewerRevision} />
      )}
    </div>
  );
}
