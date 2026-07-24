import type { FlagHit } from "../lib/flagDetector";

export function FlagHitStrip({ hits }: { hits: FlagHit[] }) {
  if (hits.length === 0) return null;
  return (
    <div className="global-flag-strip" aria-live="polite">
      {hits.map((hit, index) => (
        <div className="global-flag-item" key={`${hit.source}-${hit.text}-${index}`}>
          <mark>{hit.text}</mark>
          {hit.source === "base64" && <span>Base64</span>}
        </div>
      ))}
    </div>
  );
}
