/*
Made by Fraustiz
StreamZones: zones in Discord screen shares, both ways.

- Share only a zone of your screen, with the system's sound: a Zone tab in the screen share picker
  (zoneShare.tsx, with the windows in mirror.ts).
- Crop the screen shares you watch to a format, e.g. one screen out of a triple-monitor stream
  (streamCrop.tsx).
- When its folder is a git clone of its GitHub repository, offer to install new versions (updates.tsx).
*/

import { migratePluginSettings, Settings } from "@api/Settings";
import definePlugin from "@utils/types";

import { settings } from "./settings";
import { startStreamCrop, stopStreamCrop, streamContextPatch, streamCropMembers, streamCropPatches } from "./streamCrop";
import { startUpdateChecks, stopUpdateChecks } from "./updates";
import { stopZoneShare, zoneShareFlux, zoneShareMembers, zoneSharePatches } from "./zoneShare";

// StreamZones replaces two earlier plugins, ZoneShare and StreamCrop: keep what they had saved
migratePluginSettings("StreamZones", "ZoneShare");

function adoptStreamCropSettings() {
    const { crops } = Settings.plugins.StreamCrop ?? {};
    if (crops && Object.keys(crops).length && !Object.keys(settings.store.crops).length)
        settings.store.crops = { ...crops };
}

export default definePlugin({
    name: "StreamZones",
    description: "Zones in screen shares: share only a zone of your screen (Zone tab in the share picker), and crop the streams you watch (right click > Recadrer).",
    authors: [{ name: "Fraustiz", id: 457057429557870603n }],
    settings,

    patches: [...zoneSharePatches, ...streamCropPatches],
    contextMenus: {
        "stream-context": streamContextPatch
    },
    flux: zoneShareFlux,

    ...zoneShareMembers,
    ...streamCropMembers,

    start() {
        adoptStreamCropSettings();
        startStreamCrop();
        startUpdateChecks();
    },

    stop() {
        stopUpdateChecks();
        stopStreamCrop();
        stopZoneShare();
    }
});
