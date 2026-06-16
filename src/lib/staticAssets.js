export function getStaticAssetUrl(assetPath, baseUrl = getDefaultBaseUrl()) {
  const path = String(assetPath || "").replace(/^\/+/, "");
  const base = String(baseUrl || "/");
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}${path}`;
}

function getDefaultBaseUrl() {
  return import.meta.env?.BASE_URL || "/";
}
