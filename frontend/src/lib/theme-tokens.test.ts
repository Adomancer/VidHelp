import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type TokenMap = Record<string, string>;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseBlock(css: string, selectorRegex: RegExp): TokenMap {
  const match = selectorRegex.exec(css);
  if (!match) {
    throw new Error(`Selector block not found for ${selectorRegex}`);
  }
  const tokens: TokenMap = {};
  for (const rawLine of match[1].split(";")) {
    const line = rawLine.trim();
    if (!line.startsWith("--")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    tokens[name] = value;
  }
  return tokens;
}

function parseHex(hex: string): [number, number, number] {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Expected 6-digit hex color, got "${hex}"`);
  }
  return [parseInt(normalized.slice(0, 2), 16), parseInt(normalized.slice(2, 4), 16), parseInt(normalized.slice(4, 6), 16)];
}

function blendOver(fgHex: string, bgHex: string, alpha: number): string {
  const [fr, fg, fb] = parseHex(fgHex);
  const [br, bg, bb] = parseHex(bgHex);
  const mix = (f: number, b: number) =>
    Math.round(f * alpha + b * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  return `#${mix(fr, br)}${mix(fg, bg)}${mix(fb, bb)}`;
}

function relativeLuminance(hex: string): number {
  const channels = parseHex(hex).map((value) => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relativeLuminance(fgHex);
  const l2 = relativeLuminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const globalsCssPath = [resolve(process.cwd(), "src/app/globals.css"), resolve(process.cwd(), "frontend/src/app/globals.css")].find((candidate) =>
  existsSync(candidate)
);
if (!globalsCssPath) {
  throw new Error(`Could not locate src/app/globals.css from ${process.cwd()}`);
}
const css = stripComments(readFileSync(globalsCssPath, "utf8"));
const lightTokens = parseBlock(css, /^\s*:root\s*\{([^}]*)\}/m);
const darkTokens = parseBlock(css, /^\s*\.dark\s*\{([^}]*)\}/m);

function buildPairs(tokens: TokenMap): Array<[string, string, string]> {
  return [
    ["foreground on card", tokens["--foreground"], tokens["--card"]],
    ["foreground on background", tokens["--foreground"], tokens["--background"]],
    ["body on card", tokens["--body"], tokens["--card"]],
    ["body on secondary", tokens["--body"], tokens["--secondary"]],
    ["muted-foreground on card", tokens["--muted-foreground"], tokens["--card"]],
    ["muted-foreground on muted", tokens["--muted-foreground"], tokens["--muted"]],
    ["muted-foreground on background", tokens["--muted-foreground"], tokens["--background"]],
    ["faint on card", tokens["--faint"], tokens["--card"]],
    ["faint on background", tokens["--faint"], tokens["--background"]],
    ["faint on sidebar", tokens["--faint"], tokens["--sidebar"]],
    ["primary-foreground on primary", tokens["--primary-foreground"], tokens["--primary"]],
    ["primary-foreground on primary-hover", tokens["--primary-foreground"], tokens["--primary-hover"]],
    ["brand on card", tokens["--brand"], tokens["--card"]],
    ["brand on primary/10", tokens["--brand"], blendOver(tokens["--primary"], tokens["--card"], 0.1)],
    ["brand on primary/12", tokens["--brand"], blendOver(tokens["--primary"], tokens["--card"], 0.12)],
    ["brand on primary/15 (sidebar)", tokens["--brand"], blendOver(tokens["--primary"], tokens["--sidebar"], 0.15)],
    ["success on card", tokens["--success"], tokens["--card"]],
    ["success on success-subtle", tokens["--success"], tokens["--success-subtle"]],
    ["success on success/10", tokens["--success"], blendOver(tokens["--success"], tokens["--card"], 0.1)],
    ["warning on card", tokens["--warning"], tokens["--card"]],
    ["warning on warning-subtle", tokens["--warning"], tokens["--warning-subtle"]],
    ["warning on warning/12", tokens["--warning"], blendOver(tokens["--warning"], tokens["--card"], 0.12)],
    ["destructive on card", tokens["--destructive"], tokens["--card"]],
    ["destructive on destructive-subtle", tokens["--destructive"], tokens["--destructive-subtle"]],
    ["destructive on destructive/10", tokens["--destructive"], blendOver(tokens["--destructive"], tokens["--card"], 0.1)],
    ["info on card", tokens["--info"], tokens["--card"]],
    ["info on info-subtle", tokens["--info"], tokens["--info-subtle"]],
    ["info on info/10", tokens["--info"], blendOver(tokens["--info"], tokens["--card"], 0.1)],
    ["white on destructive-solid", "#ffffff", tokens["--destructive-solid"]],
    ["white on destructive-solid-hover", "#ffffff", tokens["--destructive-solid-hover"]],
    ["sidebar-foreground on sidebar", tokens["--sidebar-foreground"], tokens["--sidebar"]],
    ["sidebar-accent-foreground on sidebar-accent", tokens["--sidebar-accent-foreground"], tokens["--sidebar-accent"]],
  ];
}

describe("theme design tokens", () => {
  it("defines exact token parity between :root (light) and .dark", () => {
    expect(Object.keys(lightTokens).sort()).toEqual(Object.keys(darkTokens).sort());
  });

  it("meets WCAG 2.1 AA (>= 4.5:1) for all light mode text/surface pairs", () => {
    for (const [label, fg, bg] of buildPairs(lightTokens)) {
      const ratio = contrastRatio(fg, bg);
      expect(ratio, `Light mode "${label}" (${fg} on ${bg}) was ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("meets WCAG 2.1 AA (>= 4.5:1) for all dark mode text/surface pairs", () => {
    for (const [label, fg, bg] of buildPairs(darkTokens)) {
      const ratio = contrastRatio(fg, bg);
      expect(ratio, `Dark mode "${label}" (${fg} on ${bg}) was ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
