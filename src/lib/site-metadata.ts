import type { SiteConfig } from "@/lib/config/config";

const fallbackDescription =
  "Private house occupancy and redacted availability for trusted viewers.";

type BrandingConfig = SiteConfig["site"]["branding"];

export type SiteMetadata = {
  description: string;
  icons?: {
    apple: string;
    icon: string;
    shortcut: string;
  };
  title: string;
};

export function buildSiteMetadata(
  branding: BrandingConfig,
  fallbackTitle = "House Availability",
): SiteMetadata {
  return {
    description: branding.description ?? fallbackDescription,
    icons: branding.faviconPath
      ? {
          apple: branding.faviconPath,
          icon: branding.faviconPath,
          shortcut: branding.faviconPath,
        }
      : undefined,
    title: branding.title || fallbackTitle,
  };
}

export function buildFallbackMetadata(
  title = "House Availability",
): SiteMetadata {
  return {
    description: fallbackDescription,
    title,
  };
}
