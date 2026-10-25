import { getCollection, type CollectionEntry } from "astro:content";

/** Every docs page in sidebar order (group order from astro.config.mjs, then `sidebar.order`, then title). */
const groups = ["get-started", "using", "widgets", "themes", "automate", "internals", "reference"];
export async function docsPages(): Promise<CollectionEntry<"docs">[]> {
  const rank = (e: CollectionEntry<"docs">) => groups.indexOf(e.id.split("/")[1] ?? "");
  return (await getCollection("docs")).sort((a, b) =>
    rank(a) - rank(b) || (a.data.sidebar?.order ?? 50) - (b.data.sidebar?.order ?? 50) || a.data.title.localeCompare(b.data.title));
}

/** A page as standalone Markdown: title, description and source body. */
export const asMarkdown = (e: CollectionEntry<"docs">) =>
  `# ${e.data.title}\n\n${e.data.description ? `> ${e.data.description}\n\n` : ""}${(e.body ?? "").trim()}\n`;

export const pageUrl = (site: URL | undefined, e: CollectionEntry<"docs">) => new URL(`/umbra/${e.id}/`, site).href;
