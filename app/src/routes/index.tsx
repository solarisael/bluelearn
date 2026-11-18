import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

import type { SearchFilters } from "@/lib/api/search";

import { Route as SubjectRoute } from "@/routes/subjects.$slug";
import { listSubjects } from "@/lib/api/subjects";
import { beginSearchSubmission } from "@/components/analytics/SearchTelemetry";
import { SearchBar } from "@/components/SearchBar";
import { SearchFilterMenu } from "@/components/SearchFilterMenu";
import { Separator } from "@/components/ui/separator";

const BLUE_CONCEPTS = [
  {
    slug: "what-is-bluelearn",
    label: "What is Bluelearn?",
    blurb: "A free, community-built knowledge base.",
  },
  {
    slug: "what-is-a-guide",
    label: "What is a Guide?",
    blurb: "The basic unit: one article per topic.",
  },
  {
    slug: "what-is-a-knowledge-graph",
    label: "What is a Knowledge Graph?",
    blurb: "Guides linked by prerequisite edges.",
  },
  {
    slug: "what-is-an-objective",
    label: "What is an Objective?",
    blurb: "A curated path toward a goal.",
  },
];

// subjects failing shouldn't take down the rest of the homepage, so the
// failure is data instead of an errorComponent
export const Route = createFileRoute("/")({
  loader: async ({ abortController }) => {
    try {
      return {
        subjects: await listSubjects({ signal: abortController.signal }),
        subjectsFailed: false,
      };
    } catch (err) {
      // a cancelled load isn't a failure. swallowing it would cache the empty
      // result as a success and the router would never refetch.
      if (abortController.signal.aborted) throw err;
      return { subjects: [], subjectsFailed: true };
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { subjects, subjectsFailed } = Route.useLoaderData();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>({});

  return (
    <div className="mx-auto max-w-[1280px] bg-background">
      {/* Hero */}
      <section>
        <div className="grid items-center gap-12 px-8 py-16 lg:grid-cols-[1fr_320px] lg:px-16">
          {/* Left */}
          <div>
            <p className="mb-3 font-mono text-[12px] tracking-[0.08em] text-muted-foreground uppercase">
              Browse Knowledge
            </p>
            <h1 className="max-w-3xl text-4xl font-bold tracking-[-0.04em] lg:text-6xl">
              Welcome to{" "}
              <span className="text-brand-bright-blue italic">Bluelearn</span>,
              <br />
              have a look around...
            </h1>
            <p className="mt-6 max-w-xl font-mono text-sm text-muted-foreground">
              anything and everything you think of can be found
              <span className="font font-bold text-brand-bright-blue">*</span>
            </p>
          </div>
          {/* Right */}
          <div className="flex flex-col items-end">
            <div className="aspect-[4/3] w-full overflow-hidden">
              <img
                src="/assets/adam/adam-sphere-smile.png"
                alt="Bluelearn"
                className="h-full w-full object-cover"
              />
            </div>

            <p className="mt-3 text-right font-mono text-xs tracking-[0.08em] text-muted-foreground">
              <span className="font-bold text-brand-bright-blue">*</span>can't
              find your subject area?
              <br />
              contribute a guide
            </p>
          </div>
        </div>
      </section>

      <Separator className="bg-border" />

      <section className="px-8 py-10 lg:px-16">
        <SearchBar
          value={query}
          onChange={setQuery}
          onSubmit={() => {
            const q = query.trim();

            if (!q) return;

            const searchSubmissionId = beginSearchSubmission();
            navigate({
              to: "/browse",
              search: {
                q,
                scope: filters.scope,
                kind: filters.knowledgeType,
              },
              state: { searchSubmissionId },
            });
          }}
          filter={<SearchFilterMenu value={filters} onChange={setFilters} />}
        />
      </section>

      <Separator className="bg-border" />

      <section className="px-8 py-8 lg:px-16">
        <div className="mb-6">
          <p className="font-mono text-[12px] tracking-[0.08em] text-muted-foreground uppercase">
            Browse Subjects
          </p>
        </div>

        <Separator className="mb-4 bg-border" />

        {subjectsFailed && (
          <p className="text-sm text-muted-foreground">
            Subjects could not be loaded. Try again shortly.
          </p>
        )}

        {!subjectsFailed && subjects.length === 0 && (
          <p className="text-sm text-muted-foreground">No subjects yet.</p>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...subjects]
            .sort((a, b) => a.name.localeCompare(b.name))
            .slice(0, 6)
            .map((subject) => (
              <Link
                to={SubjectRoute.to}
                params={{ slug: subject.slug }}
                key={subject.slug}
                className="group flex flex-col gap-1.5 rounded-lg border p-4 transition-colors hover:bg-muted"
              >
                <span className="text-[15px] font-semibold tracking-[-0.01em]">
                  {subject.name}
                </span>
                {subject.summary && (
                  <span className="text-[13px] leading-snug text-muted-foreground">
                    {subject.summary}
                  </span>
                )}
              </Link>
            ))}
        </div>

        {subjects.length > 6 && (
          <div className="mt-1 flex justify-center">
            <Link
              to="/subjects"
              className="mono-micro inline-flex items-center gap-1 rounded-md p-4 tracking-[0.08em] text-muted-foreground uppercase transition-colors hover:bg-muted hover:text-foreground"
            >
              Show all subjects
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </section>

      <Separator className="bg-border" />

      {/* Learn about Bluelearn */}
      <section className="px-8 py-8 lg:px-16">
        <div className="mb-6">
          <p className="font-mono text-[12px] tracking-[0.08em] text-muted-foreground uppercase">
            Learn About Bluelearn
          </p>
        </div>

        <Separator className="mb-4 bg-border" />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {BLUE_CONCEPTS.map((concept) => (
            <Link
              to="/guides/$slug"
              params={{ slug: concept.slug }}
              key={concept.slug}
              className="group flex flex-col gap-2 rounded-lg border p-[18px] transition-colors hover:bg-muted"
            >
              <p className="font-mono text-[11px] font-bold tracking-[0.08em] uppercase">
                {concept.label}
              </p>
              <p className="text-[13px] leading-normal text-muted-foreground">
                {concept.blurb}
              </p>
              <span className="mono-micro mt-auto inline-flex items-center tracking-[0.08em] text-muted-foreground uppercase group-hover:text-brand-bright-blue">
                Read
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
