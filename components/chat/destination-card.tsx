import { Fragment, useId } from "react";
import { CheckIcon, ChevronRightIcon, TriangleAlertIcon } from "lucide-react";
import { CommonsPhoto } from "@/components/chat/commons-photo";
import { SourcesDisclosure } from "@/components/chat/sources-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { domainOf } from "@/lib/agent/domain";
import type { DestinationCard as Destination } from "@/lib/agent/tools";

const SPAN = { lat: 2.2, lng: 2.2 * (16 / 9) };

const BLOCK = "px-(--card-spacing)";
const TERM = "text-xs font-medium tracking-wide text-muted-foreground";
const NO_ALERT = "Pas de point d’attention relevé.";

function embedUrl({ lat, lng }: Destination["coordinates"]) {
  const bbox = [lng - SPAN.lng, lat - SPAN.lat, lng + SPAN.lng, lat + SPAN.lat].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}

function spineRows(card: Destination) {
  return [
    { term: "Quand partir", value: card.bestPeriod },
    { term: "Vol depuis Paris", value: card.flightTimeFromParis },
    { term: "Région", value: card.region },
  ];
}

export function DestinationCard({
  card,
  variant = "solo",
  onChoose,
}: {
  card: Destination;
  variant?: "solo" | "compare";
  onChoose?: (text: string) => void;
}) {
  const compare = variant === "compare";
  const keep = `Je retiens ${card.label}`;
  // Under the group's own « Laquelle retenez-vous ? » heading, so the comparison form sits one
  // level down and "À savoir" follows it.
  const Heading = compare ? "h4" : "h3";
  const AlertHeading = compare ? "h5" : "h4";
  return (
    <Card
      className={
        compare
          ? "grid gap-3 @min-[40rem]:row-span-8 @min-[40rem]:grid-rows-subgrid"
          : "w-full gap-3"
      }
    >
      <Heading
        className={`${BLOCK} font-heading leading-snug text-brand ${compare ? "text-lg" : "text-xl"}`}
      >
        {card.label}
      </Heading>
      {/* Solo only: in the comparison, a photo per column would push the shared fact rows below
          the fold, and a card without one would break their alignment. */}
      {!compare && card.photo && (
        <div className={BLOCK}>
          <CommonsPhoto photo={card.photo} alt={`Paysage : ${card.label}`} />
        </div>
      )}
      {compare ? (
        <dl className={`${BLOCK} grid grid-cols-[auto_1fr] gap-x-2 gap-y-1`}>
          {spineRows(card).map(({ term, value }) => (
            <Fragment key={term}>
              <dt className={TERM}>{term}</dt>
              <dd className="font-medium">{value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <dl className={`${BLOCK} flex flex-wrap items-baseline gap-x-4 gap-y-1`}>
          {spineRows(card).map(({ term, value }) => (
            <div key={term} className="flex items-baseline gap-1.5">
              <dt className={TERM}>{term}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className={`${BLOCK} max-w-[68ch]`}>{card.why}</p>
      <CardContent>
        <ul className="list-disc space-y-1 pl-5 marker:text-brand">
          {card.highlights.map((highlight, index) => (
            <li key={`${index}-${highlight}`}>{highlight}</li>
          ))}
        </ul>
      </CardContent>
      {/* One block, so both compared cards keep the same row count whether the trip is a family's. */}
      <dl className={`${BLOCK} max-w-[68ch] space-y-2`}>
        {card.forChildren && (
          <div>
            <dt className={TERM}>Pour les enfants</dt>
            <dd>{card.forChildren}</dd>
          </div>
        )}
        <div>
          <dt className={TERM}>Voyager mieux</dt>
          <dd>{card.travelBetter}</dd>
        </div>
      </dl>
      <section className={`${BLOCK} border-t border-border pt-3 text-warning-foreground`}>
        <AlertHeading className="flex items-center gap-1.5 font-medium">
          <TriangleAlertIcon className="size-4" />À savoir
        </AlertHeading>
        <ul role="note" className="list-disc pl-5">
          {card.alerts.length === 0 ? (
            <li className="text-muted-foreground">{NO_ALERT}</li>
          ) : (
            card.alerts.map((alert, index) => <li key={`${index}-${alert}`}>{alert}</li>)
          )}
        </ul>
      </section>
      <CardContent className="flex flex-col border-t border-border pt-3">
        <SourcesDisclosure
          subject={card.label}
          sources={card.sources.map((source) => ({
            title: source.title,
            url: source.url,
            domain: domainOf(source.url),
          }))}
        />
        {/* Closed by default: the map was half the card's height, and the content stays unmounted
            until it opens, so no third-party tile is fetched unless the traveller asks for one. */}
        {!compare && (
          <Collapsible className="group/map">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="lg"
                className="gap-1 self-start px-0 hover:bg-transparent hover:underline"
              >
                <ChevronRightIcon className="transition-transform group-data-[state=open]/map:rotate-90 motion-reduce:transition-none" />
                Situer sur la carte
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <iframe
                title={`Carte : ${card.label}`}
                src={embedUrl(card.coordinates)}
                className="aspect-[16/9] w-full rounded-md border-0"
                loading="lazy"
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
              />
              <p className="text-right text-xs text-muted-foreground">
                ©{" "}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  les contributeurs OpenStreetMap
                  <span className="sr-only"> (nouvel onglet)</span>
                </a>
              </p>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
      {compare && onChoose && (
        <CardFooter>
          {/* Wraps instead of the Button's own nowrap: « Je retiens Saint Martin (Antilles
              françaises) » is twice the 314px column, and the card clips its overflow. Both
              footers are one subgrid row, so a label that takes two lines grows both columns. */}
          <Button
            variant="default"
            size="xl"
            className="h-auto min-h-11 whitespace-normal text-left"
            onClick={() => onChoose(keep)}
          >
            <CheckIcon />
            {keep}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

export function DestinationCards({
  cards,
  onChoose,
}: {
  cards: Destination[];
  onChoose: (text: string) => void;
}) {
  const id = useId();
  if (cards.length < 2) return <DestinationCard card={cards[0]} />;
  return (
    <div className="@container flex flex-col gap-3">
      <h3 id={id} className="font-heading text-lg text-brand">
        Laquelle retenez-vous&nbsp;?
      </h3>
      <ul aria-labelledby={id} className="grid gap-3 @min-[40rem]:grid-cols-2">
        {cards.map((card, index) => (
          <li
            key={`${index}-${card.destinationId}`}
            className="grid @min-[40rem]:row-span-8 @min-[40rem]:grid-rows-subgrid"
          >
            <DestinationCard card={card} variant="compare" onChoose={onChoose} />
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Vous pouvez aussi répondre avec vos propres mots.
      </p>
    </div>
  );
}
