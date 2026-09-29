import { Button } from "@/components/ui/button";

const SUGGESTIONS = [
  {
    text: "Je ne sais pas encore où partir",
    hint: "Quelques questions, et je vous propose des destinations",
  },
  { text: "J’ai une destination en tête", hint: "Je vérifie la saison, la durée et le budget" },
  { text: "J’hésite entre plusieurs destinations", hint: "Je les compare, sources à l’appui" },
  { text: "Je pars en famille", hint: "Je note l’âge des enfants et j’adapte le rythme" },
];

export function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <section className="mx-auto flex max-w-xl flex-col gap-6 text-center">
      <div className="flex flex-col gap-3">
        <h2 className="font-heading text-3xl text-brand sm:text-4xl">
          Une envie de s’évader&nbsp;?
        </h2>
        <p className="mx-auto max-w-[46ch] text-base text-muted-foreground">
          Décrivez-moi votre envie, même vague. J’en fais la demande de voyage sur mesure qu’une
          agence locale recevra.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => (
          <Button
            key={suggestion.text}
            variant="outline"
            className="h-auto min-h-11 flex-col items-start gap-0.5 whitespace-normal px-4 py-3 text-left"
            onClick={() => onPick(suggestion.text)}
          >
            <span className="text-sm font-medium">{suggestion.text}</span>
            <span className="text-xs font-normal text-muted-foreground">{suggestion.hint}</span>
          </Button>
        ))}
      </div>
    </section>
  );
}
