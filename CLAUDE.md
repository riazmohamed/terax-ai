# Terax AI — Development Guide

**Last Updated:** 2026-05-20

## Quick Start

- **Build:** `pnpm install && pnpm run build`
- **Dev:** `pnpm dev`
- **Test:** `pnpm test`
- **Package Manager:** pnpm

## Project Structure

- **src/** — Frontend React/TypeScript code
- **src-tauri/** — Tauri backend (Rust)
- **src/modules/ai/** — AI agent system
  - `config.ts` — Model & provider definitions
  - `lib/agent.ts` — Core agent runtime
  - `lib/transport.ts` — Context-aware transport layer
  - `store/chatStore.ts` — Chat session state (Zustand)
- **src/modules/settings/** — Settings store & preferences

## Key Features

### AI Agents
- **Multi-Provider:** OpenAI, Anthropic, Google, xAI, Cerebras, Groq, DeepSeek, Mistral, OpenRouter
- **Local Models:** Ollama, LM Studio, OpenAI-compatible endpoints
- **Custom Models:** User-defined model registration with `custom:` prefix
- **Context Limit Override:** `openaiCompatibleContextLimit` for custom endpoints

### Custom Models (CustomModel)
Models are stored in preferences as:
```typescript
type CustomModel = {
  id: string;           // Must start with "custom:"
  label: string;        // Display name
  provider: "ollama" | "lmstudio" | "openai-compatible";
  remoteModelId: string; // What provider expects
  contextLimit?: number;
};
```

### Providers & Keys
- **API Keys:** Stored in OS keychain via `lib/keyring.ts`
- **Keyless Providers:** lmstudio, ollama, openai-compatible (if key optional)
- **Context Limits:** Per-model in `MODEL_CONTEXT_LIMITS`; overridable for openai-compatible

## Recent Changes (This Merge)

- Merged `main` branch into `ria_custom`
- **Resolved conflicts:**
  - Combined custom model support with openai-compatible context limit override
  - Both features now coexist in agent, transport, and settings layers
- **Build:** TypeScript & Vite, targets modern browsers + Tauri desktop

## Development Notes

- **Agent System:** `runAgentStream()` orchestrates LLM calls with tools
- **State:** Zustand stores for chat, settings, todos, planning
- **Transport:** Context-aware wrapper injects env (cwd, workspace, file) into messages
- **Settings:** Persisted via Tauri store plugin (not in keychain)

## Testing

```bash
pnpm test           # Run tests once
pnpm test:watch     # Watch mode
```

## Tools & Scripts

- **tsc** — TypeScript type checking
- **vite** — Frontend bundler & dev server
- **tauri** — Desktop app CLI
- **vitest** — Test runner (Vite-native)
