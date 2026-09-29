import catalogue from "@/data/destinations.json";

const [first, ...rest] = catalogue.destinations.map((d) => d.id);
if (first === undefined) throw new Error("data/destinations.json has no destinations");

export const DESTINATION_IDS = [first, ...rest] as const;

const labels = new Map(catalogue.destinations.map((d) => [d.id, d.label]));

export function destinationLabel(id: string): string {
  return labels.get(id) ?? id;
}
