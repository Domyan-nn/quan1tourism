import { useEffect, useId, useRef, type ReactNode } from "react";
import { X, Headphones, MapPin, LoaderCircle } from "lucide-react";
import type { Poi, Status } from "@quan1/contracts";
import { mediaUrl } from "@quan1/api-client";
import type { T } from "./i18n";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Headphones size={23} strokeWidth={2.2} />
        <span />
      </span>
      {!compact && (
        <div>
          saigon
          <span className="brand-light">
            stories<span className="brand-dot">.</span>
          </span>
          <small>NHỮNG CÂU CHUYỆN ĐÁNG NGHE</small>
        </div>
      )}
    </div>
  );
}
export function Cover({
  poi,
  large = false,
}: {
  poi: Pick<Poi, "cover" | "image_id" | "name" | "source">;
  large?: boolean;
}) {
  if (poi.image_id || poi.source?.image_url)
    return (
      <img
        className={`place-cover ${large ? "large" : ""}`}
        src={
          poi.image_id ? mediaUrl(poi.image_id) : (poi.source?.image_url ?? "")
        }
        alt={poi.name}
      />
    );
  const palettes = [
    ["#e8deca", "#b79c73", "#f4ecd9", "#5d705d"],
    ["#e9d8cc", "#b96f53", "#f7e8d6", "#718579"],
    ["#dce4df", "#688677", "#f5eee0", "#a7b39a"],
    ["#dde2e6", "#6d8897", "#f4ead7", "#8c9d8a"],
  ];
  const [bg, building, light, tree] = palettes[poi.cover % 4];
  return (
    <svg
      className={`place-cover ${large ? "large" : ""}`}
      viewBox="0 0 180 120"
      role="img"
      aria-label={`Minh họa ${poi.name}`}
    >
      <rect width="180" height="120" fill={bg} />
      <circle cx="142" cy="27" r="14" fill={light} />
      <path d="M0 93 Q40 82 90 94 T180 90 V120 H0Z" fill={tree} opacity=".25" />
      {poi.cover % 4 === 1 ? (
        <g fill={building}>
          <path d="M48 89V35L58 12L68 35V89ZM112 89V35L122 12L132 35V89Z" />
          <path d="M65 89V53L90 31L115 53V89Z" />
          <circle cx="90" cy="57" r="9" fill={light} />
          <path d="M81 89V77A9 9 0 0 1 99 77V89" fill={light} />
          <path d="M54 51V42H62V51ZM118 51V42H126V51Z" fill={light} />
        </g>
      ) : poi.cover % 4 === 3 ? (
        <g fill={building}>
          <path d="M29 89V58H151V89Z" />
          <path d="M24 58L40 47H140L156 58Z" />
          <path d="M75 89V38H105V89Z" />
          <path d="M71 38L90 22L109 38Z" />
          <circle cx="90" cy="51" r="7" fill={light} />
          {[40, 58, 116, 134].map((x) => (
            <rect
              key={x}
              x={x}
              y="66"
              width="7"
              height="18"
              rx="3"
              fill={light}
            />
          ))}
          <path d="M84 89V74A6 6 0 0 1 96 74V89" fill={light} />
        </g>
      ) : (
        <g fill={building}>
          <rect x="30" y="51" width="120" height="39" />
          <rect x="61" y="37" width="58" height="53" />
          <path d="M25 51L36 42H144L155 51ZM56 37L90 23L124 37Z" />
          {[39, 51, 65, 78, 91, 104, 123, 136].map((x) => (
            <rect key={x} x={x} y="58" width="5" height="21" fill={light} />
          ))}
          <rect x="83" y="76" width="14" height="14" fill={light} />
          <path d="M52 91H129L138 98H43Z" />
        </g>
      )}
      <g fill={tree}>
        <circle cx="17" cy="77" r="15" />
        <rect x="15" y="78" width="4" height="20" />
        <circle cx="166" cy="74" r="18" />
        <rect x="163" y="75" width="5" height="23" />
      </g>
      <path d="M0 102H180" stroke={light} strokeWidth="3" />
      <path d="M62 120L79 102H101L124 120" fill={light} opacity=".6" />
    </svg>
  );
}
export function Badge({ status, t }: { status: Status; t: T }) {
  const labels = {
    draft: t.draft,
    in_review: t.waiting,
    approved: t.approved,
    published: t.published,
    archived: t.archived,
  };
  return (
    <span className={`badge ${status}`}>
      <i />
      {labels[status]}
    </span>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      el.close();
      document.body.style.overflow = old;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "dialog-wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Đóng / Close"
        >
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Loading({ text }: { text: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={24} />
      {text}
    </div>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <MapPin size={30} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function pauseOtherAudio(event: React.SyntheticEvent<HTMLAudioElement>) {
  document.querySelectorAll("audio").forEach((a) => {
    if (a !== event.currentTarget) a.pause();
  });
}
