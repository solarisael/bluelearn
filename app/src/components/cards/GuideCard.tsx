import { Link } from "@tanstack/react-router";
import type { AnalyticsSource, BreadcrumbOrigin } from "@/lib/breadcrumbs";
import type { ObjectiveGuideSearch } from "@/lib/objectiveSnapshot";
import type { Route as GuideRoute } from "@/routes/guides/$slug/index";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Footer } from "@/components/cards/Footer";

type GuideProp = {
  slug: string;
  title: string;
  author?: string | null;
  summary?: string | null;
  created_at?: string;
  status?: string;
  tags?: Array<string | { slug: string; name: string }>;
  stats?: Array<{ label: string; data: string | number }>;
  actionBtns?: React.ReactNode;
  // An objective's linear view lists requests beside guides; nobody has
  // written one yet, so it has no author or date to show.
  isRequest?: boolean;
};

type PropTypes = {
  guide: GuideProp;
  to?: typeof GuideRoute.to;
  origin?: BreadcrumbOrigin;
  variantSlug?: string;
  source?: AnalyticsSource;
  onSelect?: React.MouseEventHandler<HTMLAnchorElement>;
  readStatus?: "read" | "unread" | "requested" | "unavailable";
  search?: ObjectiveGuideSearch;
};

export const GuideCard = ({
  guide,
  to,
  origin,
  search,
  variantSlug,
  source,
  onSelect,
  readStatus,
}: PropTypes) => {
  const card = (
    <Card className="group h-full rounded-md bg-background shadow-none transition-colors hover:bg-muted">
      <CardHeader className="relative p-4">
        <div className="flex items-center justify-between">
          <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
            {guide.isRequest ? "Guide request" : "Guide"}
          </p>
          {readStatus && (
            <Badge variant="outline" className="capitalize">
              {readStatus}
            </Badge>
          )}
          {guide.status && (
            <Badge
              variant="default"
              className="mono-micro rounded-full border border-badge-border bg-badge tracking-[0.08em] text-badge-foreground"
            >
              {guide.status}
            </Badge>
          )}
        </div>
        <h3 className="line-clamp-2 text-xl font-semibold tracking-tight">
          {guide.title}
        </h3>
        {!guide.isRequest && (
          <div className="flex items-center justify-between text-sm">
            <p className="mono-micro text-muted-foreground">
              @{guide.author ?? "deleted_user"} | {guide.created_at}
            </p>
          </div>
        )}
      </CardHeader>
      <CardContent className="border-t p-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          {guide.summary}
        </p>
        <div className="flex flex-wrap gap-2 pt-4">
          {(guide.tags ?? []).map((tag) => {
            const slug = typeof tag === "string" ? tag : tag.slug;
            const name = typeof tag === "string" ? tag : tag.name;
            return (
              <Badge
                key={slug}
                variant="default"
                className="mono-micro rounded-full border border-badge-border bg-badge tracking-[0.08em] text-badge-foreground"
              >
                {name}
              </Badge>
            );
          })}
        </div>
      </CardContent>
      {(guide.stats || guide.actionBtns) && (
        <Footer data={{ stats: guide.stats, actionBtns: guide.actionBtns }} />
      )}
    </Card>
  );
  if (!to) {
    return card;
  }
  return (
    <Link
      to={variantSlug ? "/guides/$slug/$variantSlug" : to}
      params={{ slug: guide.slug, ...(variantSlug && { variantSlug }) }}
      search={search}
      state={{
        breadcrumbOrigin: origin,
        analyticsSource: source ?? origin?.type,
      }}
      onClick={onSelect}
    >
      {card}
    </Link>
  );
};
