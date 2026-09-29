/** The JSON chunks of a UI message stream response body (server-sent events). */
export function chunks(body: string): Record<string, unknown>[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}
