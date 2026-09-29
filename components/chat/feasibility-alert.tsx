import { TriangleAlertIcon } from "lucide-react";
import { SourcesList } from "@/components/chat/sources-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { domainOf } from "@/lib/agent/domain";
import type { TripBrief } from "@/lib/brief/schema";

// role="note" rather than the Alert primitive's assertive default: this is static content that
// arrives with the turn, and an assertive region interrupts whatever is being read.
export function FeasibilityAlert({ alert }: { alert: TripBrief["feasibilityAlerts"][number] }) {
  return (
    <Alert role="note" className="border-warning bg-warning-surface text-warning-foreground">
      <TriangleAlertIcon />
      <AlertDescription className="text-warning-foreground">
        {alert.message}
        <SourcesList sources={alert.sources.map((url) => ({ url, domain: domainOf(url) }))} />
      </AlertDescription>
    </Alert>
  );
}
