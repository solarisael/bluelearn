import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { RegisteredRouter, ToPathOption } from "@tanstack/react-router";

import type { AnalyticsSource, BreadcrumbOrigin } from "@/lib/breadcrumbs";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Footer } from "@/components/cards/Footer";
import { ObjectiveCardProgress } from "@/components/learning/ObjectiveCardProgress";

type FeaturedNode = {
  position: number;
  slug: string | null;
  title: string | null;
};

type ObjectiveProp = {
  slug: string;
  title: string | null;
  summary?: string | null;
  curator?: string | null;
  created_at?: string;
  status?: string;
  featuredSubObjective?: Array<FeaturedNode>;
  levels?: Array<{ level: number; guide: { title: string } }>;
  stats?: Array<{ label: string; data: string | number }>;
  actionBtns?: React.ReactNode;
};

type PropTypes = {
  objective: ObjectiveProp;
  to: ToPathOption<RegisteredRouter>;
  origin?: BreadcrumbOrigin;
  source?: AnalyticsSource;
};

// Only the last three guides are drawn. The rest collapse into a leading
// "N more guides" marker.
function FeaturedSubObjective({ nodes }: { nodes: Array<FeaturedNode> }) {
  const shown = nodes.slice(-3);
  const hidden = nodes.length - shown.length;

  return (
    <CardContent className="border-t p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        {hidden > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <div className="flex w-full items-center gap-3 sm:w-18 sm:flex-col sm:justify-center sm:gap-0 sm:text-center md:w-22">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center text-sm font-medium">
                {hidden}
              </span>
              <span className="line-clamp-3 text-sm leading-snug text-muted-foreground">
                guides
              </span>
            </div>
            <div className="flex w-8 shrink-0 justify-center py-1 sm:w-auto sm:py-0">
              <ArrowRight className="h-4 w-4 shrink-0 rotate-90 text-muted-foreground sm:mt-1.5 sm:rotate-0" />
            </div>
          </div>
        )}
        {shown.map((step, index) => (
          <div
            key={step.position}
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex w-full items-center gap-3 sm:w-24 sm:flex-col sm:justify-center sm:gap-0 sm:text-center md:w-28">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-badge text-sm font-medium">
                {step.position}
              </span>
              <span className="line-clamp-3 text-sm leading-snug text-muted-foreground">
                {step.title}
              </span>
            </div>
            {index < shown.length - 1 && (
              <div className="flex w-8 shrink-0 justify-center py-1 sm:w-auto sm:py-0">
                <ArrowRight className="h-5 w-5 shrink-0 rotate-90 text-muted-foreground sm:rotate-0" />
              </div>
            )}
          </div>
        ))}
      </div>
    </CardContent>
  );
}

// Legacy graph for routes still feeding static level data.
function LevelsGraph({
  levels,
}: {
  levels: Array<{ level: number; guide: { title: string } }>;
}) {
  const previewLevels = levels.slice(0, 3);
  const remaining = levels.length - previewLevels.length;

  return (
    <CardContent className="border-t p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        {remaining > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <div className="flex w-full items-center gap-3 sm:w-18 sm:flex-col sm:justify-center sm:gap-0 sm:text-center md:w-22">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center text-sm font-medium">
                {remaining}
              </span>
              <span className="line-clamp-3 text-sm leading-snug text-muted-foreground">
                guides
              </span>
            </div>
            <div className="flex w-8 shrink-0 justify-center py-1 sm:w-auto sm:py-0">
              <ArrowRight className="h-5 w-5 shrink-0 rotate-90 text-muted-foreground sm:rotate-0" />
            </div>
          </div>
        )}

        {previewLevels.map((level, index) => (
          <div
            key={index}
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex w-full items-center gap-3 sm:w-24 sm:flex-col sm:justify-center sm:gap-0 sm:text-center md:w-28">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-badge text-sm font-medium">
                {level.level}
              </span>
              <span className="line-clamp-3 text-sm leading-snug text-muted-foreground">
                {level.guide.title}
              </span>
            </div>

            {index < previewLevels.length - 1 && (
              <div className="flex w-8 shrink-0 justify-center py-1 sm:w-auto sm:py-0">
                <ArrowRight className="h-5 w-5 shrink-0 rotate-90 text-muted-foreground sm:rotate-0" />
              </div>
            )}
          </div>
        ))}
      </div>
    </CardContent>
  );
}

export const ObjectiveCard = ({ objective, to, origin, source }: PropTypes) => {
  return (
    <Link
      to={to}
      params={{ slug: objective.slug }}
      state={{
        breadcrumbOrigin: origin,
        analyticsSource: source ?? origin?.type,
      }}
    >
      <Card className="group flex h-full flex-col justify-between rounded-md bg-background shadow-none transition-colors hover:bg-muted">
        {/* Header */}
        <CardHeader className="relative p-4">
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
              Objective
            </p>
            {objective.status && (
              <Badge
                variant="default"
                className="mono-micro rounded-full border border-badge-border bg-badge tracking-[0.08em] text-badge-foreground"
              >
                {objective.status}
              </Badge>
            )}
          </div>

          <h3 className="line-clamp-2 text-xl font-semibold tracking-tight">
            {objective.title}
          </h3>

          <p className="max-w-2xl text-sm text-muted-foreground">
            {objective.summary}
          </p>
          <ObjectiveCardProgress slug={objective.slug} />

          <div className="flex items-center justify-between">
            <p className="mono-micro text-muted-foreground">
              @{objective.curator} | {objective.created_at}
            </p>
          </div>
        </CardHeader>

        {/* Graph Preview */}
        {objective.featuredSubObjective !== undefined
          ? objective.featuredSubObjective.length > 0 && (
              <FeaturedSubObjective nodes={objective.featuredSubObjective} />
            )
          : objective.levels && <LevelsGraph levels={objective.levels} />}

        {/* Footer */}
        {(objective.stats || objective.actionBtns) && (
          <Footer
            data={{ stats: objective.stats, actionBtns: objective.actionBtns }}
          />
        )}
      </Card>
    </Link>
  );
};
