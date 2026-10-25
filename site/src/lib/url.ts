/** Site-relative URL under the Pages base path (/umbra). */
export const base = import.meta.env.BASE_URL.replace(/\/$/, "");
export const url = (path: string) => `${base}/${path.replace(/^\//, "")}`;

export const repo = "https://github.com/AmineChr54/umbra";
export const download = `${repo}/releases/latest`;
export const docsHome = url("docs/get-started/introduction/");
