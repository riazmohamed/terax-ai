export const TERMINAL_PANE_COLORS = [
  { id: "red", label: "Red", value: "#f87171" },
  { id: "orange", label: "Orange", value: "#fb923c" },
  { id: "yellow", label: "Yellow", value: "#facc15" },
  { id: "green", label: "Green", value: "#4ade80" },
  { id: "cyan", label: "Cyan", value: "#22d3ee" },
  { id: "blue", label: "Blue", value: "#60a5fa" },
  { id: "purple", label: "Purple", value: "#a78bfa" },
  { id: "pink", label: "Pink", value: "#f472b6" },
] as const;

export type TerminalPaneColorId = (typeof TERMINAL_PANE_COLORS)[number]["id"];

export function terminalPaneColorValue(
  colorId: TerminalPaneColorId | undefined,
): string | undefined {
  return TERMINAL_PANE_COLORS.find((color) => color.id === colorId)?.value;
}

export function terminalPaneBackgroundValue(
  colorId: TerminalPaneColorId | undefined,
): string | undefined {
  const color = terminalPaneColorValue(colorId);
  if (!color) return undefined;
  return mixHexColors("#050607", color, 0.28);
}

export function terminalPaneColorIdFromValue(
  value: string,
): TerminalPaneColorId | undefined {
  return TERMINAL_PANE_COLORS.find((color) => color.id === value)?.id;
}

function mixHexColors(base: string, accent: string, accentAmount: number): string {
  const baseRgb = parseHexColor(base);
  const accentRgb = parseHexColor(accent);
  if (!baseRgb || !accentRgb) return accent;
  const [baseRed, baseGreen, baseBlue] = baseRgb;
  const [accentRed, accentGreen, accentBlue] = accentRgb;
  const mix = (baseChannel: number, accentChannel: number) =>
    Math.round(baseChannel * (1 - accentAmount) + accentChannel * accentAmount);
  return `#${[
    mix(baseRed, accentRed),
    mix(baseGreen, accentGreen),
    mix(baseBlue, accentBlue),
  ]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function parseHexColor(color: string): [number, number, number] | null {
  const match = color.match(/^#([0-9a-f]{6})$/i);
  const value = match?.[1];
  if (!value) return null;
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}
