import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  MODELS,
  PROVIDERS,
  customModelToInfo,
  getAutocompleteEligibleModels,
  getModel,
  getProvider,
  makeCustomModelId,
  providerNeedsKey,
  providerSupportsKey,
  type CustomModel,
  type ModelId,
  type ProviderId,
} from "@/modules/ai/config";
import { clearKey, getAllKeys, setKey } from "@/modules/ai/lib/keyring";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  emitKeysChanged,
  setAutocompleteEnabled,
  setAutocompleteModelId,
  setAutocompleteProvider,
  setCustomModels,
  setDefaultModel,
  setLmstudioBaseURL,
  setLmstudioModelId,
  setOllamaBaseURL,
  setOllamaModelId,
  setOpenaiCompatibleBaseURL,
  setOpenaiCompatibleModelId,
} from "@/modules/settings/store";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
  Cancel01Icon,
  Add01Icon,
  Delete02Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";
import { ProviderIcon } from "../components/ProviderIcon";
import { ProviderKeyCard } from "../components/ProviderKeyCard";
import { SectionHeader } from "../components/SectionHeader";

type KeysMap = Record<ProviderId, string | null>;

export function ModelsSection() {
  const [keys, setKeys] = useState<KeysMap | null>(null);
  const defaultModel = usePreferencesStore((s) => s.defaultModelId);
  const customModels = usePreferencesStore((s) => s.customModels);
  const lmstudioModelId = usePreferencesStore((s) => s.lmstudioModelId);
  const openaiCompatModelId = usePreferencesStore(
    (s) => s.openaiCompatibleModelId,
  );

  useEffect(() => {
    void getAllKeys().then(setKeys);
  }, []);

  const onSave = async (provider: ProviderId, value: string) => {
    await setKey(provider, value);
    setKeys((prev) => (prev ? { ...prev, [provider]: value } : prev));
    await emitKeysChanged();
  };

  const onClear = async (provider: ProviderId) => {
    await clearKey(provider);
    setKeys((prev) => (prev ? { ...prev, [provider]: null } : prev));
    await emitKeysChanged();
  };

  if (!keys) {
    return <div className="text-[12px] text-muted-foreground">Loading…</div>;
  }

  const cloudProviders = PROVIDERS.filter(
    (p) =>
      providerNeedsKey(p.id) && p.id !== "lmstudio" && p.id !== "openai-compatible",
  );
  const configuredCount = cloudProviders.filter((p) => !!keys[p.id]).length;

  return (
    <div className="flex flex-col gap-7">
      <SectionHeader
        title="Models"
        description="Bring your own keys. They live in your OS keychain and are used only by Terax."
      />

      <DefaultModelBlock
        defaultModel={defaultModel}
        keys={keys}
        customModels={customModels}
        lmstudioModelId={lmstudioModelId}
        openaiCompatModelId={openaiCompatModelId}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <Label>Cloud providers</Label>
          <span className="text-[10.5px] text-muted-foreground">
            {configuredCount} of {cloudProviders.length} configured
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {cloudProviders.map((p) => (
            <ProviderKeyCard
              key={p.id}
              provider={p}
              currentKey={keys[p.id]}
              onSave={(v) => onSave(p.id, v)}
              onClear={() => onClear(p.id)}
            />
          ))}
        </div>
      </div>

      <LocalModelsBlock />

      <OllamaBlock />

      <CustomModelsBlock />

      <OpenAICompatibleBlock
        compatKey={keys["openai-compatible"]}
        onSaveKey={(v) => onSave("openai-compatible", v)}
        onClearKey={() => onClear("openai-compatible")}
      />

      <AutocompleteBlock keys={keys} />
    </div>
  );
}

