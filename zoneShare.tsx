/*
Made by Fraustiz
Sharing only a zone of the screen, with the system's sound.

Discord can only capture a whole screen or a whole window, so the zone is mirrored live into a
window of its own (see mirror.ts) and that window is what gets shared. The entry point is a
"Zone" tab in Discord's own share picker, next to Applications, Screens and Devices. The zone is
then drawn by hand or picked from preset formats (16:9, 21:9, 4:3) placed on the screen.
*/

import { Paragraph } from "@components/Paragraph";
import { Logger } from "@utils/Logger";
import { Alerts, showToast, UserStore } from "@webpack/common";
import type { ComponentType } from "react";

import { Native } from "./bridge";
import { settings } from "./settings";

const logger = new Logger("StreamZones");

// what the share picker hands to Discord's own "go live" function
interface StreamSource {
    id: string;
    name: string;
    url: string;
}

interface PickerTab {
    name: string;
    value: string;
    icon: ComponentType<any>;
}

const ZONE_TAB = "zone-share";
// what the stream is called in Discord's indicators
const SOURCE_NAME = "Zone";
// how long Discord gets to actually start streaming the mirror before we give up on it
const START_TIMEOUT_MS = 8000;

// native handle of the mirror window while one is open
let mirrorHandle: string | null = null;
// whether Discord is currently streaming that window
let mirrorLive = false;

function ZoneIcon({ className, color = "currentColor" }: { className?: string; color?: string; }) {
    return (
        <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
        </svg>
    );
}

const zoneTab: PickerTab = { name: "Zone", value: ZONE_TAB, icon: ZoneIcon };
// the picker memoizes its tabs: hand it back the same array for the same input
const tabsWithZone = new WeakMap<PickerTab[], PickerTab[]>();

function handleOf(sourceId: string) {
    return sourceId.split(":")[1];
}

function isOwnStream(streamKey: string) {
    return streamKey.endsWith(UserStore.getCurrentUser().id);
}

function closeMirror() {
    mirrorLive = false;
    void Native.stop();
}

/** Lets the user draw a zone and opens its mirror window. Resolves with that window as a stream source. */
async function pickZone(): Promise<StreamSource | null> {
    const result = await Native.start(settings.store.showMirror, settings.store.lastZone);
    if (result.status === "cancelled") return null;
    if (result.status === "failed") {
        logger.error("Could not open the mirror window:", result.error);
        // a dialog rather than a toast: a toast cuts long text off, and this is what has to be read or sent on
        Alerts.show({
            title: "Le partage de la zone n'a pas pu démarrer",
            body: (
                <div>
                    <Paragraph>{result.error}</Paragraph>
                    <Paragraph>Si la disposition de tes écrans vient de changer, quitte Discord depuis la zone de notification, relance-le et réessaie.</Paragraph>
                    <Paragraph>Si ça continue, ce fichier dit ce qui a été tenté :</Paragraph>
                    <Paragraph>
                        <code style={{ userSelect: "text", wordBreak: "break-all" }}>{result.log}</code>
                    </Paragraph>
                </div>
            ),
            confirmText: "OK"
        });
        return null;
    }

    settings.store.lastZone = result.used;

    const { handle } = result;
    mirrorHandle = handle;
    mirrorLive = false;
    void Native.waitUntilClosed().then(() => {
        if (mirrorHandle !== handle) return;
        mirrorHandle = null;
        mirrorLive = false;
    });

    return { id: `window:${handle}:0`, name: SOURCE_NAME, url: "" };
}

export const zoneSharePatches = [
    {
        // The share picker: add our tab to its Applications / Screens / Devices tabs,
        // and take over when it is chosen instead of letting the picker switch to it.
        find: 'type:"set_source_type"',
        replacement: {
            match: /onChange:(\i)=>\{let\{value:(\i)\}=\1;return (\i)\(\{type:"set_source_type",sourceType:\2\}\)\},options:(\i)\}\)(.{0,500}?"set_selected_source",source:\i\}\):(\i)\(\i\)\})/,
            replace: 'onChange:$1=>{let{value:$2}=$1;return $self.isZoneTab($2)?$self.onZoneTab($6):$3({type:"set_source_type",sourceType:$2})},options:$self.withZoneTab($4)})$5'
        }
    },
    {
        // getPidFromDesktopSource decides whose sound goes with a share: a window's own application,
        // or everything (reported as process 1) for a screen. The mirror window has no sound of its own.
        find: "getPidFromWindowHandle(",
        replacement: {
            match: /(\i)=(\i)\?\.\[0\];if\("window"===\1\)\{/,
            replace: '$1=$2?.[0];if("window"===$1&&$self.isMirror($2?.[1]))return 1;if("window"===$1){'
        }
    }
];

// called by the patched code through $self
export const zoneShareMembers = {
    withZoneTab(tabs: PickerTab[]) {
        let extended = tabsWithZone.get(tabs);
        if (!extended) tabsWithZone.set(tabs, extended = [...tabs, zoneTab]);
        return extended;
    },

    isZoneTab(value: string) {
        return value === ZONE_TAB;
    },

    // goLive is the picker's own function: it starts the stream with the quality and sound
    // chosen in the picker, then closes the picker
    onZoneTab(goLive: (source: StreamSource) => Promise<void>) {
        void pickZone().then(async source => {
            if (!source) return;

            await goLive(source);

            const handle = handleOf(source.id);
            setTimeout(() => {
                if (mirrorHandle !== handle || mirrorLive) return;

                closeMirror();
                showToast("Le partage de la zone n'a pas démarré.", "failure");
            }, START_TIMEOUT_MS);
        });
    },

    isMirror(handle?: string) {
        return handle != null && handle === mirrorHandle;
    }
};

export const zoneShareFlux = {
    // what Discord is streaming changed: the mirror is either live now, or no longer needed
    MEDIA_ENGINE_SET_GO_LIVE_SOURCE({ settings }: { settings?: { desktopSettings?: { sourceId?: string; }; } | null; }) {
        if (!mirrorHandle) return;

        const sourceId = settings?.desktopSettings?.sourceId;
        if (sourceId && handleOf(sourceId) === mirrorHandle) mirrorLive = true;
        else if (mirrorLive) closeMirror();
    },
    STREAM_STOP({ streamKey }: { streamKey: string; }) {
        if (mirrorLive && isOwnStream(streamKey)) closeMirror();
    },
    STREAM_DELETE({ streamKey }: { streamKey: string; }) {
        if (mirrorLive && isOwnStream(streamKey)) closeMirror();
    }
};

export function stopZoneShare() {
    closeMirror();
}
