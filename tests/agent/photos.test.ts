import { describe, expect, it, vi } from "vitest";
import { createPhotoSearch } from "@/lib/agent/photos";

// Shape recorded from a real Commons response (generator=search, prop=imageinfo, formatversion=2).
function page(index: number, overrides: Record<string, unknown> = {}) {
  return {
    pageid: index,
    ns: 6,
    title: `File:Photo ${index}.jpg`,
    index,
    imageinfo: [
      {
        size: 1000,
        width: 4000,
        height: 3000,
        thumburl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Photo_${index}.jpg/640px-Photo_${index}.jpg`,
        thumbwidth: 640,
        thumbheight: 480,
        url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/Photo_${index}.jpg`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:Photo_${index}.jpg`,
        mime: "image/jpeg",
        extmetadata: {
          Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Ana">Ana</a>' },
          LicenseShortName: { value: "CC BY-SA 4.0" },
        },
        ...overrides,
      },
    ],
  };
}

function respondWith(body: unknown, init: ResponseInit = { status: 200 }) {
  return vi.fn(async () => new Response(JSON.stringify(body), init)) as unknown as typeof fetch;
}

describe("createPhotoSearch", () => {
  it("queries Commons' file namespace with a descriptive User-Agent", async () => {
    const fetchFn = respondWith({ query: { pages: [] } });
    await createPhotoSearch("trip-brief-agent/0.1 (ops@example.org)", fetchFn)("orangutan", 4);
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] as [string, RequestInit];
    const params = new URL(url).searchParams;
    expect(new URL(url).origin).toBe("https://commons.wikimedia.org");
    expect(params.get("generator")).toBe("search");
    expect(params.get("gsrnamespace")).toBe("6");
    expect(params.get("gsrsearch")).toBe("orangutan filetype:bitmap");
    expect(params.get("iiprop")).toContain("extmetadata");
    expect(init.headers).toEqual({ "User-Agent": "trip-brief-agent/0.1 (ops@example.org)" });
  });

  // Fails if the search rank is lost: Commons returns pages in no particular order, with `index`
  // carrying the rank, and the first photo shown should be the best match.
  it("keeps Commons' rank, landscape photos first, up to the count", async () => {
    const portrait = page(1, { thumbwidth: 480, thumbheight: 640 });
    const fetchFn = respondWith({ query: { pages: [page(3), portrait, page(2)] } });
    const outcome = await createPhotoSearch("ua", fetchFn)("orangutan", 2);
    if (!outcome.ok) throw new Error("expected photos");
    expect(outcome.photos.map((p) => p.pageUrl)).toEqual([
      "https://commons.wikimedia.org/wiki/File:Photo_2.jpg",
      "https://commons.wikimedia.org/wiki/File:Photo_3.jpg",
    ]);
    expect(outcome.photos[0]).toMatchObject({ license: "CC BY-SA 4.0", width: 640, height: 480 });
  });

  // Fails if a vector file or an image off Wikimedia's hosts gets through: the CSP would block it,
  // or the schema would reject the output on the next turn.
  it("drops non-bitmap files and images off Wikimedia's image hosts", async () => {
    const svg = page(1, { mime: "image/svg+xml" });
    const elsewhere = page(2, { thumburl: "https://evil.test/x.jpg" });
    const fetchFn = respondWith({ query: { pages: [svg, elsewhere, page(3)] } });
    const outcome = await createPhotoSearch("ua", fetchFn)("x", 4);
    if (!outcome.ok) throw new Error("expected photos");
    expect(outcome.photos.map((p) => p.pageUrl)).toEqual([
      "https://commons.wikimedia.org/wiki/File:Photo_3.jpg",
    ]);
  });

  it("returns an empty list when nothing matches", async () => {
    const outcome = await createPhotoSearch("ua", respondWith({ batchcomplete: true }))("x", 4);
    expect(outcome).toEqual({ ok: true, photos: [] });
  });

  // Fails if a Commons failure throws instead of degrading: the card or the turn would error.
  it.each([
    ["a non-200 status", respondWith({}, { status: 503 })],
    ["an unexpected body", respondWith({ query: { pages: "nope" } })],
    [
      "a network error",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    ],
  ])("returns a transient failure on %s", async (_, fetchFn) => {
    const outcome = await createPhotoSearch("ua", fetchFn)("x", 4);
    expect(outcome).toMatchObject({ ok: false, error: { errorCategory: "transient" } });
  });
});
