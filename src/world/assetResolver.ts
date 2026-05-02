declare global {
  interface Window {
    __CITY_SANDBOX_ASSETS__?: Record<string, string>;
  }
}

export function resolveAssetUrl(url: string): string {
  const embeddedAssets = window.__CITY_SANDBOX_ASSETS__;

  if (!embeddedAssets) {
    return url;
  }

  const normalizedUrl = url.startsWith("/") ? url : `/${url}`;
  return embeddedAssets[normalizedUrl] ?? url;
}

