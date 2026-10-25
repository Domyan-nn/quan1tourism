import { useState } from "react";
import { Copy, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

export function MobileAppCard({ url, vi }: { url: string; vi: boolean }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">(
    "idle",
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      setCopyState("manual");
    }
  }
  return (
    <aside className="mobile-app-card" aria-labelledby="mobile-app-title">
      <Smartphone size={22} aria-hidden="true" />
      <h2 id="mobile-app-title">
        {vi ? "Trải nghiệm trên điện thoại" : "Try it on your phone"}
      </h2>
      <QRCodeSVG
        value={url}
        size={176}
        marginSize={4}
        level="M"
        bgColor="#ffffff"
        fgColor="#294735"
        role="img"
        title={
          vi
            ? "Mã QR mở ứng dụng trong Expo Go"
            : "QR code to open the app in Expo Go"
        }
        className="mobile-app-qr"
      />
      <p>{vi ? "Mở Expo Go để quét mã" : "Scan with Expo Go"}</p>
      <p><a href="https://expo.dev/go" target="_blank" rel="noreferrer">{vi ? "Cài Expo Go cho điện thoại" : "Install Expo Go on your phone"}</a></p>
      <a className="mobile-app-open" href={url}>
        <Smartphone size={17} aria-hidden="true" />
        {vi ? "Mở bằng Expo Go" : "Open in Expo Go"}
      </a>
      <button className="mobile-app-copy" type="button" onClick={copy}>
        <Copy size={16} aria-hidden="true" />
        {vi ? "Sao chép liên kết" : "Copy link"}
      </button>
      <span className="mobile-app-feedback" role="status">
        {copyState === "copied"
          ? vi
            ? "Đã sao chép liên kết"
            : "Link copied"
          : ""}
      </span>
      {copyState === "manual" && (
        <label className="mobile-app-manual">
          {vi ? "Chọn và sao chép liên kết:" : "Select and copy the link:"}
          <input
            readOnly
            value={url}
            onFocus={(event) => event.target.select()}
            onClick={(event) => event.currentTarget.select()}
          />
        </label>
      )}
      <small>
        {vi
          ? "Phiên dùng thử cần máy chạy ứng dụng tiếp tục bật."
          : "This preview needs the app server to stay running."}
      </small>
      <a className="auth-link" href="#places">{vi ? "Tiếp tục dùng web" : "Continue on the web"}</a>
    </aside>
  );
}
