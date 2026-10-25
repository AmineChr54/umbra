// Repo data written by scripts/sync.mjs (widgets/index.json, themes/index.json, Directory.Build.props).
import site from "../data/site.json";

export interface Widget {
  id: string; name: string; description: string; author: string; version: string;
  hosts?: string[]; commands?: { run: string }[]; previewSize: { w: number; h: number } | null;
}
export interface Theme { id: string; name: string; description: string; author: string; tokens: Record<string, string> }

export const version: string = site.version;
export const widgets = site.widgets as unknown as Widget[];
export const themes = site.themes as unknown as Theme[];
export const byId = (id: string) => widgets.find(w => w.id === id);

/** What a widget can reach: drives the catalog badges and filters. */
export const kindOf = (w: Widget) => (w.commands ?? []).length ? "commands" : (w.hosts ?? []).length ? "online" : "offline";
