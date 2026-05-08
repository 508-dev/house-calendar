import { existsSync, readFileSync, statSync } from "node:fs";
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

const configPathOverride =
  process.env.HOUSE_CALENDAR_CONFIG_PATH?.trim() || undefined;
const localConfigPath = resolve(
  process.cwd(),
  configPathOverride ?? "config/config.json",
);

const readAppConfig = (): AppConfig => {
  if (!existsSync(localConfigPath)) {
    if (configPathOverride) {
      throw new Error(
        `HOUSE_CALENDAR_CONFIG_PATH does not exist: ${localConfigPath}`,
      );
    }

    return appConfigSchema.parse(exampleConfig);
  }

  if (!statSync(localConfigPath).isFile()) {
    throw new Error(`App config path is not a file: ${localConfigPath}`);
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
