/*
Made by Fraustiz
The way from Discord's page to StreamZones' main-process side (native.ts).
*/

import { PluginNative } from "@utils/types";

export const Native = VencordNative.pluginHelpers.StreamZones as PluginNative<typeof import("./native")>;
