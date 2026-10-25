// llms.txt (https://llmstxt.org): an index of every docs page as Markdown, for AI agents.
import type { APIRoute } from "astro";
import { docsPages } from "../lib/docs";

export const GET: APIRoute = async ({ site }) => {
  const pages = await docsPages();
  const sections = new Map<string, string[]>();
  for (const e of pages) {
    const group = e.id.split("/")[1] ?? "docs";
    const line = `- [${e.data.title}](${new URL(`/umbra/${e.id}.md`, site).href})${e.data.description ? `: ${e.data.description}` : ""}`;
    sections.set(group, [...(sections.get(group) ?? []), line]);
  }
  const titles: Record<string, string> = {
    "get-started": "Get started", using: "Using Umbra", widgets: "Build widgets", themes: "Themes",
    automate: "Automate (CLI, MCP, control protocol)", internals: "Internals", reference: "Reference",
  };
  const body = `# Umbra

> Open-source Windows desktop widgets: small sandboxed web pages (HTML/CSS/JS in WebView2) pinned to the wallpaper by a C# .NET 10 host. Scriptable through \`umbractl\` and an MCP server, so AI agents can configure and build widgets.

Every page below is plain Markdown. The whole documentation in one file: ${new URL("/umbra/llms-full.txt", site).href}

${[...sections].map(([g, lines]) => `## ${titles[g] ?? g}\n\n${lines.join("\n")}`).join("\n\n")}

## Source

- [Repository](https://github.com/AmineChr54/umbra)
- [widget.json schema](https://raw.githubusercontent.com/AmineChr54/umbra/main/schemas/widget.schema.json)
- [CLAUDE.md](https://github.com/AmineChr54/umbra/blob/main/CLAUDE.md): architecture, commands and security invariants for coding agents
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
