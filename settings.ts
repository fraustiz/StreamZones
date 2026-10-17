/*
Made by Fraustiz
StreamZones' settings, shared by its parts.
*/

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import type { Crop } from "./crop";
import type { LastZone } from "./mirror";

export const settings = definePluginSettings({
    showMirror: {
        type: OptionType.BOOLEAN,
        description: "Show the window that mirrors the shared zone. Hidden by default: it stays open but invisible, and closes with the stream.",
        default: false
    },
    checkForUpdates: {
        type: OptionType.BOOLEAN,
        description: "When Discord starts and every few hours, look on GitHub for a new version of StreamZones and offer to install it.",
        default: true
    },
    // the preset zone used last time, offered again when choosing a zone; null after a zone drawn by hand
    lastZone: {
        type: OptionType.CUSTOM,
        default: null as LastZone | null,
        description: ""
    },
    // how each person's stream is cropped, by user id
    crops: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, Crop>,
        description: ""
    }
});
