"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowUpIcon, TriangleAlertIcon } from "lucide-react";
import { useRef, useState } from "react";
import { StickToBottom } from "use-stick-to-bottom";
import { MessageView } from "@/components/chat/message-view";
import { ProjectPanel, ProjectSheet, RECAP_REQUEST } from "@/components/chat/project-panel";
import { StatusLine } from "@/components/chat/status-line";
import { Welcome } from "@/components/chat/welcome";
import { Alert, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CONVERSATION_TOO_LONG_MESSAGE,
  GENERIC_STREAM_ERROR_MESSAGE,
  isConversationTooLong,
  STREAM_ERROR_MESSAGES,
} from "@/lib/agent/stream-errors";
import type { ChatUIMessage } from "@/lib/agent/types";
import {
  answerPendingQuestions,
  canRequestRecap,
  missingForRecap,
  panelBrief,
  shouldSendAutomatically,
  statusLabel,
} from "@/lib/chat/client-state";
import { usePrefersReducedMotion } from "@/lib/chat/use-reduced-motion";

const transport = new DefaultChatTransport<ChatUIMessage>({ api: "/api/chat" });

export function Chat() {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const {
    messages,
    sendMessage,
    status,
    error,
    regenerate,
    setMessages,
    addToolOutput,
    addToolApprovalResponse,
    clearError,
  } = useChat<ChatUIMessage>({ transport, sendAutomaticallyWhen: shouldSendAutomatically });

  const busy = status === "submitted" || status === "streaming";

  function answer(value: { selected: string[] } | { freeText: string }): boolean {
    const calls = answerPendingQuestions(messages, value);
    if (calls.length === 0) return false;
    focusComposer();
    for (const call of calls) {
      if ("errorText" in call) {
        addToolOutput({
          tool: "ask_traveler",
          toolCallId: call.toolCallId,
          state: "output-error",
          errorText: call.errorText,
        });
      } else {
        addToolOutput({ tool: "ask_traveler", toolCallId: call.toolCallId, output: call.output });
      }
    }
    return true;
  }

  function submitText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    if (!answer({ freeText: trimmed })) sendMessage({ text: trimmed });
    setInput("");
  }

  // The control that hands focus over destroys itself in the same update, and the browser sends
  // focus to <body> the instant it goes. Called before the state change, this moves focus out of
  // the doomed subtree while it is still mounted, so the unmount has nothing left to take.
  function focusComposer() {
    const element = inputRef.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }

  function newProject() {
    focusComposer();
    setMessages([]);
    clearError();
  }

  const panel = {
    brief: panelBrief(messages),
    missing: missingForRecap(messages),
    canRequestRecap: canRequestRecap(messages),
    busy,
    onRequestRecap: () => {
      focusComposer();
      submitText(RECAP_REQUEST);
    },
  };
  const scrollBehavior = usePrefersReducedMotion() ? "instant" : "smooth";

  return (
    <div className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-cols-1 gap-3 px-3 py-3 sm:px-4 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-6 lg:px-8 lg:py-6">
      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl bg-background shadow-sm ring-1 ring-foreground/10">
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-6">
          <h1 className="font-heading text-lg text-brand">Assistant voyage sur mesure</h1>
          <div className="flex items-center gap-2">
            <ProjectSheet {...panel} />
            {messages.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="lg">
                    Nouveau voyage
                  </Button>
                </AlertDialogTrigger>
                {/* A call before the reset cannot work here: the open dialog traps focus and takes
                    it back, then Radix restores it on close to "Nouveau voyage", which the reset
                    has unmounted. On cancel the traveller carries on writing, so the composer is
                    the right target on that path too. */}
                <AlertDialogContent
                  onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    focusComposer();
                  }}
                >
                  <AlertDialogHeader>
                    <AlertDialogTitle>Abandonner ce voyage&nbsp;?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Votre demande de devis en cours sera effacée. Cette action est définitive.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Continuer ce voyage</AlertDialogCancel>
                    <AlertDialogAction onClick={newProject}>Abandonner le voyage</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </header>
        {/* tabIndex sits on Content, not here: the element that actually scrolls is a div
            use-stick-to-bottom renders between the two, and it takes a scrollClassName and
            nothing else — no tabIndex, no aria-*. A focusable child is the only way to let the
            keyboard scroll the transcript. */}
        <StickToBottom
          className="flex-1 overflow-y-auto px-4 sm:px-6"
          resize={scrollBehavior}
          initial={scrollBehavior}
        >
          {/* `relative` is load-bearing, not styling. Tailwind's sr-only is position:absolute
              with no offsets, so an sr-only span with no positioned ancestor is laid out against
              the initial containing block: it leaves the scroller, stretches
              document.scrollHeight past the viewport, and the page itself starts scrolling, which
              takes the header and the composer off screen. Every sr-only span in the transcript —
              the speaker prefixes, the answered-question prefix, the new-tab notices, the status
              line — is contained by this element. */}
          <StickToBottom.Content
            className={cn(
              "relative mx-auto flex w-full max-w-[42rem] flex-col gap-8 py-6",
              messages.length === 0 && "min-h-full justify-center",
            )}
            aria-busy={busy}
            tabIndex={0}
            role="region"
            aria-label="Conversation"
          >
            {messages.length === 0 && <Welcome onPick={submitText} />}
            {messages.map((message) => (
              <MessageView
                key={message.id}
                message={message}
                messages={messages}
                onAnswer={(selected) => answer({ selected })}
                onApproval={(id, approved, reason) => {
                  focusComposer();
                  addToolApprovalResponse({ id, approved, reason });
                }}
                onNewProject={newProject}
                onSubmitText={(text) => {
                  submitText(text);
                  focusComposer();
                }}
              />
            ))}
            <StatusLine status={statusLabel(messages, status)} />
            {error && (
              <Alert variant="destructive" className="border-destructive/40">
                <TriangleAlertIcon />
                <AlertTitle>
                  {isConversationTooLong(error.message)
                    ? CONVERSATION_TOO_LONG_MESSAGE
                    : STREAM_ERROR_MESSAGES.includes(error.message)
                      ? error.message
                      : GENERIC_STREAM_ERROR_MESSAGE}
                </AlertTitle>
                {/* Not AlertAction: it positions the button absolutely over the padding Alert
                    reserves for it, a fixed `has-data-[slot=alert-action]:pr-18` in
                    components/ui/alert.tsx, which a French label overruns and hides the end of
                    the sentence. */}
                <div className="mt-2 group-has-[>svg]/alert:col-start-2">
                  {isConversationTooLong(error.message) ? (
                    <Button size="lg" variant="outline" onClick={newProject}>
                      Nouveau voyage
                    </Button>
                  ) : (
                    <Button size="lg" variant="outline" onClick={() => regenerate()}>
                      Réessayer
                    </Button>
                  )}
                </div>
              </Alert>
            )}
          </StickToBottom.Content>
        </StickToBottom>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitText(input);
          }}
          className="mx-auto flex w-full max-w-[42rem] flex-col border-t border-border px-0 py-3"
        >
          <div className="flex items-end gap-2 rounded-2xl border border-input bg-background p-2 transition-[box-shadow,border-color] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitText(input);
                }
              }}
              placeholder="Décrivez votre envie de voyage…"
              aria-label="Votre message"
              maxLength={2000}
              className="max-h-40 min-h-11 resize-none border-0 bg-transparent px-2 py-2.5 focus-visible:border-0 focus-visible:ring-0"
            />
            <Button
              type="submit"
              size="icon-xl"
              variant="secondary"
              className="rounded-full"
              aria-label="Envoyer le message"
              disabled={busy || input.trim().length === 0}
            >
              <ArrowUpIcon />
            </Button>
          </div>
        </form>
      </main>
      <ProjectPanel {...panel} />
    </div>
  );
}