function DefaultModelBlock({
  defaultModel,
  keys,
  customModels,
  lmstudioModelId,
  openaiCompatModelId,
}: {
  defaultModel: ModelId | string;
  keys: KeysMap;
  customModels: CustomModel[];
  lmstudioModelId: string;
  openaiCompatModelId: string;
}) {
  const customInfos = customModels.map(customModelToInfo);
  const m =
    customInfos.find((c) => c.id === defaultModel) ??
    MODELS.find((x) => x.id === defaultModel) ??
    getModel("gpt-5.4-mini");

  const isAvailable = (modelId: string, providerId: ProviderId): boolean => {
    if (modelId.startsWith("custom:")) {
      const c = customModels.find((x) => x.id === modelId);
      return !!c?.remoteModelId.trim();
    }
    if (modelId === "lmstudio-local") return !!lmstudioModelId.trim();
    if (modelId === "ollama-local")
      return !!usePreferencesStore.getState().ollamaModelId.trim();
    if (modelId === "openai-compatible-custom")
      return !!openaiCompatModelId.trim();
    return providerNeedsKey(providerId) ? !!keys[providerId] : true;
  };

  return (
    <div className="flex flex-col gap-2">
      <Label>Default model</Label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="h-9 justify-between gap-2 px-2.5 text-[12px]"
          >
            <span className="flex items-center gap-2">
              <ProviderIcon provider={m.provider} size={14} />
              <span>{m.label}</span>
              <span className="text-muted-foreground">· {m.hint}</span>
            </span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={12}
              strokeWidth={2}
              className="opacity-70"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          sideOffset={6}
          avoidCollisions={false}
          className="min-w-[280px] p-1"
        >
          <div className="max-h-[240px] overflow-y-auto overscroll-contain pr-1">
            {PROVIDERS.map((p) => {
              const models = [
                ...MODELS.filter((x) => x.provider === p.id),
                ...customInfos.filter((x) => x.provider === p.id),
              ];
              if (models.length === 0) return null;
              const hasKey = providerNeedsKey(p.id) ? !!keys[p.id] : true;
              return (
                <div key={p.id} className="px-1 pt-1.5 first:pt-1">
                  <div className="mb-0.5 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    <ProviderIcon provider={p.id} size={11} />
                    <span>{p.label}</span>
                    {!hasKey ? (
                      <span className="ml-auto text-[9.5px] normal-case tracking-normal text-muted-foreground/70">
                        no key
                      </span>
                    ) : null}
                  </div>
                  {models.map((mod) => {
                    const available = isAvailable(mod.id, p.id);
                    return (
                      <DropdownMenuItem
                        key={mod.id}
                        disabled={!available}
                        onSelect={() =>
                          available && void setDefaultModel(mod.id as ModelId)
                        }
                        className={cn(
                          "flex items-start gap-2 text-[12px]",
                          mod.id === defaultModel && "bg-accent/50",
                        )}
                      >
                        <span className="flex flex-1 flex-col">
                          <span>{mod.label}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {mod.description}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function LocalModelsBlock() {
  const baseURL = usePreferencesStore((s) => s.lmstudioBaseURL);
  const modelId = usePreferencesStore((s) => s.lmstudioModelId);
  const [urlDraft, setUrlDraft] = useState(baseURL);
  const [modelDraft, setModelDraft] = useState(modelId);
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "ok" | "fail"
  >("idle");

  useEffect(() => setUrlDraft(baseURL), [baseURL]);
  useEffect(() => setModelDraft(modelId), [modelId]);

  const dirty =
    urlDraft.trim() !== baseURL || modelDraft.trim() !== modelId;

  const save = async () => {
    const u = urlDraft.trim();
    const m = modelDraft.trim();
    if (u && u !== baseURL) await setLmstudioBaseURL(u);
    if (m !== modelId) await setLmstudioModelId(m);
  };

  const test = async () => {
    setTestStatus("testing");
    try {
      const status = await invoke<number>("lm_ping", {
        baseUrl: urlDraft,
      });
      setTestStatus(status > 0 ? "ok" : "fail");
    } catch {
      setTestStatus("fail");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <Label>Local — LM Studio</Label>
        <span className="text-[10.5px] leading-relaxed text-muted-foreground">
          Run any GGUF model on your machine via LM Studio's HTTP server. Enable
          the server in LM Studio → Developer tab.
        </span>
      </div>

      <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
        <FieldRow label="Base URL">
          <div className="flex flex-1 gap-1.5">
            <Input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onBlur={() => {
                const v = urlDraft.trim();
                if (v && v !== baseURL) void setLmstudioBaseURL(v);
              }}
              placeholder="http://localhost:1234/v1"
              spellCheck={false}
              className="h-8 flex-1 font-mono text-[11.5px]"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void test()}
              disabled={!urlDraft.trim()}
              className="h-8 px-3 text-[11px]"
            >
              Test
            </Button>
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={!dirty}
              className="h-8 px-3 text-[11px]"
            >
              Save
            </Button>
          </div>
        </FieldRow>

        <FieldRow label="Model ID">
          <Input
            value={modelDraft}
            onChange={(e) => setModelDraft(e.target.value)}
            onBlur={() => {
              const v = modelDraft.trim();
              if (v !== modelId) void setLmstudioModelId(v);
            }}
            placeholder="qwen2.5-coder-7b-instruct"
            spellCheck={false}
            className="h-8 font-mono text-[11.5px]"
          />
        </FieldRow>

        <StatusLine status={testStatus} />

        {!modelId.trim() ? (
          <p className="text-[10.5px] leading-relaxed text-amber-600 dark:text-amber-400">
            Enter the model id that's loaded in LM Studio — e.g. the one shown
            on the server's <span className="font-mono">/v1/models</span> page.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function OllamaBlock() {
  const baseURL = usePreferencesStore((s) => s.ollamaBaseURL);
  const modelId = usePreferencesStore((s) => s.ollamaModelId);
  const [urlDraft, setUrlDraft] = useState(baseURL);
  const [modelDraft, setModelDraft] = useState(modelId);
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "ok" | "fail"
  >("idle");
  const [tags, setTags] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);

  useEffect(() => setUrlDraft(baseURL), [baseURL]);
  useEffect(() => setModelDraft(modelId), [modelId]);

  const dirty = urlDraft.trim() !== baseURL || modelDraft.trim() !== modelId;

  const save = async () => {
    const u = urlDraft.trim();
    const m = modelDraft.trim();
    if (u && u !== baseURL) await setOllamaBaseURL(u);
    if (m !== modelId) await setOllamaModelId(m);
  };

  const test = async () => {
    setTestStatus("testing");
    try {
      const status = await invoke<number>("lm_ping", { baseUrl: urlDraft });
      setTestStatus(status > 0 ? "ok" : "fail");
    } catch {
      setTestStatus("fail");
    }
  };

  const fetchTags = async () => {
    setLoadingTags(true);
    try {
      const list = await invoke<string[]>("ollama_tags", {
        baseUrl: urlDraft,
      });
      setTags(list);
    } catch {
      setTags([]);
    } finally {
      setLoadingTags(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <Label>Local — Ollama</Label>
        <span className="text-[10.5px] leading-relaxed text-muted-foreground">
          Run models locally with <span className="font-mono">ollama serve</span>{" "}
          — Gemma, Llama, Qwen, etc. Pull one first, e.g.{" "}
          <span className="font-mono">ollama pull gemma3</span>.
        </span>
      </div>

      <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
        <FieldRow label="Base URL">
          <div className="flex flex-1 gap-1.5">
            <Input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onBlur={() => {
                const v = urlDraft.trim();
                if (v && v !== baseURL) void setOllamaBaseURL(v);
              }}
              placeholder="http://localhost:11434/v1"
              spellCheck={false}
              className="h-8 flex-1 font-mono text-[11.5px]"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void test()}
              disabled={!urlDraft.trim()}
              className="h-8 px-3 text-[11px]"
            >
              Test
            </Button>
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={!dirty}
              className="h-8 px-3 text-[11px]"
            >
              Save
            </Button>
          </div>
        </FieldRow>

        <FieldRow label="Model ID">
          <div className="flex flex-1 gap-1.5">
            <Input
              value={modelDraft}
              onChange={(e) => setModelDraft(e.target.value)}
              onBlur={() => {
                const v = modelDraft.trim();
                if (v !== modelId) void setOllamaModelId(v);
              }}
              placeholder="gemma3, llama3.2, qwen2.5-coder:7b, …"
              spellCheck={false}
              className="h-8 flex-1 font-mono text-[11.5px]"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void fetchTags()}
              disabled={!urlDraft.trim() || loadingTags}
              className="h-8 gap-1.5 px-2.5 text-[11px]"
              title="List installed Ollama models"
            >
              <HugeiconsIcon icon={RefreshIcon} size={12} strokeWidth={2} />
              {loadingTags ? "…" : "Installed"}
            </Button>
          </div>
        </FieldRow>

        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pl-[76px]">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setModelDraft(t);
                  void setOllamaModelId(t);
                }}
                className={cn(
                  "rounded border border-border/60 px-2 py-0.5 font-mono text-[10.5px] transition-colors hover:bg-accent",
                  t === modelId && "bg-accent/60",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        ) : null}

        <StatusLine status={testStatus} />

        {!modelId.trim() ? (
          <p className="text-[10.5px] leading-relaxed text-amber-600 dark:text-amber-400">
            Set the model id you pulled in Ollama. Click{" "}
            <span className="font-medium">Installed</span> to list what's
            available, then pick the default model in the block above.
          </p>
        ) : null}
      </div>
    </div>
  );
}

const CUSTOM_PROVIDERS = [
  { id: "ollama", label: "Ollama (local)" },
  { id: "lmstudio", label: "LM Studio (local)" },
  { id: "openai-compatible", label: "OpenAI-compatible endpoint" },
] as const;

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "model"
  );
}

function CustomModelsBlock() {
  const customModels = usePreferencesStore((s) => s.customModels);
  const [label, setLabel] = useState("");
  const [remoteId, setRemoteId] = useState("");
  const [provider, setProvider] =
    useState<CustomModel["provider"]>("ollama");

  const add = async () => {
    const l = label.trim();
    const r = remoteId.trim();
    if (!l || !r) return;
    let slug = slugify(l);
    const taken = new Set(customModels.map((c) => c.id));
    let id = makeCustomModelId(slug);
    let n = 2;
    while (taken.has(id)) id = makeCustomModelId(`${slug}-${n++}`);
    const next: CustomModel[] = [
      ...customModels,
      { id, label: l, provider, remoteModelId: r },
    ];
    await setCustomModels(next);
    setLabel("");
    setRemoteId("");
  };

  const remove = async (id: string) => {
    await setCustomModels(customModels.filter((c) => c.id !== id));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <Label>Custom models</Label>
        <span className="text-[10.5px] leading-relaxed text-muted-foreground">
          Register any model id (e.g.{" "}
          <span className="font-mono">mimo-v2.5-pro</span>,{" "}
          <span className="font-mono">glm-4.6</span>) against a local server or
          an OpenAI-compatible endpoint. It appears in the model picker.
        </span>
      </div>

      <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
        {customModels.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {customModels.map((c) => {
              const info = customModelToInfo(c);
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded border border-border/50 bg-background/40 px-2.5 py-1.5"
                >
                  <div className="flex flex-1 flex-col">
                    <span className="text-[11.5px]">{c.label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {info.description}
                    </span>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => void remove(c.id)}
                    title="Remove"
                    className="size-7 text-muted-foreground hover:text-destructive"
                  >
                    <HugeiconsIcon
                      icon={Delete02Icon}
                      size={12}
                      strokeWidth={1.75}
                    />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}

        <FieldRow label="Name">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="MiMo v2.5 Pro"
            spellCheck={false}
            className="h-8 flex-1 text-[11.5px]"
          />
        </FieldRow>

        <FieldRow label="Model ID">
          <Input
            value={remoteId}
            onChange={(e) => setRemoteId(e.target.value)}
            placeholder="mimo-v2.5-pro"
            spellCheck={false}
            className="h-8 flex-1 font-mono text-[11.5px]"
          />
        </FieldRow>

        <FieldRow label="Served by">
          <div className="flex flex-1 items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="h-8 flex-1 justify-between gap-2 px-2.5 text-[11.5px]"
                >
                  <span>
                    {CUSTOM_PROVIDERS.find((p) => p.id === provider)?.label}
                  </span>
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    size={11}
                    strokeWidth={2}
                    className="opacity-70"
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[240px]">
                {CUSTOM_PROVIDERS.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onSelect={() => setProvider(p.id)}
                    className="text-[11.5px]"
                  >
                    {p.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              onClick={() => void add()}
              disabled={!label.trim() || !remoteId.trim()}
              className="h-8 gap-1.5 px-3 text-[11px]"
            >
              <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={2} />
              Add
            </Button>
          </div>
        </FieldRow>

        <p className="text-[10.5px] leading-relaxed text-muted-foreground">
          For local providers, configure the base URL in the Ollama / LM Studio
          block above. For an OpenAI-compatible endpoint, set its URL & key in
          the block below.
        </p>
      </div>
    </div>
  );
}

function OpenAICompatibleBlock({
  compatKey,
  onSaveKey,
  onClearKey,
}: {
  compatKey: string | null;
  onSaveKey: (v: string) => Promise<void>;
  onClearKey: () => Promise<void>;
}) {
  const baseURL = usePreferencesStore((s) => s.openaiCompatibleBaseURL);
  const modelId = usePreferencesStore((s) => s.openaiCompatibleModelId);
  const [urlDraft, setUrlDraft] = useState(baseURL);
  const [modelDraft, setModelDraft] = useState(modelId);
  const [keyDraft, setKeyDraft] = useState("");
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "ok" | "fail"
  >("idle");

  useEffect(() => setUrlDraft(baseURL), [baseURL]);
  useEffect(() => setModelDraft(modelId), [modelId]);

  const dirty =
    urlDraft.trim() !== baseURL || modelDraft.trim() !== modelId;

  const save = async () => {
    const u = urlDraft.trim();
    const m = modelDraft.trim();
    if (u !== baseURL) await setOpenaiCompatibleBaseURL(u);
    if (m !== modelId) await setOpenaiCompatibleModelId(m);
  };

  const test = async () => {
    setTestStatus("testing");
    try {
      const status = await invoke<number>("lm_ping", {
        baseUrl: urlDraft,
      });
      setTestStatus(status > 0 ? "ok" : "fail");
    } catch {
      setTestStatus("fail");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <Label>OpenAI-compatible endpoint</Label>
        <span className="text-[10.5px] leading-relaxed text-muted-foreground">
          Any OpenAI-compatible HTTPS endpoint — vLLM, Z.AI, Fireworks, hosted
          Ollama, etc.
        </span>
      </div>

      <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
        <FieldRow label="Base URL">
          <div className="flex flex-1 gap-1.5">
            <Input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onBlur={() => {
                const v = urlDraft.trim();
                if (v !== baseURL) void setOpenaiCompatibleBaseURL(v);
              }}
              placeholder="https://api.example.com/v1"
              spellCheck={false}
              className="h-8 flex-1 font-mono text-[11.5px]"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void test()}
              disabled={!urlDraft.trim()}
              className="h-8 px-3 text-[11px]"
            >
              Test
            </Button>
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={!dirty}
              className="h-8 px-3 text-[11px]"
            >
              Save
            </Button>
          </div>
        </FieldRow>

        <FieldRow label="Model ID">
          <Input
            value={modelDraft}
            onChange={(e) => setModelDraft(e.target.value)}
            onBlur={() => {
              const v = modelDraft.trim();
              if (v !== modelId) void setOpenaiCompatibleModelId(v);
            }}
            placeholder="gpt-4o, qwen3-max, glm-4.6, …"
            spellCheck={false}
            className="h-8 font-mono text-[11.5px]"
          />
        </FieldRow>

        <FieldRow label="API key">
          {compatKey ? (
            <div className="flex flex-1 items-center gap-1.5">
              <code className="flex-1 truncate rounded bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                {`${compatKey.slice(0, 4)}${"•".repeat(8)}${compatKey.slice(-4)}`}
              </code>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void onClearKey()}
                title="Remove"
                className="size-7 text-muted-foreground hover:text-destructive"
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  size={12}
                  strokeWidth={1.75}
                />
              </Button>
            </div>
          ) : (
            <div className="flex flex-1 gap-1.5">
              <Input
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="Optional — leave empty for unauthenticated endpoints"
                spellCheck={false}
                className="h-8 flex-1 font-mono text-[11.5px]"
              />
              <Button
                size="sm"
                onClick={async () => {
                  const v = keyDraft.trim();
                  if (!v) return;
                  await onSaveKey(v);
                  setKeyDraft("");
                }}
                disabled={!keyDraft.trim()}
                className="h-8 px-3 text-[11px]"
              >
                Save
              </Button>
            </div>
          )}
        </FieldRow>

        <StatusLine status={testStatus} />
      </div>
    </div>
  );
}

function AutocompleteBlock({ keys }: { keys: KeysMap }) {
  const enabled = usePreferencesStore((s) => s.autocompleteEnabled);
  const provider = usePreferencesStore((s) => s.autocompleteProvider);
  const modelId = usePreferencesStore((s) => s.autocompleteModelId);
  const eligible = useMemo(() => getAutocompleteEligibleModels(), []);

  const currentModel = useMemo(
    () =>
      MODELS.find((m) => m.provider === provider && m.id === modelId) ??
      MODELS.find((m) => m.id === modelId) ??
      eligible[0],
    [eligible, provider, modelId],
  );

  const setModel = (id: string, providerId: ProviderId) => {
    void setAutocompleteProvider(providerId);
    void setAutocompleteModelId(id);
  };

  const hasKey = providerSupportsKey(provider)
    ? providerNeedsKey(provider)
      ? !!keys[provider]
      : true
    : true;

  // Group eligible models by provider for the dropdown.
  const grouped = useMemo(() => {
    const map = new Map<ProviderId, (typeof eligible)[number][]>();
    for (const m of eligible) {
      const arr = map.get(m.provider) ?? [];
      arr.push(m);
      map.set(m.provider, arr);
    }
    return map;
  }, [eligible]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Label>Editor autocomplete</Label>
          <span className="text-[10.5px] leading-relaxed text-muted-foreground">
            Inline ghost-text suggestions in the code editor. Pick a fast model
            (LPU/wafer-scale, local, or a small cloud tier).
          </span>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => void setAutocompleteEnabled(v)}
        />
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
        <FieldRow label="Model">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-8 flex-1 justify-between gap-2 px-2.5 text-[11.5px]"
              >
                <span className="flex items-center gap-2 truncate">
                  <ProviderIcon provider={currentModel.provider} size={12} />
                  <span className="truncate">{currentModel.label}</span>
                  <span className="text-muted-foreground">
                    · {currentModel.hint}
                  </span>
                </span>
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  size={11}
                  strokeWidth={2}
                  className="opacity-70"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-[24rem] min-w-[280px] overflow-y-auto"
            >
              {PROVIDERS.map((p) => {
                const list = grouped.get(p.id);
                if (!list || list.length === 0) return null;
                const pHasKey = providerNeedsKey(p.id) ? !!keys[p.id] : true;
                return (
                  <div key={p.id} className="px-1 pt-1.5 first:pt-1">
                    <div className="mb-0.5 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                      <ProviderIcon provider={p.id} size={11} />
                      <span>{p.label}</span>
                      {!pHasKey ? (
                        <span className="ml-auto text-[9.5px] normal-case tracking-normal text-muted-foreground/70">
                          no key
                        </span>
                      ) : null}
                    </div>
                    {list.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        disabled={!pHasKey}
                        onSelect={() => pHasKey && setModel(m.id, p.id)}
                        className={cn(
                          "text-[11.5px]",
                          m.id === modelId && "bg-accent/50",
                        )}
                      >
                        <span className="flex flex-col">
                          <span>{m.label}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {m.description}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </div>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </FieldRow>

        {!hasKey ? (
          <span className="text-[10.5px] text-amber-500">
            No API key configured for {getProvider(provider).label}. Add one
            above.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-[11px] tracking-tight text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-1 items-center">{children}</div>
    </div>
  );
}

function StatusLine({
  status,
}: {
  status: "idle" | "testing" | "ok" | "fail";
}) {
  if (status === "idle") return null;
  if (status === "testing") {
    return (
      <span className="text-[10.5px] text-muted-foreground">Testing…</span>
    );
  }
  if (status === "ok") {
    return (
      <span className="flex items-center gap-1 text-[10.5px] text-emerald-600 dark:text-emerald-400">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={11} strokeWidth={2} />
        Reachable — server responded.
      </span>
    );
  }
  return (
    <span className="text-[10.5px] text-destructive">
      Could not reach the server.
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}
