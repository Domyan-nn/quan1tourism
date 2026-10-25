import { nextChunk, voiceMatches } from "../../../packages/api-client/src/speech-chunks.ts";

export type PlaybackState = "idle" | "loading" | "speaking" | "missing-voice" | "error";
export interface SpeechPort {
  stop(): Promise<void>;
  voices(): Promise<{ identifier: string; language: string }[]>;
  speak(text: string, options: {
    language: string; voice: string; rate: number;
    onStart(): void; onDone(): void; onStopped(): void; onError(): void;
  }): void;
}
// Generation guards also cover voice lookups and callbacks arriving after stop/switch.
export class Narrator {
  private generation = 0;
  private port: SpeechPort;
  private changed: (state: PlaybackState) => void;
  busy = false;
  constructor(port: SpeechPort, changed: (state: PlaybackState) => void) {
    this.port = port;
    this.changed = changed;
  }
  async stop() {
    this.generation++;
    this.busy = false;
    this.changed("idle");
    await this.port.stop();
  }
  async play(text: string, language: string, started: () => void) {
    const generation = ++this.generation;
    this.busy = true;
    this.changed("loading");
    const current = () => generation === this.generation;
    const finish = (state: PlaybackState) => {
      if (current()) { this.busy = false; this.changed(state); }
    };
    try {
      await this.port.stop();
      if (!current()) return;
      const voices = await this.port.voices();
      if (!current()) return;
      const voice = voices.find(v => v.language.toLowerCase() === language.toLowerCase()) ??
        voices.find(v => voiceMatches(language, v.language));
      if (!voice) { finish("missing-voice"); return; }
      let offset = 0;
      let counted = false;
      const next = () => {
        if (!current()) return;
        const chunk = nextChunk(text, offset);
        if (!chunk) { finish("idle"); return; }
        offset += chunk.length;
        // Native engines can deliver duplicate or late terminal callbacks. A
        // completed chunk must never queue another copy or stop the next one.
        let completed = false;
        const active = () => current() && !completed;
        const end = (state: PlaybackState) => {
          if (!active()) return;
          completed = true;
          finish(state);
        };
        try {
          this.port.speak(chunk, {
            voice: voice.identifier, language, rate: 0.95,
            onStart: () => {
              if (!active()) return;
              this.changed("speaking");
              if (!counted) { counted = true; started(); }
            },
            onDone: () => {
              if (!active()) return;
              completed = true;
              next();
            },
            onStopped: () => end("idle"),
            onError: () => end("error"),
          });
        } catch { end("error"); }
      };
      next();
    } catch { finish("error"); }
  }
}
