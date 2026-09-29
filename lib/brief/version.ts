import { createHash } from "node:crypto";
import { isReadyForRecap } from "@/lib/brief/readiness";
import type { TripBrief } from "@/lib/brief/schema";

// JSON.stringify is stable here because every brief goes through
// tripBriefSchema.parse, which emits object keys in schema order.
export function briefVersion(brief: TripBrief): string {
  return createHash("sha256").update(JSON.stringify(brief)).digest("hex").slice(0, 16);
}

export function isReadyToSend(brief: TripBrief, today: Date, approvedVersion: string): boolean {
  return isReadyForRecap(brief, today) && approvedVersion === briefVersion(brief);
}
