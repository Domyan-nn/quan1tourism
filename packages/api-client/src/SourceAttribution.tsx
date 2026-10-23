import type { WikipediaSource } from "@quan1/contracts";
import "./source.css";

export function SourceAttribution({
  source,
  vi = true,
  imageUsed = true,
}: {
  source?: WikipediaSource | null;
  vi?: boolean;
  imageUsed?: boolean;
}) {
  if (!source) return null;
  const revisionUrl = source.revision_id
    ? `${source.url}?oldid=${source.revision_id}`
    : source.url;
  return (
    <div className="source-attribution">
      <p>
        {vi ? "Nguồn tham khảo: " : "Reference: "}
        <a href={revisionUrl} target="_blank" rel="noopener noreferrer">
          {source.title} · Wikipedia
        </a>
        {" · "}
        {source.license}
      </p>
      {imageUsed && source.image_url && source.image_page_url && (
        <p>
          {vi ? "Ảnh: " : "Image: "}
          <a
            href={source.image_page_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {source.image_author || "Wikimedia Commons"}
          </a>
          {source.image_license ? ` · ${source.image_license}` : ""}
        </p>
      )}
    </div>
  );
}
