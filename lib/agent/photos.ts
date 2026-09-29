import { z } from "zod";
import { toolErrorSchema, toolFailure } from "@/lib/agent/errors";

// Wikimedia Commons: freely licensed images with an author and a licence to credit, and no API
// key. Query shape per https://www.mediawiki.org/wiki/API:Imageinfo and
// https://www.mediawiki.org/wiki/API:Search (generator=search over the File namespace).
const API = "https://commons.wikimedia.org/w/api.php";
// Thumbnails are served from both hosts; the CSP's img-src allows exactly these two.
export const PHOTO_HOSTS = ["upload.wikimedia.org", "thumb.wikimedia.org"];
const WIDTH = 640;
const TIMEOUT_MS = 4000;
const CANDIDATES = 12;
export const MAX_PHOTOS = 4;
const MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const UNAVAILABLE = "Photos indisponibles pour le moment.";

function onPhotoHost(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && PHOTO_HOSTS.includes(hostname);
  } catch {
    return false;
  }
}

// Outputs are sent back by the client on every turn, so the schema holds a replayed photo to the
// same hosts the server would have picked.
export const photoSchema = z.strictObject({
  url: z.httpUrl().max(2048).refine(onPhotoHost, { error: "not a Wikimedia image URL" }),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  pageUrl: z.httpUrl().max(2048),
  // Commons' Artist field is HTML (usually a link to the author's page); the interface keeps its text.
  author: z.string().max(500),
  license: z.string().max(80),
});

export type Photo = z.infer<typeof photoSchema>;

export const photoOutcomeSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), photos: z.array(photoSchema).max(MAX_PHOTOS) }),
  z.strictObject({ ok: z.literal(false), error: toolErrorSchema }),
]);

export type PhotoOutcome = z.infer<typeof photoOutcomeSchema>;

export type PhotoFn = (query: string, count: number) => Promise<PhotoOutcome>;

const commonsResponseSchema = z.object({
  query: z
    .object({
      pages: z.array(
        z.object({
          index: z.number(),
          imageinfo: z
            .array(
              z.object({
                thumburl: z.string(),
                thumbwidth: z.number(),
                thumbheight: z.number(),
                mime: z.string(),
                descriptionurl: z.string(),
                extmetadata: z
                  .object({
                    Artist: z.object({ value: z.string() }).optional(),
                    LicenseShortName: z.object({ value: z.string() }).optional(),
                  })
                  .optional(),
              }),
            )
            .optional(),
        }),
      ),
    })
    .optional(),
});

export function createPhotoSearch(userAgent: string, fetchFn: typeof fetch = fetch): PhotoFn {
  return async (query, count) => {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      generator: "search",
      gsrnamespace: "6",
      gsrsearch: `${query} filetype:bitmap`,
      gsrlimit: String(CANDIDATES),
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: String(WIDTH),
      iiextmetadatafilter: "Artist|LicenseShortName",
    });
    try {
      const response = await fetchFn(`${API}?${params}`, {
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) return toolFailure("transient", UNAVAILABLE);
      const parsed = commonsResponseSchema.safeParse(await response.json());
      if (!parsed.success) return toolFailure("transient", UNAVAILABLE);
      const ranked = [...(parsed.data.query?.pages ?? [])].sort((a, b) => a.index - b.index);
      const photos = ranked.flatMap((page) => {
        const info = page.imageinfo?.[0];
        if (!info || !MIME_TYPES.has(info.mime)) return [];
        const photo = photoSchema.safeParse({
          url: info.thumburl,
          width: info.thumbwidth,
          height: info.thumbheight,
          pageUrl: info.descriptionurl,
          author: (info.extmetadata?.Artist?.value ?? "").slice(0, 500),
          license: (info.extmetadata?.LicenseShortName?.value ?? "").slice(0, 80),
        });
        return photo.success ? [photo.data] : [];
      });
      // Landscape first: the card and the strip are wide, and a portrait crop loses the subject.
      const landscape = photos.filter((p) => p.width >= p.height);
      const portrait = photos.filter((p) => p.width < p.height);
      return { ok: true, photos: [...landscape, ...portrait].slice(0, count) };
    } catch {
      return toolFailure("transient", UNAVAILABLE);
    }
  };
}
