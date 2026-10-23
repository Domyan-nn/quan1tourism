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
    const synth = Object.assign(new EventTarget(), {
      getVoices: () =>
        locales.map((lang) => ({
          lang,
          name: lang,
          voiceURI: lang,
          default: false,
          localService: true,
        })),
      cancel: () => {
        cancellations++;
        active = null;
      },
      speak: (utterance: SpeechSynthesisUtterance) => {
        active = utterance;
        calls.push({
          text: utterance.text,
          lang: utterance.lang,
          rate: utterance.rate,
          voice: utterance.voice?.voiceURI ?? "",
        });
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
        get cancellations() {
          return cancellations;
        },
        finish: () => active?.onend?.(new Event("end") as SpeechSynthesisEvent),
        fail: () =>
          active?.onerror?.({ error: "network" } as SpeechSynthesisErrorEvent),
      },
    });
  }, locales);
}
