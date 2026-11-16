/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as bot from "../bot.js";
import type * as claims from "../claims.js";
import type * as companion from "../companion.js";
import type * as companionHttp from "../companionHttp.js";
import type * as crons from "../crons.js";
import type * as diagnostics from "../diagnostics.js";
import type * as discord from "../discord.js";
import type * as dungeonMaps from "../dungeonMaps.js";
import type * as events from "../events.js";
import type * as http from "../http.js";
import type * as integrations from "../integrations.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_blizzard from "../lib/blizzard.js";
import type * as lib_companion from "../lib/companion.js";
import type * as lib_companionSchema from "../lib/companionSchema.js";
import type * as lib_discordBot from "../lib/discordBot.js";
import type * as lib_discordConfig from "../lib/discordConfig.js";
import type * as lib_discordEmbed from "../lib/discordEmbed.js";
import type * as lib_discordRuns from "../lib/discordRuns.js";
import type * as lib_humor from "../lib/humor.js";
import type * as lib_items from "../lib/items.js";
import type * as lib_news from "../lib/news.js";
import type * as lib_normalize from "../lib/normalize.js";
import type * as lib_parses from "../lib/parses.js";
import type * as lib_parsesDb from "../lib/parsesDb.js";
import type * as lib_players from "../lib/players.js";
import type * as lib_pools from "../lib/pools.js";
import type * as lib_profile from "../lib/profile.js";
import type * as lib_realms from "../lib/realms.js";
import type * as lib_runsView from "../lib/runsView.js";
import type * as lib_same from "../lib/same.js";
import type * as lib_settings from "../lib/settings.js";
import type * as lib_siteContent from "../lib/siteContent.js";
import type * as news from "../news.js";
import type * as players from "../players.js";
import type * as poll from "../poll.js";
import type * as profile from "../profile.js";
import type * as realms from "../realms.js";
import type * as roster from "../roster.js";
import type * as runs from "../runs.js";
import type * as seasons from "../seasons.js";
import type * as site from "../site.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auth: typeof auth;
  bot: typeof bot;
  claims: typeof claims;
  companion: typeof companion;
  companionHttp: typeof companionHttp;
  crons: typeof crons;
  diagnostics: typeof diagnostics;
  discord: typeof discord;
  dungeonMaps: typeof dungeonMaps;
  events: typeof events;
  http: typeof http;
  integrations: typeof integrations;
  "lib/access": typeof lib_access;
  "lib/blizzard": typeof lib_blizzard;
  "lib/companion": typeof lib_companion;
  "lib/companionSchema": typeof lib_companionSchema;
  "lib/discordBot": typeof lib_discordBot;
  "lib/discordConfig": typeof lib_discordConfig;
  "lib/discordEmbed": typeof lib_discordEmbed;
  "lib/discordRuns": typeof lib_discordRuns;
  "lib/humor": typeof lib_humor;
  "lib/items": typeof lib_items;
  "lib/news": typeof lib_news;
  "lib/normalize": typeof lib_normalize;
  "lib/parses": typeof lib_parses;
  "lib/parsesDb": typeof lib_parsesDb;
  "lib/players": typeof lib_players;
  "lib/pools": typeof lib_pools;
  "lib/profile": typeof lib_profile;
  "lib/realms": typeof lib_realms;
  "lib/runsView": typeof lib_runsView;
  "lib/same": typeof lib_same;
  "lib/settings": typeof lib_settings;
  "lib/siteContent": typeof lib_siteContent;
  news: typeof news;
  players: typeof players;
  poll: typeof poll;
  profile: typeof profile;
  realms: typeof realms;
  roster: typeof roster;
  runs: typeof runs;
  seasons: typeof seasons;
  site: typeof site;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
