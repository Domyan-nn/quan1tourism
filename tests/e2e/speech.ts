import type { Page } from "@playwright/test";

// Verify browser API integration deterministically. This does not validate a device's real voice quality.
export async function mockSpeech(
  page: Page,
  locales = ["vi-VN", "en-US", "fr-FR", "ms-MY"],
) {
  await page.addInitScript((locales) => {
    class MockUtterance extends EventTarget {
      text: string;
      lang = "";
      rate = 1;
      voice: { voiceURI: string } | null = null;
      constructor(text: string) {
        super();
        this.text = text;
      }
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: MockUtterance,
    });
    const calls: { text: string; lang: string; rate: number; voice: string }[] =
      [];
    let cancellations = 0;
    let active: SpeechSynthesisUtterance | null = null;
    const utterances: SpeechSynthesisUtterance[] = [];
    let available = locales;
    let paused = false;
    let denied = false;
    const synth = Object.assign(new EventTarget(), {
      getVoices: () =>
        available.map((lang) => ({
          lang,
          name: lang,
          voiceURI: lang,
          default: false,
          localService: true,
        })),
      cancel: () => {
        cancellations++;
        active = null;
        paused = false;
      },
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
      },
      speak: (utterance: SpeechSynthesisUtterance) => {
        active = utterance;
        utterances.push(utterance);
        calls.push({
          text: utterance.text,
          lang: utterance.lang,
          rate: utterance.rate,
          voice: utterance.voice?.voiceURI ?? "",
        });
        if (denied) return;
        queueMicrotask(() => {
          if (active === utterance)
            utterance.onstart?.(new Event("start") as SpeechSynthesisEvent);
        });
      },
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: synth,
    });
    Object.defineProperty(window, "__speech", {
      value: {
        calls,
        deny: (value: boolean) => {
          denied = value;
        },
        get paused() {
          return paused;
        },
        get active() {
          return !!active;
        },
        voices: (items: string[]) => {
          available = items;
          synth.dispatchEvent(new Event("voiceschanged"));
        },
        oldEnd: (index: number) =>
          utterances[index]?.onend?.(new Event("end") as SpeechSynthesisEvent),
        get cancellations() {
          return cancellations;
        },
        finish: () => {
          const item = active;
          active = null;
          item?.onend?.(new Event("end") as SpeechSynthesisEvent);
        },
        fail: () =>
          active?.onerror?.({ error: "network" } as SpeechSynthesisErrorEvent),
      },
    });
  }, locales);
}
