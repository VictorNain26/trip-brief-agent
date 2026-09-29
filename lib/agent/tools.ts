import { tool } from "ai";
import { z } from "zod";
import { toolErrorSchema, toolFailure, type ToolError } from "@/lib/agent/errors";
import { GUIDE_NAMES, loadGuide, type GuideName } from "@/lib/agent/guides";
import { searchOutcomeSchema, type SearchFn } from "@/lib/agent/search";
import {
  applyPatch,
  applySend,
  familyGuideMissing,
  healthSearchMissing,
  invalidSources,
  recordSearch,
  sendDenial,
  type ConversationState,
  type UpdateTripBriefOutput,
} from "@/lib/agent/state";
import { renderAgencyText } from "@/lib/brief/agency-text";
import { destinationIdSchema, tripBriefPatchSchema, tripBriefSchema } from "@/lib/brief/schema";
import { destinationLabel } from "@/lib/catalogue";

type ToolDeps = { state: ConversationState; search: SearchFn; today: Date };

// `renderAgencyText` over a brief maxed out on every bounded string and array measures 7 055
// characters, so this caps a forged value without ever cutting a real one.
const MAX_AGENCY_TEXT_LENGTH = 8000;

// Declared explicitly (rather than inferred from `execute`'s single return path) so that
// lib/agent/conversation.ts can rewrite a forged historical output with a real `toolFailure`
// when replaying a duplicated guide load, without widening what the live tool ever returns.
type LoadGuideOutput =
  { ok: true; guide: GuideName; content: string } | { ok: false; error: ToolError };

export const loadGuideInputSchema = z.object({ guide: z.enum(GUIDE_NAMES) });

export const destinationCardInputSchema = z.object({
  destinationId: destinationIdSchema,
  region: z.string().max(80),
  why: z.string().min(10).max(280),
  bestPeriod: z.string().max(80),
  highlights: z.array(z.string().max(100)).min(1).max(3),
  alerts: z.array(z.string().max(200)).max(3),
  sources: z
    .array(z.object({ title: z.string().max(160), url: z.httpUrl() }))
    .min(1)
    .max(5),
  coordinates: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  flightTimeFromParis: z.string().max(40),
});

const destinationCardOutputSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    card: z.strictObject({
      ...destinationCardInputSchema.shape,
      label: z.string().max(80),
    }),
  }),
  z.strictObject({ ok: z.literal(false), error: toolErrorSchema }),
]);

export type DestinationCard = z.infer<typeof destinationCardInputSchema> & { label: string };

type DestinationCardInput = z.infer<typeof destinationCardInputSchema>;
type DestinationCardOutput = z.infer<typeof destinationCardOutputSchema>;

// `validateUIMessages` throws away the value it parses, so a client-sent card input still carries
// whatever the schema ignored, nested keys included. Naming every field is what keeps an undeclared
// one out of the card and out of the tool call `convertToModelMessages` replays.
export function destinationCardFields(card: DestinationCardInput): DestinationCardInput {
  return {
    destinationId: card.destinationId,
    region: card.region,
    why: card.why,
    bestPeriod: card.bestPeriod,
    highlights: card.highlights,
    alerts: card.alerts,
    sources: card.sources.map(({ title, url }) => ({ title, url })),
    coordinates: { lat: card.coordinates.lat, lng: card.coordinates.lng },
    flightTimeFromParis: card.flightTimeFromParis,
  };
}

// One builder for the card, shared by the live tool and by the replay of a client-sent history,
// so the guide prerequisites and the source provenance cannot hold on one path and not the other.
export function buildDestinationCard(
  state: ConversationState,
  card: DestinationCardInput,
): DestinationCardOutput {
  if (familyGuideMissing(state)) {
    return toolFailure("business", "Chargez d'abord le guide family_travel avec load_guide.");
  }
  if (!state.loadedGuides.has("responsible_travel")) {
    return toolFailure("business", "Chargez d'abord le guide responsible_travel avec load_guide.");
  }
  const invalid = invalidSources(
    state,
    card.sources.map((source) => source.url),
  );
  if (invalid.length > 0) {
    return toolFailure(
      "validation",
      `Sources invalides (doivent provenir de search_web) : ${invalid.join(", ")}.`,
    );
  }
  if (healthSearchMissing(state, card.destinationId)) {
    const label = destinationLabel(card.destinationId);
    return toolFailure(
      "business",
      `Voyage en famille : avant la fiche ${label}, lancez search_web avec topic "health_formalities" et une requête qui nomme « ${label} » (accès aux soins, qualité de l’eau, paludisme, vaccins), puis rappelez show_destination_card.`,
    );
  }
  return {
    ok: true,
    card: { ...destinationCardFields(card), label: destinationLabel(card.destinationId) },
  };
}

