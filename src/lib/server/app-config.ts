import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cache } from "react";
import {
  type AppCalendar,
  type AppConfig,
  appConfigSchema,
  configToHouseConfig,
  getDefaultSiteId,
  getSiteConfig,
} from "@/lib/config/config";
import exampleConfig from "../../../config/config.example.json";

const localConfigPath = resolve(process.cwd(), "config/config.json");

const readAppConfig = (): AppConfig => {
  if (!existsSync(localConfigPath)) {
    return appConfigSchema.parse(exampleConfig);
  }

  return appConfigSchema.parse(
    JSON.parse(readFileSync(localConfigPath, "utf8")),
  );
};

export const loadAppConfig = cache(
  async (): Promise<AppConfig> => readAppConfig(),
);

export async function loadSiteConfig(siteId?: string) {
  const config = await loadAppConfig();
  const resolvedSiteId = siteId ?? getDefaultSiteId(config);
  return getSiteConfig(config, resolvedSiteId);
}

export async function loadHouseConfig(siteId?: string) {
  const siteConfig = await loadSiteConfig(siteId);

  if (!siteConfig) {
    return null;
  }

  return configToHouseConfig(siteConfig);
}

export function resolveCalendarUrl(calendar: AppCalendar): string | null {
  if ("url" in calendar) {
    return calendar.url;
  }

  return process.env[calendar.envVar] ?? null;
}
