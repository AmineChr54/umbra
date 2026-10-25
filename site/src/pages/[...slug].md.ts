// Each docs page as raw Markdown at <page>.md, like Claude's docs ("View as Markdown", agents, llms-full.txt).
import type { APIRoute, GetStaticPaths } from "astro";
import { docsPages, asMarkdown } from "../lib/docs";

export const getStaticPaths: GetStaticPaths = async () =>
  (await docsPages()).map(entry => ({ params: { slug: entry.id }, props: { entry } }));

export const GET: APIRoute = ({ props }) =>
  new Response(asMarkdown(props.entry), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
