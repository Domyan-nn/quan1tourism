import { useEffect, useId, useRef, useState } from "react";
import "./speech.css";

let owner: string | null = null;

// Small utterances avoid platform limits when reading long stories (up to 30,000 characters).
function nextChunk(text: string, start: number) {
  let end = Math.min(start + 180, text.length);
  if (end < text.length) {
    const fragment = text.slice(start, end);
    const boundary = Math.max(
      fragment.lastIndexOf(" "),
      fragment.lastIndexOf("。"),
      fragment.lastIndexOf("."),
      fragment.lastIndexOf("\n"),
    );
    if (boundary > 80) end = start + boundary + 1;
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end--;
  }
  return text.slice(start, end);
}

export function SpeechPlayer({
  text,
  speechLocale,
  uiLocale = "vi",
}: {
  text: string;
  speechLocale: string;
  uiLocale?: string;
}) {
  const vi = uiLocale === "vi";
  const id = useId();
  const supported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState("");
  const [rate, setRate] = useState(1);
  const [state, setState] = useState<"idle" | "playing" | "paused">("idle");
  const [position, setPosition] = useState(0);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const cursor = useRef(0);
  const matching = voices.filter(
    (voice) =>
      voice.lang.replace(/_/g, "-").split("-")[0].toLowerCase() ===
      speechLocale.split("-")[0].toLowerCase(),
  );
  const voice =
    matching.find((v) => v.voiceURI === voiceURI) ??
    matching.find((v) => v.lang.toLowerCase() === speechLocale.toLowerCase()) ??
    matching[0];

  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener("voiceschanged", update);
    return () => synth.removeEventListener("voiceschanged", update);
  }, [supported]);

  useEffect(() => {
    cursor.current = 0;
    setPosition(0);
    setState("idle");
    setError("");
    setVoiceURI("");
    return () => {
      generation.current++;
      if (supported && owner === id) {
        owner = null;
        window.speechSynthesis.cancel();
      }
      utterance.current = null;
    };
  }, [text, speechLocale, supported, id]);

  useEffect(() => {
    const stopOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail === id) return;
      generation.current++;
      setState("idle");
      utterance.current = null;
    };
    window.addEventListener("quan1-speech-start", stopOther);
    return () => window.removeEventListener("quan1-speech-start", stopOther);
  }, [id]);

  function stop(reset = true) {
    generation.current++;
    if (supported && owner === id) {
      owner = null;
      window.speechSynthesis.cancel();
    }
    utterance.current = null;
    setState("idle");
    if (reset) {
      cursor.current = 0;
      setPosition(0);
    }
  }

  function play(start = cursor.current) {
    if (!supported || !voice || !text.trim()) return;
    window.dispatchEvent(new CustomEvent("quan1-speech-start", { detail: id }));
    generation.current++;
    const token = generation.current;
    window.speechSynthesis.cancel();
    owner = id;
    setError("");
    setState("playing");
    function speak(offset: number) {
      if (generation.current !== token) return;
      if (offset >= text.length) {
        cursor.current = 0;
        setPosition(text.length);
        setState("idle");
        owner = null;
        utterance.current = null;
        return;
      }
      const chunk = nextChunk(text, offset);
      const item = new SpeechSynthesisUtterance(chunk);
      utterance.current = item; // Retain a reference until the engine finishes.
      item.lang = speechLocale;
      item.voice = voice!;
      item.rate = rate;
      cursor.current = offset;
      setPosition(offset);
      item.onboundary = (event) => {
        if (generation.current === token) {
          cursor.current = offset + event.charIndex;
          setPosition(cursor.current);
        }
      };
      item.onend = () => speak(offset + chunk.length);
      item.onerror = (event) => {
        if (generation.current !== token) return;
        owner = null;
        setState("idle");
        utterance.current = null;
        if (event.error !== "canceled" && event.error !== "interrupted")
          setError(
            vi
              ? "Không phát được giọng đọc. Hãy chọn giọng khác hoặc thử lại."
              : "Speech failed. Choose another voice or try again.",
          );
      };
      window.speechSynthesis.speak(item);
    }
    speak(start >= text.length ? 0 : start);
  }

  return (
    <div
      className="speech-player"
      aria-label={vi ? "Đọc văn bản thành giọng nói" : "Text to speech"}
    >
      {!supported ? (
        <p role="status">
          {vi
            ? "Trình duyệt chưa hỗ trợ đọc văn bản. Bạn vẫn có thể đọc bài bên dưới."
            : "This browser does not support speech. You can read the story below."}
        </p>
      ) : !voice ? (
        <p role="status">
          {vi
            ? `Chưa có giọng đọc ${speechLocale} trên thiết bị. Cài giọng trong cài đặt ngôn ngữ của thiết bị hoặc thử trình duyệt khác.`
            : `No ${speechLocale} voice is available. Install a voice in your device language settings or try another browser.`}
        </p>
      ) : null}
      <div className="speech-controls">
        <button
          type="button"
          className="button"
          disabled={!voice || !text.trim()}
          onClick={() => {
            if (state === "playing") {
              stop(false);
              setState("paused");
            } else play();
          }}
        >
          {state === "playing"
            ? vi
              ? "Tạm dừng"
              : "Pause"
            : state === "paused"
              ? vi
                ? "Tiếp tục đọc"
                : "Resume"
              : vi
                ? "Nghe thuyết minh"
                : "Listen to narration"}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={state === "idle" && position === 0}
          onClick={() => stop()}
        >
          {vi ? "Dừng" : "Stop"}
        </button>
        <label>
          {vi ? "Tốc độ" : "Speed"}
          <select
            aria-label={vi ? "Tốc độ" : "Speed"}
            value={rate}
            onChange={(event) => {
              stop(false);
              setRate(Number(event.target.value));
            }}
          >
            {[0.75, 1, 1.25, 1.5, 2].map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
        {!!matching.length && (
          <label>
            {vi ? "Giọng đọc" : "Voice"}
            <select
              aria-label={vi ? "Giọng đọc" : "Voice"}
              value={voice?.voiceURI ?? ""}
              onChange={(event) => {
                stop(false);
                setVoiceURI(event.target.value);
              }}
            >
              {matching.map((item) => (
                <option key={item.voiceURI} value={item.voiceURI}>
                  {item.name} ({item.lang})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <label className="speech-progress">
        {vi ? "Vị trí đọc" : "Reading position"} ·{" "}
        {Math.round((position / Math.max(1, text.length)) * 100)}%
        <input
          aria-label={vi ? "Vị trí đọc" : "Reading position"}
          type="range"
          min={0}
          max={Math.max(1, text.length)}
          value={position}
          disabled={!voice || !text.trim()}
          onChange={(event) => {
            stop(false);
            cursor.current = Number(event.target.value);
            setPosition(cursor.current);
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
