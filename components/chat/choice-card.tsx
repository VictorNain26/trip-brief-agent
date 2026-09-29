import { useId, useState } from "react";
import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ToolPart } from "@/lib/agent/types";

type Props = {
  part: ToolPart<"ask_traveler">;
  onAnswer: (selected: string[]) => void;
};

const ROW_CLASS =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-input p-3 leading-normal font-normal transition-colors hover:bg-muted has-data-checked:border-secondary has-data-checked:bg-accent";

// The agent's answer that precedes the question, written as its own prose.
function Intro({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="max-w-[65ch]">
      <Streamdown disallowedElements={["img"]}>{text}</Streamdown>
    </div>
  );
}

export function ChoiceCard(props: Props) {
  const intro = props.part.input?.intro;
  return (
    <div className="flex flex-col gap-3">
      <Intro text={intro} />
      <Choice {...props} />
    </div>
  );
}

function Choice({ part, onAnswer }: Props) {
  const id = useId();
  const [selected, setSelected] = useState<string[]>([]);
  if (part.state === "input-streaming" || !part.input) return null;
  const { question, options, multiSelect } = part.input;

  if (part.state === "output-available") {
    const output = part.output;
    const answer =
      "freeText" in output
        ? output.freeText
        : options
            .filter((option) => output.selected.includes(option.id))
            .map((option) => option.label)
            .join(", ");
    return (
      <div className="flex flex-col items-end gap-1">
        <p className="text-xs text-muted-foreground">{question}</p>
        <p className="rounded-xl bg-accent px-3.5 py-2.5 text-accent-foreground">
          <span className="sr-only">Votre réponse&nbsp;: </span>
          {answer}
        </p>
      </div>
    );
  }
  if (part.state !== "input-available") return null;

  const toggle = (optionId: string, checked: boolean) =>
    setSelected((current) =>
      checked ? [...current, optionId] : current.filter((value) => value !== optionId),
    );

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <h3 id={`${id}-title`} className="font-sans text-base font-medium">
            {question}
          </h3>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {multiSelect ? (
          <div role="group" aria-labelledby={`${id}-title`} className="flex flex-col gap-2">
            {options.map((option) => (
              <Label key={option.id} htmlFor={`${id}-${option.id}`} className={ROW_CLASS}>
                <Checkbox
                  id={`${id}-${option.id}`}
                  className="mt-0.5 data-checked:border-secondary"
                  checked={selected.includes(option.id)}
                  onCheckedChange={(checked) => toggle(option.id, checked === true)}
                />
                <span className="flex flex-col gap-0.5">
                  <span>{option.label}</span>
                  {option.description && (
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  )}
                </span>
              </Label>
            ))}
          </div>
        ) : (
          <RadioGroup
            aria-labelledby={`${id}-title`}
            value={selected[0] ?? ""}
            onValueChange={(value) => setSelected([value])}
          >
            {options.map((option) => (
              <Label key={option.id} htmlFor={`${id}-${option.id}`} className={ROW_CLASS}>
                <RadioGroupItem
                  id={`${id}-${option.id}`}
                  value={option.id}
                  className="mt-0.5 data-checked:border-secondary"
                />
                <span className="flex flex-col gap-0.5">
                  <span>{option.label}</span>
                  {option.description && (
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  )}
                </span>
              </Label>
            ))}
          </RadioGroup>
        )}
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-2">
        <Button disabled={selected.length === 0} onClick={() => onAnswer(selected)}>
          Valider
        </Button>
        <p className="text-xs text-muted-foreground">
          Vous pouvez aussi répondre avec vos propres mots.
        </p>
      </CardFooter>
    </Card>
  );
}
