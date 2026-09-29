import { ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { Source } from "@/lib/chat/client-state";
import { cn } from "@/lib/utils";

export function SourcesList({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null;
  return (
    <ul className="flex flex-col text-sm text-muted-foreground">
      {sources.map((source, index) => (
        <li key={`${index}-${source.url}`} className="flex min-h-11 items-center">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="py-1 underline underline-offset-2 hover:text-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {source.title ?? source.domain}
            {source.title !== undefined && <span className="ml-1">({source.domain})</span>}
            <span className="sr-only"> (nouvel onglet)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function SourcesDisclosure({
  sources,
  subject,
  className,
}: {
  sources: Source[];
  subject?: string;
  className?: string;
}) {
  const many = sources.length > 1;
  return (
    <Collapsible className={cn("group/sources", className)}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="lg"
          className="max-w-full gap-1 px-0 hover:bg-transparent hover:underline"
        >
          <ChevronRightIcon className="transition-transform group-data-[state=open]/sources:rotate-90 motion-reduce:transition-none" />
          {/* A search query runs to 200 characters and the button never wraps: clipping the label
              keeps the trigger on one line, and the accessible name still carries the whole thing. */}
          <span className="truncate">
            {sources.length} source{many ? "s" : ""} consultée{many ? "s" : ""}
            {subject && ` · ${subject}`}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SourcesList sources={sources} />
      </CollapsibleContent>
    </Collapsible>
  );
}
