import { describe, expect, it } from "vitest";
import { loadGuide } from "@/lib/agent/guides";
import { SYSTEM_PROMPT } from "@/lib/agent/system-prompt";

describe("SYSTEM_PROMPT", () => {
  it("contains no guide content", async () => {
    for (const name of ["family_travel", "responsible_travel"] as const) {
      const lines = (await loadGuide(name))
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 25);
      for (const line of lines) expect(SYSTEM_PROMPT).not.toContain(line);
    }
  });

  it("tells the model the propose_quote_request text must not ask for confirmation or repeat the card's buttons", () => {
    const conclureSection = SYSTEM_PROMPT.split("# Conclure")[1] ?? "";
    expect(conclureSection).toContain("propose_quote_request");
    expect(conclureSection).toMatch(/ne (?:demande|redemande) pas de confirmer l['’]envoi/);
    expect(conclureSection).toMatch(/répète pas les boutons/);
  });

  // A live run left "Voici le récapitulatif avant l'envoi de la demande" on screen above the
  // sent "Demande de devis (simulée)" card: the sentence never regenerates, so once the traveller
  // approves, "avant l'envoi" is false. The rule now names what the card is, not when it sends.
  it("tells the model the propose_quote_request text stays true once the card is sent", () => {
    const conclureSection = SYSTEM_PROMPT.split("# Conclure")[1]?.split("\n# ")[0] ?? "";
    expect(conclureSection).toMatch(/jamais le moment de l['’]envoi/);
    expect(conclureSection).toContain("À ne pas écrire");
    expect(conclureSection).toMatch(/À ne pas écrire[\s\S]*avant l['’]envoi/);
  });

  // A live run said "Le brief est complet" to the traveller: "brief" is this prompt's own word
  // for the object, never said in the interface, which reads "votre voyage" and "votre demande".
  it("tells the model never to say “brief” to the traveller", () => {
    const ecriture = SYSTEM_PROMPT.split("# Écriture")[1]?.split("\n# ")[0] ?? "";
    expect(ecriture).toMatch(/«\s*Brief\s*».*jamais.*voyageur/);
    expect(ecriture).toContain("votre voyage");
    expect(ecriture).toContain("votre demande");
  });

  // The family guide is no longer forced by a step setting: loading it is the model's decision, so
  // the rule has to say when — in the turn the family appears, before anything is recommended.
  it("tells the model to load family_travel in the turn the family is mentioned", () => {
    const guides = SYSTEM_PROMPT.split("# Guides")[1]?.split("\n# ")[0] ?? "";
    const [rule] = guides
      .split("\n")
      .filter((line) => line.includes('load_guide("family_travel")'));
    expect(rule).toMatch(/dans le tour même/);
    expect(rule).toMatch(/juste après update_trip_brief/);
    expect(rule).toMatch(/avant toute recherche, fiche ou récapitulatif/);
  });

  // The model skipped update_trip_brief for whole conversations while the rule mandating it sat
  // two sections below the one where the turn's action is chosen. It now opens that section.
  it("puts recording first in the section where the turn's action is chosen", () => {
    const turnSection = SYSTEM_PROMPT.split("# À chaque tour")[1]?.split("\n# ")[0] ?? "";
    const [firstBullet] = turnSection.split("\n").filter((line) => line.startsWith("- "));
    expect(firstBullet).toMatch(/update_trip_brief/);
    expect(firstBullet).toMatch(/avant de chercher/);
    expect(turnSection.indexOf("update_trip_brief")).toBeLessThan(
      turnSection.indexOf("show_destination_card"),
    );
  });

  // The two cards carry « Je retiens … » themselves (destination-card.tsx), so an ask_traveler after them shows the
  // traveller the same question twice, once in the cards and once below them.
  it("tells the model the cards carry the destination choice, so it asks nothing after them", () => {
    const recommander = SYSTEM_PROMPT.split("# Recommander")[1]?.split("\n# ")[0] ?? "";
    expect(recommander).toContain("les fiches portent le choix");
    expect(recommander).not.toContain("ask_traveler");
    expect(recommander).not.toMatch(/laquelle retenir/);
    const turnSection = SYSTEM_PROMPT.split("# À chaque tour")[1]?.split("\n# ")[0] ?? "";
    expect(turnSection).toContain("ask_traveler quand les réponses sont énumérables");
    expect(turnSection).not.toContain("choix entre destinations");
  });

  // A live run recorded « février » as 2026-02 with today at 2026-09-21, seven months in the
  // past: the date was in the prompt and the model got it wrong, so `datesPast` refuses it and
  // the prompt has to say what the year is instead.
  it("tells the model a past period is refused and which year a passed month means", () => {
    const brief = SYSTEM_PROMPT.split("# Brief")[1]?.split("\n# ")[0] ?? "";
    expect(brief).toMatch(/période (?:déjà )?passée/);
    expect(brief).toMatch(/année suivante/);
    expect(brief).toContain("2027-02");
  });

  // The model obeyed « ne posez pas de question » with `ask_traveler` and then asked the same
  // question in prose under the pair, so the heading and the text asked it twice.
  it("stops the prose beside a pair of cards at the comparison, with an example", () => {
    const recommander = SYSTEM_PROMPT.split("# Recommander")[1]?.split("\n# ")[0] ?? "";
    expect(recommander).toMatch(/introduit la comparaison/);
    expect(recommander).toContain("À ne pas écrire");
  });

  // The prompt used to describe French typography in prose while using none of it: the whole
  // repository held no typographic apostrophe and no non-breaking space. A model copies the form
  // it is shown more reliably than the form it is told about, so the prompt has to obey its own
  // table. Tool enum values keep straight quotes on purpose — the model copies them into JSON.
  it("writes the French typography it demands", () => {
    expect(SYSTEM_PROMPT).toContain(" ");
    expect(SYSTEM_PROMPT).toContain("’");
    expect(SYSTEM_PROMPT).not.toMatch(/[A-Za-zÀ-ÿ]'[A-Za-zÀ-ÿ]/);
    expect(SYSTEM_PROMPT).not.toMatch(/«(?! )/);
    expect(SYSTEM_PROMPT).not.toMatch(/(?<! )»/);
    const straightQuoted = [...SYSTEM_PROMPT.matchAll(/"([^"\n]*)"/g)].map((m) => m[1]);
    expect(straightQuoted.filter((q) => !/^[a-z][a-z0-9_]*$/.test(q))).toEqual([]);
  });

  // After two cards the prompt forbids any question, and the conclusion used to allow only budget
  // or wishes: with the four mandatory fields given early, the grouped family question the guide
  // asks for never had a turn. The one question allowed at conclusion may now be that one.
  it("lets the one question at conclusion be the family attention points, still only one", () => {
    const conclure = SYSTEM_PROMPT.split("# Conclure")[1]?.split("\n# ")[0] ?? "";
    const [rule] = conclure.split("\n").filter((line) => line.includes("missingForRecap"));
    expect(rule).toMatch(/au plus une question/);
    expect(rule).toMatch(/budget ou les envies/);
    expect(rule).toMatch(/family_travel est chargé/);
    expect(rule).toMatch(/rythme, hébergement, alimentation/);
    expect(rule).toMatch(/Une seule question dans tous les cas/);
  });

  it("references every tool and the approval reasons", () => {
    for (const name of [
      "ask_traveler",
      "search_web",
      "show_destination_card",
      "load_guide",
      "update_trip_brief",
      "propose_quote_request",
      "modifier",
      "abandon",
    ]) {
      expect(SYSTEM_PROMPT).toContain(name);
    }
  });
});
