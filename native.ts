/*
Made by Fraustiz
StreamZones, main-process side: the mirror window that zone sharing shares, and updates from GitHub.
*/

import { DATA_DIR } from "@main/utils/constants";
import { execFile } from "child_process";
import { IpcMainInvokeEvent } from "electron";
import { join } from "path";
import { promisify } from "util";

import { closeMirror, closeMirrorWith, LastZone, log, logPath, openMirror, selectZone, whenMirrorClosed } from "./mirror";
import { rememberedZone } from "./presets";
import { applyUpdate as installUpdate, checkForUpdate as lookForUpdate, findClone, UpdateState } from "./updater";

const PAGES_DIR = join(DATA_DIR, "StreamZones");

// where this plugin is published, as "owner/name"
const REPOSITORY = "fraustiz/StreamZones";
// this code runs from <Equicord>/dist/desktop
const EQUICORD_DIR = join(__dirname, "..", "..");
const USERPLUGINS_DIR = join(EQUICORD_DIR, "src", "userplugins");

export type StartResult =
    // used: the preset that was chosen and where, or null if the zone was drawn by hand
    | { status: "ready"; handle: string; used: LastZone | null; }
    | { status: "cancelled"; }
    // log: the file that says what was tried, for whoever has to work out what went wrong
    | { status: "failed"; error: string; log: string; };

export type InstallResult =
    | { ok: true; }
    | { ok: false; error: string; log: string; };

/**
 * Lets the user choose a zone, then opens the window that mirrors it, shown or hidden.
 * last is the preset used last time, offered again on its screen.
 */
export async function start({ sender }: IpcMainInvokeEvent, showMirror: boolean, last: LastZone | null): Promise<StartResult> {
    // window handles and system-wide sound are both handled the Windows way here
    if (process.platform !== "win32") return { status: "failed", error: "Sharing a zone only works on Windows", log: logPath(PAGES_DIR) };

    try {
        // it comes from a settings file: anything unusable just means nothing is offered
        const remembered = rememberedZone(last);

        const selection = await selectZone(PAGES_DIR, remembered);
        if (!selection) return { status: "cancelled" };

        const handle = await openMirror(PAGES_DIR, selection, showMirror);
        closeMirrorWith(sender);

        return {
            status: "ready",
            handle,
            used: selection.preset && { displayId: selection.displayId, preset: selection.preset }
        };
    } catch (err) {
        console.error("[StreamZones] Failed to open the mirror window", err);
        return { status: "failed", error: String(err), log: logPath(PAGES_DIR) };
    }
}

export async function stop(_: IpcMainInvokeEvent) {
    closeMirror();
}

/** Resolves when the mirror window is gone, however that happened. */
export async function waitUntilClosed(_: IpcMainInvokeEvent) {
    await whenMirrorClosed();
}

/** Whether GitHub has a version of StreamZones that can be installed here. */
export async function checkForUpdate(_: IpcMainInvokeEvent): Promise<UpdateState> {
    const dir = await findClone(USERPLUGINS_DIR, REPOSITORY);
    const state: UpdateState = dir
        ? await lookForUpdate(dir)
        : { status: "unavailable", reason: `no plugin folder is a git clone of ${REPOSITORY}` };

    log(PAGES_DIR, "update-check", { dir, state });
    return state;
}

/** Installs the new version and rebuilds Equicord. It is used once Discord restarts. */
export async function applyUpdate(_: IpcMainInvokeEvent): Promise<InstallResult> {
    try {
        const dir = await findClone(USERPLUGINS_DIR, REPOSITORY);
        if (!dir) throw new Error(`no plugin folder is a git clone of ${REPOSITORY}`);

        await installUpdate(dir, buildEquicord);
        log(PAGES_DIR, "update-installed", { dir });
        return { ok: true };
    } catch (err) {
        log(PAGES_DIR, "update-failed", { error: String(err) });
        return { ok: false, error: String(err), log: logPath(PAGES_DIR) };
    }
}

// the same build Equicord's own updater runs after fetching a new version of itself
async function buildEquicord() {
    await promisify(execFile)("node", ["scripts/build/build.mjs"], { cwd: EQUICORD_DIR, timeout: 5 * 60_000, windowsHide: true });
}
