import { BriefFields } from "@/components/chat/brief-fields";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { STATUS_LABELS } from "@/lib/brief/labels";
import type { TripBrief } from "@/lib/brief/schema";

type Props = {
  brief: TripBrief;
  onRespond: (approved: boolean, reason?: "modifier" | "abandon") => void;
};

export function RecapCard({ brief, onRespond }: Props) {
  const hasInferred = Object.values(brief).some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      "status" in entry &&
      entry.status === "inferred",
  );
  return (
    <Card className="w-full ring-2 ring-secondary">
      <CardHeader>
        <CardTitle>
          <h3 className="font-heading text-xl text-brand">Récapitulatif de votre demande</h3>
        </CardTitle>
        <CardDescription>
          {hasInferred
            ? `Les éléments marqués « ${STATUS_LABELS.inferred} » n’ont pas été confirmés. Vérifiez-les : envoyer la demande confirme la destination, la période, la durée et les voyageurs.`
            : "Vérifiez les informations avant d’envoyer."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="text-base">
          <BriefFields brief={brief} />
        </div>
        {brief.feasibilityAlerts.length > 0 && (
          <div className="text-sm">
            <p className="font-medium">Points à vérifier avec l’agence</p>
            <ul className="list-disc pl-5">
              {brief.feasibilityAlerts.map((alert, index) => (
                <li key={`${index}-${alert.message}`}>{alert.message}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Prototype&nbsp;: l’envoi est simulé.</p>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button onClick={() => onRespond(true)}>Envoyer</Button>
        <Button variant="outline" onClick={() => onRespond(false, "modifier")}>
          Modifier
        </Button>
        <Button variant="ghost" onClick={() => onRespond(false, "abandon")}>
          Abandonner
        </Button>
      </CardFooter>
    </Card>
  );
}
