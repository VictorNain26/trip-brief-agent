import { BriefFields, MANDATORY } from "@/components/chat/brief-fields";
import { FeasibilityAlert } from "@/components/chat/feasibility-alert";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { MISSING_LABELS } from "@/lib/brief/labels";
import { blockedFields, type MissingItem } from "@/lib/brief/readiness";
import type { TripBrief } from "@/lib/brief/schema";

type Props = {
  brief: TripBrief | undefined;
  missing: MissingItem[];
  canRequestRecap: boolean;
  busy: boolean;
  onRequestRecap: () => void;
};

const RECAP_REQUEST = "Montrez-moi le récapitulatif de ma demande.";

function progress(brief: TripBrief | undefined, missing: MissingItem[]) {
  const blocked = blockedFields(missing);
  const done = brief ? MANDATORY.filter((field) => brief[field] && !blocked.has(field)).length : 0;
  const summary =
    brief && missing.length > 0
      ? `Il manque encore : ${missing.map((item) => MISSING_LABELS[item]).join(", ")}.`
      : undefined;
  return {
    done,
    count: brief ? `${done}/${MANDATORY.length}` : undefined,
    sentence: brief
      ? "Les cinq informations nécessaires à la demande de devis sont réunies."
      : "Je note ici ce que vous me dites. Destination, période, durée, voyageurs, budget : les cinq informations nécessaires à la demande de devis.",
    summary,
  };
}

function Progress({ done }: { done: number }) {
  return (
    <div className="mt-3 flex gap-1" aria-hidden="true">
      {MANDATORY.map((field, index) => (
        <span
          key={field}
          className={`h-1 flex-1 rounded-full ${index < done ? "bg-secondary" : "bg-input"}`}
        />
      ))}
    </div>
  );
}

function PanelHeader({ done, sentence, summary }: ReturnType<typeof progress>) {
  return (
    <>
      <p className="mt-1 text-xs text-muted-foreground">{summary ?? sentence}</p>
      <Progress done={done} />
    </>
  );
}

function PanelBody({
  brief,
  canRequestRecap,
  busy,
  onRequestRecap,
  closeOnRequest = false,
}: Props & { closeOnRequest?: boolean }) {
  const recapButton = (
    <Button size="lg" className="w-full" disabled={busy} onClick={onRequestRecap}>
      Voir le récapitulatif
    </Button>
  );
  return (
    <div className="flex flex-col gap-4">
      <BriefFields brief={brief} />
      {brief?.feasibilityAlerts.map((alert, index) => (
        <FeasibilityAlert key={`${index}-${alert.message}`} alert={alert} />
      ))}
      {canRequestRecap &&
        (closeOnRequest ? <SheetClose asChild>{recapButton}</SheetClose> : recapButton)}
      {brief && (
        <p className="text-xs text-muted-foreground">
          Une information est inexacte&nbsp;? Dites-le simplement dans la conversation.
        </p>
      )}
    </div>
  );
}

export function ProjectPanel(props: Props) {
  const state = progress(props.brief, props.missing);
  return (
    <aside
      className="hidden max-h-full min-h-0 flex-col self-start overflow-hidden rounded-2xl bg-background shadow-sm ring-1 ring-foreground/10 lg:flex"
      aria-labelledby="panel-title"
    >
      <header className="border-b border-border px-5 py-3">
        <h2 id="panel-title" className="font-heading text-lg text-brand">
          Votre voyage
        </h2>
        <PanelHeader {...state} />
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
        <PanelBody {...props} />
      </div>
    </aside>
  );
}

export function ProjectSheet(props: Props) {
  const state = progress(props.brief, props.missing);
  const trigger = state.count ? `Votre voyage ${state.count}` : "Votre voyage";
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="xl"
          className="lg:hidden"
          aria-label={`${trigger}${state.summary ? `. ${state.summary}` : ""}`}
        >
          {trigger}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        className="max-h-[85dvh] rounded-t-2xl motion-reduce:animate-none motion-reduce:transition-none"
      >
        <SheetHeader>
          <SheetTitle className="text-lg text-brand">Votre voyage</SheetTitle>
          <PanelHeader {...state} />
        </SheetHeader>
        <div className="overflow-y-auto px-4 pb-4">
          <PanelBody {...props} closeOnRequest />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export { RECAP_REQUEST };
