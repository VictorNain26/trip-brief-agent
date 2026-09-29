import { ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { TripBrief } from "@/lib/brief/schema";

type Props = { brief: TripBrief; agencyText: string; onNewProject: () => void };

export function SentBrief({ brief, agencyText, onNewProject }: Props) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <h3 className="font-heading text-xl text-brand">Demande de devis (simulée)</h3>
        </CardTitle>
        <p className="text-sm">
          En conditions réelles, une agence locale de la destination reprendrait cette demande pour
          vous répondre. Ici, rien n’a été envoyé.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Ce que l’agence locale recevrait
          </p>
          <pre className="rounded-md bg-muted p-3 font-sans text-sm whitespace-pre-wrap">
            {agencyText}
          </pre>
        </div>
        <Collapsible className="group/collapsible">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="lg"
              className="gap-1 px-0 hover:bg-transparent hover:underline"
            >
              <ChevronRightIcon className="transition-transform group-data-[state=open]/collapsible:rotate-90" />
              Détail technique (JSON)
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre
              tabIndex={0}
              role="region"
              aria-label="Détail technique de la demande, au format JSON"
              className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {JSON.stringify(brief, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
      <CardFooter>
        <Button onClick={onNewProject}>Nouveau voyage</Button>
      </CardFooter>
    </Card>
  );
}
