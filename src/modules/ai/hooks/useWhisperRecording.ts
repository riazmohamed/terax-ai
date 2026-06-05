import { useCallback, useEffect, useRef, useState } from "react";
import { useChatStore } from "../store/chatStore";

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

type SpeechAlternative = {
  transcript: string;
};

type SpeechResult = {
  readonly 0?: SpeechAlternative;
  readonly isFinal: boolean;
};

type SpeechResultList = {
  readonly length: number;
  readonly [index: number]: SpeechResult | undefined;
  item?: (index: number) => SpeechResult | null;
};

type SpeechRecognitionEventLike = Event & {
  readonly results: SpeechResultList;
};

type SpeechRecognitionErrorEventLike = Event & {
  readonly error?: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

function speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as SpeechRecognitionWindow;
  return (
    speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
  );
}

function transcriptFromSpeechEvent(event: SpeechRecognitionEventLike): string {
  const parts: string[] = [];
  for (let i = 0; i < event.results.length; i++) {
    const result = event.results.item?.(i) ?? event.results[i];
    const transcript = result?.isFinal ? result[0]?.transcript.trim() : "";
    if (transcript) parts.push(transcript);
  }
  return parts.join(" ").trim();
}

async function transcribeBlob(blob: Blob, apiKey: string): Promise<string> {
  const [{ createOpenAI }, { experimental_transcribe: transcribe }] =
    await Promise.all([import("@ai-sdk/openai"), import("ai")]);
  const openai = createOpenAI({ apiKey });
  const buf = new Uint8Array(await blob.arrayBuffer());
  const { text } = await transcribe({
    model: openai.transcription("whisper-1"),
    audio: buf,
  });
  return text;
}

type State = "idle" | "recording" | "transcribing";

export function useWhisperRecording({
  onResult,
}: {
  onResult: (text: string) => void;
}) {
  const apiKey = useChatStore((s) => s.apiKeys.openai);
  const [state, setState] = useState<State>("idle");
  const recRef = useRef<MediaRecorder | null>(null);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const speechSupported = speechRecognitionConstructor() !== null;
  const mediaSupported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";
  const supported = speechSupported || mediaSupported;

  const teardownStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const stop = useCallback(() => {
    const speech = speechRef.current;
    if (speech) {
      speech.stop();
      return;
    }
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const startBrowserSpeech = useCallback((): boolean => {
    const SpeechRecognition = speechRecognitionConstructor();
    if (!SpeechRecognition) return false;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = navigator.language || "en-US";
      recognition.onresult = (event) => {
        const transcript = transcriptFromSpeechEvent(event);
        if (transcript) onResult(transcript);
      };
      recognition.onerror = (event) => {
        console.error("speech.recognition", event.error ?? event.type);
        speechRef.current = null;
        setState("idle");
      };
      recognition.onend = () => {
        speechRef.current = null;
        setState("idle");
      };
      speechRef.current = recognition;
      setState("recording");
      recognition.start();
      return true;
    } catch (e) {
      console.error("speech.recognition.start", e);
      speechRef.current = null;
      setState("idle");
      return false;
    }
  }, [onResult]);

  const startWhisperFallback = useCallback(async (): Promise<void> => {
    if (!mediaSupported || !apiKey) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMime();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        teardownStream();
        if (blob.size === 0) {
          setState("idle");
          return;
        }
        setState("transcribing");
        try {
          const text = await transcribeBlob(blob, apiKey);
          if (text.trim()) onResult(text.trim());
        } catch (e) {
          console.error("whisper.transcribe", e);
        } finally {
          setState("idle");
        }
      };
      recRef.current = rec;
      rec.start();
      setState("recording");
    } catch (e) {
      console.error("whisper.getUserMedia", e);
      teardownStream();
      setState("idle");
    }
  }, [apiKey, mediaSupported, onResult]);

  const start = useCallback(async () => {
    if (!supported || state !== "idle") return;
    if (startBrowserSpeech()) return;
    await startWhisperFallback();
  }, [startBrowserSpeech, startWhisperFallback, state, supported]);

  useEffect(() => {
    return () => {
      speechRef.current?.abort();
      recRef.current?.stop();
      teardownStream();
    };
  }, []);

  return {
    state,
    recording: state === "recording",
    transcribing: state === "transcribing",
    start,
    stop,
    supported,
    hasKey: speechSupported || !!apiKey,
  };
}
