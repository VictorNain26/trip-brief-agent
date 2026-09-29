import Image from "next/image";
import type { Photo } from "@/lib/agent/photos";

// Commons' Artist field is HTML, usually a link to the author's page. DOMParser only parses it, it
// runs no script, and textContent keeps the name the credit needs.
function authorName(html: string): string {
  return new DOMParser().parseFromString(html, "text/html").body.textContent?.trim() ?? "";
}

export function CommonsPhoto({ photo, alt }: { photo: Photo; alt: string }) {
  const author = authorName(photo.author) || "Wikimedia Commons";
  return (
    <figure className="flex flex-col gap-1">
      {/* Unoptimized: the browser loads the Commons thumbnail directly, which the CSP allows, and
          this server never fetches third-party images. */}
      <Image
        src={photo.url}
        width={photo.width}
        height={photo.height}
        alt={alt}
        unoptimized
        className="aspect-[4/3] h-auto w-full rounded-md object-cover"
      />
      <figcaption className="text-xs text-muted-foreground">
        Photo&nbsp;:{" "}
        <a href={photo.pageUrl} target="_blank" rel="noopener noreferrer" className="underline">
          {author}
          <span className="sr-only"> (nouvel onglet)</span>
        </a>
        {photo.license && ` — ${photo.license}`}
      </figcaption>
    </figure>
  );
}

export function PhotoStrip({ photos, subject }: { photos: Photo[]; subject: string }) {
  return (
    <ul className="grid grid-cols-2 gap-3" aria-label={`Photos : ${subject}`}>
      {photos.map((photo) => (
        <li key={photo.url}>
          <CommonsPhoto photo={photo} alt={`Photo : ${subject}`} />
        </li>
      ))}
    </ul>
  );
}
