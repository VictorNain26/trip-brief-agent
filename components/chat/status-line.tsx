import type { ChatStatusMessage } from "@/lib/chat/client-state";

export function StatusLine({ status }: { status: ChatStatusMessage | undefined }) {
  return (
    <p role="status" className="min-h-5 text-sm text-muted-foreground">
      {status && <span className={status.visible ? undefined : "sr-only"}>{status.text}</span>}
    </p>
  );
}
