import { useEffect, useId, useRef, useState } from "react";
import "./speech.css";
import { nextChunk, voiceMatches } from "./speech-chunks";

let owner: string | null = null;
export const isSpeechBusy = () => owner !== null;

export function SpeechPlayer({
  text,
  speechLocale,
  uiLocale = "vi",
  onStarted,
  autoRequest = 0,
  onAutoBlocked,
}: {
  text: string;
  speechLocale: string;
  uiLocale?: string;
  onStarted?: () => void;
  autoRequest?: number;
  onAutoBlocked?: () => void;
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
  const [state, setState] = useState<
    "ready" | "playing" | "paused" | "stopped" | "error"
  >("ready");
  const [position, setPosition] = useState(0);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const cursor = useRef(0);
  const started = useRef(false);
  const autoOwned = useRef(false);
  const attempted = useRef(0);
  const startTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const blockedRef = useRef(onAutoBlocked);
  blockedRef.current = onAutoBlocked;
  const onStartedRef = useRef(onStarted);
  onStartedRef.current = onStarted;
  const matching = voices.filter((voice) =>
    voiceMatches(speechLocale, voice.lang),
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
    started.current = false;
    cursor.current = 0;
    setPosition(0);
    setState("ready");
    setError("");
    setVoiceURI("");
    return () => {
      generation.current++;
      clearTimeout(startTimer.current);
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
      clearTimeout(startTimer.current);
      setState("stopped");
      utterance.current = null;
    };
    window.addEventListener("quan1-speech-start", stopOther);
    const stopAuto = () => {
      if (autoOwned.current) stop();
    };
    window.addEventListener("quan1-speech-stop-auto", stopAuto);
    return () => {
      window.removeEventListener("quan1-speech-start", stopOther);
      window.removeEventListener("quan1-speech-stop-auto", stopAuto);
    };
  }, [id]);

  useEffect(() => {
    if (!autoRequest || attempted.current === autoRequest) return;
    if (!voice) {
      const timer = setTimeout(() => {
        attempted.current = autoRequest;
        blockedRef.current?.();
      }, 3000);
      return () => clearTimeout(timer);
    }
    attempted.current = autoRequest;
    if (isSpeechBusy() || document.hidden) {
      blockedRef.current?.();
      return;
    }
    autoOwned.current = true;
    play(0);
  }, [autoRequest, voice]);

  function stop(reset = true) {
    generation.current++;
    clearTimeout(startTimer.current);
    if (supported && owner === id) {
      owner = null;
      window.speechSynthesis.cancel();
    }
    utterance.current = null;
    setState("stopped");
    if (reset) {
      cursor.current = 0;
      setPosition(0);
    }
  }

  function play(start = cursor.current) {
    if (!supported || !voice || !text.trim()) return;
    if (state === "paused" && owner === id) {
      window.speechSynthesis.resume();
      setState("playing");
      return;
    }
    started.current = false;
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
        setState("ready");
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
      let chunkStarted = false;
      item.onstart = () => {
        if (generation.current !== token || utterance.current !== item) return;
        chunkStarted = true;
        clearTimeout(startTimer.current);
        if (!started.current) {
          started.current = true;
          onStartedRef.current?.();
        }
      };
      cursor.current = offset;
      setPosition(offset);
      item.onboundary = (event) => {
        if (generation.current === token && utterance.current === item) {
          cursor.current = offset + event.charIndex;
          setPosition(cursor.current);
        }
      };
      item.onend = () => {
        if (generation.current !== token || utterance.current !== item) return;
        clearTimeout(startTimer.current);
        if (!chunkStarted) {
          item.onerror?.({ error: "not-allowed" } as SpeechSynthesisErrorEvent);
          return;
        }
        speak(offset + chunk.length);
      };
      item.onerror = () => {
        if (generation.current !== token || utterance.current !== item) return;
        generation.current++;
        clearTimeout(startTimer.current);
        owner = null;
        setState("error");
        utterance.current = null;
        if (autoOwned.current) blockedRef.current?.();
        setError(
          document.documentElement.lang === "vi"
            ? "Không phát được giọng đọc. Hãy chọn giọng khác hoặc thử lại."
            : "Speech failed. Choose another voice or try again.",
        );
      };
      try {
        window.speechSynthesis.speak(item);
        if (!chunkStarted)
          startTimer.current = setTimeout(() => {
            if (generation.current !== token || chunkStarted) return;
            stop(false);
            setState("error");
            setError(
              document.documentElement.lang === "vi"
                ? "Chạm để nghe; trình duyệt chưa cho phép phát tự động."
                : "Tap to listen; the browser has not allowed automatic playback.",
            );
            if (autoOwned.current) blockedRef.current?.();
          }, 5000);
      } catch {
        item.onerror?.({ error: "not-allowed" } as SpeechSynthesisErrorEvent);
      }
    }
    speak(start >= text.length ? 0 : start);
  }

  return (
    <div
      className="speech-player"
      data-state={state}
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
            if (state !== "playing" && state !== "paused")
              autoOwned.current = false;
            if (state === "playing") {
              window.speechSynthesis.pause();
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
          disabled={
            (state === "ready" || state === "stopped") && position === 0
          }
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
      {error && (
        <p role="alert">
          {error.includes("Chạm") || error.includes("Tap to listen")
            ? vi
              ? "Chạm để nghe; trình duyệt chưa cho phép phát tự động."
              : "Tap to listen; the browser has not allowed automatic playback."
            : vi
              ? "Không phát được giọng đọc. Hãy chọn giọng khác hoặc thử lại."
              : "Speech failed. Choose another voice or try again."}
        </p>
      )}
    </div>
  );
}