// Shared by the tool and by the turn that executes an approved send without calling the model
// (lib/agent/chat.ts), so the gate and the brief promotion cannot differ between the two.
export function sendQuoteRequest(state: ConversationState, today: Date, approvedVersion: string) {
  const denial = sendDenial(state, today, approvedVersion);
  if (denial) return toolFailure("business", denial);
  const brief = applySend(state);
  return { ok: true as const, brief, agencyText: renderAgencyText(brief, today) };
}

export function createTools({ state, search, today }: ToolDeps) {
  return {
    ask_traveler: tool({
      description: [
        "Affiche au voyageur une question à choix (boutons radio ou cases à cocher) et attend sa réponse.",
        "À utiliser quand les réponses possibles sont énumérables : type de voyageurs, mois, durée, rythme, avancement de la réflexion.",
        "Ne pas utiliser pour les envies ou l'âge des enfants (question ouverte en texte).",
        "Une seule question par étape. Le voyageur peut toujours répondre en texte libre.",
        "Exemple : question 'Combien de temps souhaitez-vous partir ?', options [{id:'1w',label:'1 semaine'},{id:'2w',label:'2 semaines'}], multiSelect:false.",
        "Réponse : { selected: [ids] } ou { freeText }.",
      ].join(" "),
      inputSchema: z.object({
        question: z.string().min(3).max(200),
        options: z
          .array(
            z.object({
              id: z.string().min(1).max(40),
              label: z.string().min(1).max(80),
              description: z.string().max(140).optional(),
            }),
          )
          .min(2)
          .max(6),
        multiSelect: z.boolean(),
      }),
      outputSchema: z.union([
        z.object({ selected: z.array(z.string()).min(1) }),
        z.object({ freeText: z.string().min(1).max(2000) }),
      ]),
    }),

    search_web: tool({
      description: [
        "Recherche web (résultats limités à 5, avec URL et domaine).",
        "À utiliser dès qu'une réponse dépend de faits : saisonnalité, climat, faisabilité, actualité, formalités, santé.",
        "topic 'health_formalities' pour santé, vaccins, paludisme, visas : résultats limités aux sources officielles.",
        "Ne pas utiliser pour une préférence subjective du voyageur (déjà connue via la conversation).",
        "Une liste vide signifie qu'aucune source n'a été trouvée ; une erreur transient signifie que la recherche est indisponible (réessayer au plus une fois).",
      ].join(" "),
      inputSchema: z.object({
        query: z.string().min(3).max(200),
        topic: z.enum(["general", "health_formalities"]),
      }),
      outputSchema: searchOutcomeSchema,
      execute: async ({ query, topic }) => {
        const outcome = await search(query, topic);
        recordSearch(state, { query, topic }, outcome);
        return outcome;
      },
    }),

    show_destination_card: tool({
      description: [
        "Affiche une fiche destination illustrée (pourquoi, meilleure période, points forts, alertes, sources, carte) dans la conversation.",
        "destinationId doit être un identifiant du catalogue (code pays ISO 3166-1 alpha-2, par exemple « VN » pour le Viêt Nam).",
        "region, bestPeriod et flightTimeFromParis sont obligatoires et tiennent chacun sur une ligne, par exemple « Afrique de l'Ouest », « de novembre à mai », « 6 h 30 » : deux fiches du même tour s'alignent sur ces trois lignes.",
        "Prérequis : load_guide('responsible_travel') chargé, et load_guide('family_travel') si le voyage est en famille.",
        "En famille, aussi : un search_web avec topic 'health_formalities' dont la requête nomme la destination, par exemple « paludisme vaccins Cap Vert enfants ».",
        "Chaque source doit être une URL renvoyée par search_web dans cette conversation.",
        "Ne pas utiliser pour une destination hors catalogue : expliquer qu'aucune agence ne la couvre et proposer des alternatives du catalogue.",
      ].join(" "),
      inputSchema: destinationCardInputSchema,
      outputSchema: destinationCardOutputSchema,
      execute: async (card) => buildDestinationCard(state, card),
    }),

    load_guide: tool({
      description: [
        "Charge un guide d'instructions et le renvoie.",
        "'family_travel' : dès que des enfants ou un voyage en famille sont mentionnés, dans ce même tour, juste après update_trip_brief et avant toute recherche, fiche ou récapitulatif.",
        "'responsible_travel' : avant de recommander une destination, ou quand le voyageur veut éviter la foule, sortir des sentiers battus ou voyager de façon plus responsable.",
        "Un guide déjà chargé reste valable pour toute la conversation : ne pas le recharger.",
      ].join(" "),
      inputSchema: loadGuideInputSchema,
      execute: async ({ guide }): Promise<LoadGuideOutput> => {
        state.loadedGuides.add(guide);
        return { ok: true as const, guide, content: await loadGuide(guide) };
      },
    }),

    update_trip_brief: tool({
      description: [
        "Met à jour le brief de voyage avec les informations apprises (mise à jour partielle).",
        "status 'confirmed' si le voyageur l'a dit explicitement, 'inferred' si vous le déduisez ; evidence = ses mots.",
        "Dates : precision 'exact' (AAAA-MM-JJ), 'month' (AAAA-MM, plage possible avec end) ou 'season'.",
        "partyType 'family' signifie voyager avec des mineurs : renseignez chaque enfant avec son âge. Entre adultes, utilisez 'couple', 'friends' ou 'group'.",
        "Budget : par personne, hors vols internationaux ; convertir un total et le marquer 'inferred'. Si le voyageur préfère en parler avec l'agence : declined: true, sans montant, avec ses mots en evidence.",
        "Une correction explicite du voyageur ('finalement', 'plutôt') : ajouter le champ dans resolves.",
        "null efface un champ ; une liste remplace la précédente.",
        "Les sources d’une alerte de faisabilité doivent être des URL renvoyées par search_web dans cette conversation.",
        "Renvoie le brief, sa version et ce qui manque pour le récapitulatif.",
        "Ne pas l'appeler pour une information que le voyageur n'a pas donnée, ni pour re-confirmer une valeur déjà inchangée.",
      ].join(" "),
      inputSchema: tripBriefPatchSchema,
      execute: async (patch): Promise<UpdateTripBriefOutput> => applyPatch(state, today, patch),
    }),

    propose_quote_request: tool({
      description: [
        "Propose au voyageur le récapitulatif du brief pour validation, puis l'envoi (simulé) de la Demande de devis.",
        "À appeler quand update_trip_brief ne renvoie plus rien dans missingForRecap, avec briefVersion = la dernière version renvoyée.",
        "Le voyageur approuve, demande une modification ou abandonne ; en cas de refus, suivre la raison indiquée.",
        "Ne pas l'appeler tant que missingForRecap n'est pas vide.",
      ].join(" "),
      inputSchema: z.object({ briefVersion: z.string().regex(/^[0-9a-f]{16}$/) }),
      // Strict, because this output is replayed as the client sent it: `validateUIMessages` throws
      // away the value it parses and the client's own object is what `convertToModelMessages`
      // replays, so a key no branch declares is only kept out of the prompt by refusing the whole
      // message.
      outputSchema: z.discriminatedUnion("ok", [
        z.strictObject({
          ok: z.literal(true),
          brief: tripBriefSchema,
          agencyText: z.string().max(MAX_AGENCY_TEXT_LENGTH),
        }),
        z.strictObject({ ok: z.literal(false), error: toolErrorSchema }),
      ]),
      execute: async ({ briefVersion: approved }) => sendQuoteRequest(state, today, approved),
    }),
  };
}
