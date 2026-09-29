import type { ReactNode } from "react";
import { Streamdown } from "streamdown";
import { ChoiceCard } from "@/components/chat/choice-card";
import { PhotoStrip } from "@/components/chat/commons-photo";
import { DestinationCards } from "@/components/chat/destination-card";
import { FeasibilityAlert } from "@/components/chat/feasibility-alert";
import { RecapCard } from "@/components/chat/recap-card";
import { SentBrief } from "@/components/chat/sent-brief";
import { SourcesDisclosure } from "@/components/chat/sources-list";
import type { ChatUIMessage } from "@/lib/agent/types";
import {
  briefForVersion,
  newFeasibilityAlerts,
  pendingApproval,
  searchDisplay,
} from "@/lib/chat/client-state";

type Props = {
  message: ChatUIMessage;
  messages: ChatUIMessage[];
  onAnswer: (selected: string[]) => void;
  onApproval: (approvalId: string, approved: boolean, reason?: string) => void;
  onNewProject: () => void;
  onSubmitText: (text: string) => void;
};

const SEARCH_UNAVAILABLE = "Recherche indisponible pour le moment.";

function cardOf(part: ChatUIMessage["parts"][number]) {
  return part.type === "tool-show_destination_card" &&
    part.state === "output-available" &&
    part.output.ok
    ? part.output.card
    : null;
}

export function MessageView({
  message,
  messages,
  onAnswer,
  onApproval,
  onNewProject,
  onSubmitText,
}: Props) {
  const isUser = message.role === "user";

  function renderPart(part: ChatUIMessage["parts"][number], key: string) {
    switch (part.type) {
      case "text":
        return isUser ? (
          <p key={key} className="rounded-xl bg-accent px-3.5 py-2.5 text-accent-foreground">
            {part.text}
          </p>
        ) : (
          <div key={key} className="max-w-[65ch]">
            <Streamdown disallowedElements={["img"]}>{part.text}</Streamdown>
          </div>
        );
      case "tool-ask_traveler":
        return <ChoiceCard key={key} part={part} onAnswer={onAnswer} />;
      case "tool-search_web": {
        const display = searchDisplay(part);
        if (display.kind === "none") return null;
        if (display.kind === "failed") {
          return (
            <p key={key} className="text-sm text-muted-foreground">
              {SEARCH_UNAVAILABLE}
            </p>
          );
        }
        return (
          <SourcesDisclosure
            key={key}
            sources={display.sources}
            subject={display.query}
            className="max-w-[65ch]"
          />
        );
      }
      // Laid out by the grouping pass below, which needs the whole run of consecutive cards at
      // once to put them side by side.
      case "tool-show_destination_card":
        return null;
      case "tool-show_photos": {
        if (part.state !== "output-available" || !part.output.ok) return null;
        if (part.output.photos.length === 0) return null;
        return <PhotoStrip key={key} photos={part.output.photos} subject={part.input.query} />;
      }
      case "tool-update_trip_brief": {
        if (part.state !== "output-available" || !part.output.ok) return null;
        const alerts = newFeasibilityAlerts(messages, part.toolCallId);
        if (alerts.length === 0) return null;
        return (
          <div key={key} className="flex flex-col gap-2">
            {alerts.map((alert, alertIndex) => (
              <FeasibilityAlert key={`${alertIndex}-${alert.message}`} alert={alert} />
            ))}
          </div>
        );
      }
      case "tool-propose_quote_request": {
        if (part.state === "approval-requested") {
          const brief = briefForVersion(messages, part.input.briefVersion);
          if (!brief) {
            return (
              <p key={key} className="text-sm text-muted-foreground">
                Le récapitulatif n’a pas pu s’afficher. Demandez-le à nouveau dans le message
                ci-dessous.
              </p>
            );
          }
          const answerable = pendingApproval(messages)?.toolCallId === part.toolCallId;
          return (
            <RecapCard
              key={key}
              brief={brief}
              onRespond={
                answerable
                  ? (approved, reason) => onApproval(part.approval.id, approved, reason)
                  : undefined
              }
            />
          );
        }
        if (part.state === "output-available") {
          return part.output.ok ? (
            <SentBrief
              key={key}
              brief={part.output.brief}
              agencyText={part.output.agencyText}
              onNewProject={onNewProject}
            />
          ) : (
            <p key={key} className="text-sm text-muted-foreground">
              La demande n’a pas été envoyée. Vos informations sont conservées.
            </p>
          );
        }
        return null;
      }
      default:
        return null;
    }
  }

  const nodes = message.parts.map((part, index) => renderPart(part, `${message.id}-${index}`));
  const cards = message.parts.map(cardOf);
  const rendered: ReactNode[] = [];
  for (let index = 0; index < nodes.length;) {
    const first = cards[index];
    if (!first) {
      if (nodes[index] !== null) rendered.push(nodes[index]);
      index += 1;
      continue;
    }
    // A run is the consecutive cards of one turn, tolerating only parts that render nothing
    // between them: anything visible must keep the position the transcript gives it.
    const run = [first];
    let cursor = index + 1;
    let after = index + 1;
    while (cursor < nodes.length) {
      const next = cards[cursor];
      if (next) {
        run.push(next);
        cursor += 1;
        after = cursor;
        continue;
      }
      if (nodes[cursor] !== null) break;
      cursor += 1;
    }
    rendered.push(
      <DestinationCards key={`${message.id}-${index}-cards`} cards={run} onChoose={onSubmitText} />,
    );
    index = after;
  }
  if (rendered.length === 0) return null;

  return (
    <div className={isUser ? "ml-auto max-w-[85%]" : "mr-auto flex w-full min-w-0 flex-col gap-3"}>
      <span className="sr-only">{isUser ? "Vous" : "Assistant"}&nbsp;: </span>
      {rendered}
    </div>
  );
}
