// All docs pages concatenated as Markdown, for agents that want the whole manual in one request.
import type { APIRoute } from "astro";
import { docsPages, asMarkdown } from "../lib/docs";

export const GET: APIRoute = async () =>
  new Response((await docsPages()).map(asMarkdown).join("\n---\n\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
