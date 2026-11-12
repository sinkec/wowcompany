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
import type * as crons from "../crons.js";
import type * as discord from "../discord.js";
import type * as events from "../events.js";
import type * as http from "../http.js";
import type * as integrations from "../integrations.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_blizzard from "../lib/blizzard.js";
import type * as lib_discordBot from "../lib/discordBot.js";
import type * as lib_discordConfig from "../lib/discordConfig.js";
import type * as lib_discordEmbed from "../lib/discordEmbed.js";
import type * as lib_humor from "../lib/humor.js";
import type * as lib_normalize from "../lib/normalize.js";
import type * as lib_players from "../lib/players.js";
import type * as lib_settings from "../lib/settings.js";
import type * as players from "../players.js";
import type * as poll from "../poll.js";
import type * as roster from "../roster.js";

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
  crons: typeof crons;
  discord: typeof discord;
  events: typeof events;
  http: typeof http;
  integrations: typeof integrations;
  "lib/access": typeof lib_access;
  "lib/blizzard": typeof lib_blizzard;
  "lib/discordBot": typeof lib_discordBot;
  "lib/discordConfig": typeof lib_discordConfig;
  "lib/discordEmbed": typeof lib_discordEmbed;
  "lib/humor": typeof lib_humor;
  "lib/normalize": typeof lib_normalize;
  "lib/players": typeof lib_players;
  "lib/settings": typeof lib_settings;
  players: typeof players;
  poll: typeof poll;
  roster: typeof roster;
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
};
