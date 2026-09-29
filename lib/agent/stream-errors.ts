export const RATE_LIMITED_MESSAGE = "Le service est très sollicité. Réessayez dans un instant.";
export const GENERIC_STREAM_ERROR_MESSAGE =
  "La réponse s’est interrompue. Votre voyage est conservé, vous pouvez réessayer.";
export const CONVERSATION_TOO_LONG_MESSAGE =
  "Cette conversation est trop longue pour continuer. Commencez un nouveau voyage : votre récapitulatif actuel reste affiché.";

export const STREAM_ERROR_MESSAGES: readonly string[] = [
  RATE_LIMITED_MESSAGE,
  GENERIC_STREAM_ERROR_MESSAGE,
];

// The route answers 413 with { error: "too_many_messages" | "message_too_long" } and the SDK
// surfaces that body in the error message. Retrying resends the same history, so it fails the
// same way: this is the one error the UI must not offer to retry.
export function isConversationTooLong(message: string): boolean {
  return message.includes("too_many_messages") || message.includes("message_too_long");
}
