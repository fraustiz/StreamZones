/*
Made by Fraustiz
Main-process side of zone sharing: lets the user choose a zone of a screen, then mirrors that zone
live in a borderless window that Discord can share like any other window.
No Equicord imports, so it can be exercised in a bare Electron.
*/

import { BrowserWindow, desktopCapturer, Display, Rectangle, screen, WebContents } from "electron";
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";

import { mirrorGeometry, mirrorPlacement } from "./placement";
import { positionAt, Preset, presetZone } from "./presets";
import { findScreenSource, ScreenSource } from "./sources";

export interface Selection {
    displayId: number;
    /** relative to the display's top-left corner, in the display's own (scaled) pixels */
    zone: Rectangle;
    /** the format and position the zone came from, or null if it was drawn by hand */
    preset: Preset | null;
}

/** The preset used last time, offered again on the screen it was used on. */
export interface LastZone {
    displayId: number;
    preset: Preset;
}

export const MIRROR_TITLE = "Zone Mirror";

const FORMATS = [
    { label: "16:9", ratio: 16 / 9 },
    { label: "21:9", ratio: 21 / 9 },
    { label: "4:3", ratio: 4 / 3 }
];

// A session of our own: Discord's permission rules are set on its default session,
// and these pages have no business sharing its cookies either
const webPreferences = { partition: "zone-share", backgroundThrottling: false };

// The page runs in another process: presetZone and positionAt are handed to it as text,
// so the zones it shows are computed by the very functions the tests cover.
const OVERLAY_PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Zone à partager</title>
<style>
    html, body { margin: 0; height: 100%; overflow: hidden; user-select: none; font: 600 15px system-ui, sans-serif; color: #fff; }
    body { background: rgba(0, 0, 0, 0.45); cursor: crosshair; }
    body[data-mode="preset"] { cursor: default; }
    #bar { position: absolute; top: 28px; left: 50%; transform: translateX(-50%); z-index: 2; display: flex; align-items: center; gap: 6px; padding: 8px; border-radius: 12px; background: rgba(20, 21, 26, 0.92); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); cursor: default; white-space: nowrap; }
    #formats, #placing, #positions { display: contents; }
    #bar [hidden] { display: none; }
    #bar button { font: inherit; color: #dbdee1; background: transparent; border: 0; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
    #bar button:hover { background: rgba(255, 255, 255, 0.08); }
    #bar button.active { background: rgba(88, 101, 242, 0.35); color: #fff; }
    #bar #share { background: #5865f2; color: #fff; }
    #bar #share:hover { background: #4752c4; }
    #bar .gap { width: 1px; height: 22px; margin: 0 4px; background: rgba(255, 255, 255, 0.18); }
    #help { position: absolute; top: 96px; left: 0; right: 0; z-index: 2; text-align: center; font-size: 17px; text-shadow: 0 1px 4px #000; pointer-events: none; }
    #zone { position: absolute; z-index: 1; display: none; border: 2px solid #5865f2; background: rgba(88, 101, 242, 0.2); box-sizing: border-box; }
    body[data-mode="preset"] #zone { cursor: move; }
    #size { position: absolute; left: 6px; bottom: 6px; font-size: 14px; text-shadow: 0 1px 3px #000; white-space: nowrap; }
</style>
</head>
<body>
    <div id="bar">
        <button data-ratio="free">Libre</button>
        <span id="formats"></span>
        <span id="placing" hidden>
            <span class="gap"></span>
            <span id="positions">
                <button data-position="0"></button>
                <button data-position="0.5">Centre</button>
                <button data-position="1"></button>
                <span class="gap"></span>
            </span>
            <button id="share">Partager</button>
        </span>
    </div>
    <div id="help"></div>
    <div id="zone"><span id="size"></span></div>
<script>
    const presetZone = ${presetZone.toString()};
    const positionAt = ${positionAt.toString()};

    // Called by the main process with { screen, formats, last }.
    // Resolves with { zone, preset } once a zone is chosen, or null if cancelled.
    function choose(config) {
        return new Promise(resolve => {
            const MIN_WIDTH = 160, MIN_HEIGHT = 90;
            const zoneEl = document.getElementById("zone");
            const sizeEl = document.getElementById("size");
            const helpEl = document.getElementById("help");
            const freeButton = document.querySelector('[data-ratio="free"]');
            const positionButtons = [...document.querySelectorAll("[data-position]")];

            let preset = config.last;   // { ratio, x, y } while a format is chosen, null while drawing by hand
            let rect = null;            // the zone shown on screen
            let gesture = null;         // the mouse drag in progress

            // the axis along which a zone of the chosen format has room to move on this screen, if any
            function freeAxis() {
                const zone = presetZone(config.screen, preset.ratio, 0, 0);
                return zone.width < config.screen.width ? "x" : zone.height < config.screen.height ? "y" : null;
            }

            function showZone() {
                zoneEl.style.display = rect ? "block" : "none";
                if (!rect) return;

                zoneEl.style.left = rect.x + "px";
                zoneEl.style.top = rect.y + "px";
                zoneEl.style.width = rect.width + "px";
                zoneEl.style.height = rect.height + "px";
                sizeEl.textContent = rect.width + " × " + rect.height;
            }

            function render() {
                document.body.dataset.mode = preset ? "preset" : "free";
                freeButton.classList.toggle("active", !preset);
                for (const format of config.formats) {
                    const chosen = !!preset && Math.abs(preset.ratio - format.ratio) < 1e-9;
                    document.querySelector('[data-ratio="' + format.label + '"]').classList.toggle("active", chosen);
                }
                document.getElementById("placing").hidden = !preset;

                if (!preset) {
                    helpEl.textContent = "Dessine la zone à partager en faisant glisser la souris, ou choisis un format. Échap pour annuler.";
                    showZone();
                    return;
                }

                const axis = freeAxis();
                document.getElementById("positions").hidden = !axis;
                if (axis) {
                    positionButtons[0].textContent = axis === "x" ? "Gauche" : "Haut";
                    positionButtons[2].textContent = axis === "x" ? "Droite" : "Bas";
                    for (const button of positionButtons) button.classList.toggle("active", preset[axis] === Number(button.dataset.position));
                }

                rect = presetZone(config.screen, preset.ratio, preset.x, preset.y);
                helpEl.textContent = axis
                    ? "Fais glisser la zone pour l'ajuster, puis Partager ou Entrée. Échap pour annuler."
                    : "Partager ou Entrée pour valider. Échap pour annuler.";
                showZone();
            }

            function share() {
                if (preset && rect) resolve({ zone: rect, preset });
            }

            for (const format of config.formats) {
                const button = document.createElement("button");
                button.dataset.ratio = format.label;
                button.textContent = format.label;
                button.onclick = () => { preset = { ratio: format.ratio, x: 0.5, y: 0.5 }; render(); };
                document.getElementById("formats").appendChild(button);
            }
            freeButton.onclick = () => { preset = null; rect = null; render(); };
            for (const button of positionButtons) {
                button.onclick = () => { preset[freeAxis()] = Number(button.dataset.position); render(); };
            }
            document.getElementById("share").onclick = share;

            addEventListener("mousedown", event => {
                if (event.button !== 0 || event.target.closest("#bar")) return;

                const at = { x: event.clientX, y: event.clientY };
                if (!preset) gesture = { start: at };
                // a preset zone is moved by grabbing it; a click beside it does nothing
                else if (at.x >= rect.x && at.x < rect.x + rect.width && at.y >= rect.y && at.y < rect.y + rect.height)
                    gesture = { start: at, origin: { x: rect.x, y: rect.y } };
            });

            addEventListener("mousemove", event => {
                if (!gesture) return;

                const dx = event.clientX - gesture.start.x;
                const dy = event.clientY - gesture.start.y;

                if (!preset) {
                    rect = { x: Math.min(gesture.start.x, event.clientX), y: Math.min(gesture.start.y, event.clientY), width: Math.abs(dx), height: Math.abs(dy) };
                    showZone();
                    return;
                }

                const size = presetZone(config.screen, preset.ratio, 0, 0);
                const freeX = config.screen.width - size.width;
                const freeY = config.screen.height - size.height;
                if (freeX > 0) preset.x = positionAt(gesture.origin.x + dx, freeX);
                if (freeY > 0) preset.y = positionAt(gesture.origin.y + dy, freeY);
                render();
            });

            addEventListener("mouseup", () => {
                if (!gesture) return;
                gesture = null;
                if (preset) return;

                // drawn by hand: big enough is shared at once, too small is forgotten
                if (rect && rect.width >= MIN_WIDTH && rect.height >= MIN_HEIGHT) resolve({ zone: rect, preset: null });
                else { rect = null; showZone(); }
            });

            addEventListener("keydown", event => {
                if (event.key === "Escape") resolve(null);
                else if (event.key === "Enter") share();
            });

            render();
        });
    }
</script>
</body>
</html>
`;

const MIRROR_PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${MIRROR_TITLE}</title>
<style>
    /* the whole window is a handle: drag it anywhere to move it */
    html, body { margin: 0; height: 100%; overflow: hidden; background: #000; -webkit-app-region: drag; }
    video { position: absolute; display: block; }
</style>
</head>
<body>
    <video id="video" autoplay muted></video>
<script>
    let stream = null;
    let layout = null;

    // Called by the main process; resolves once the zone is actually on screen.
    // Can be called again with another source: the main process tries sources until one shows the right screen.
    async function start({ sourceId, offsetX, offsetY, mirrorScale }) {
        const video = document.getElementById("video");
        if (stream) stream.getTracks().forEach(track => track.stop());

        // no minimum and a maximum out of reach: the screen comes at its own resolution
        stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: "desktop",
                    chromeMediaSourceId: sourceId,
                    maxWidth: 16384,
                    maxHeight: 16384,
                    maxFrameRate: 60
                }
            }
        });
        video.srcObject = stream;
        await new Promise(resolve => video.requestVideoFrameCallback(resolve));

        // the whole screen, one captured pixel per real pixel of this window's screen,
        // shifted so that only the zone is inside the window
        video.style.width = video.videoWidth / mirrorScale + "px";
        video.style.height = video.videoHeight / mirrorScale + "px";
        video.style.left = offsetX + "px";
        video.style.top = offsetY + "px";
        layout = { offsetX, offsetY, mirrorScale };

        return { width: video.videoWidth, height: video.videoHeight };
    }

    // The colour shown at a point of this window right now, as [red, green, blue].
    function sample(x, y) {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        // from a point of the window to the captured pixel under it
        const px = Math.round((x - layout.offsetX) * layout.mirrorScale);
        const py = Math.round((y - layout.offsetY) * layout.mirrorScale);
        context.drawImage(document.getElementById("video"), px, py, 1, 1, 0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
    }

    addEventListener("keydown", event => { if (event.key === "Escape") window.close(); });
</script>
</body>
</html>
`;

// navigator.mediaDevices only exists in a secure context, which a file is and a data: URL is not
function writePage(dir: string, name: string, html: string) {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, name);
    writeFileSync(file, html);
    return file;
}

const LOG_FILE = "streamzones.log";
const LOG_LIMIT_BYTES = 256 * 1024;

/** Where the log of what was decided is kept, to point someone at it when something goes wrong. */
export function logPath(dir: string) {
    return join(dir, LOG_FILE);
}

// What was decided and why, kept next to the pages: screens differ from one PC to the next, and when
// the wrong one is shared on someone else's PC this file is the only way to see what happened there.
// It holds screen ids, sizes and errors, never anything that is on the screens.
export function log(dir: string, event: string, details: object = {}) {
    try {
        mkdirSync(dir, { recursive: true });
        const file = join(dir, LOG_FILE);
        if (existsSync(file) && statSync(file).size > LOG_LIMIT_BYTES) writeFileSync(file, "");
        appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), event, ...details }) + "\n");
    } catch {
        // a diagnostic must never be what breaks the feature
    }
}

const describe = (display: Display) => ({ id: display.id, bounds: display.bounds, scale: display.scaleFactor });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Dims every screen and lets the user choose a zone on the one they want: drawn by hand,
 * or a preset format placed on the screen. Resolves with null if they cancel.
 */
export async function selectZone(pagesDir: string, last: LastZone | null = null): Promise<Selection | null> {
    const page = writePage(pagesDir, "overlay.html", OVERLAY_PAGE);
    const displays = screen.getAllDisplays();
    const underMouse = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    log(pagesDir, "select-zone", { screens: displays.map(describe), underMouse: underMouse.id, last });

    // one overlay per screen: what triggers this is in Discord, which is rarely on the screen to share
    const overlays: { display: Display; overlay: BrowserWindow; }[] = [];
    let finished = false;

    try {
        for (const display of displays) {
            // a screen that cannot take an overlay must not take the others down with it
            try {
                const overlay = new BrowserWindow({
                    ...display.bounds,
                    frame: false,
                    transparent: true,
                    resizable: false,
                    movable: false,
                    skipTaskbar: true,
                    hasShadow: false,
                    webPreferences
                });
                overlays.push({ display, overlay });
                // Electron gets the bounds wrong when a window is created on a screen whose scale is not the primary one's
                overlay.setBounds(display.bounds);
                overlay.setAlwaysOnTop(true, "screen-saver");
            } catch (err) {
                log(pagesDir, "overlay-failed", { screen: display.id, error: String(err) });
            }
        }

        // Whichever overlay finishes first decides: a zone chosen on it, or null if it was cancelled or
        // closed. One that fails is only left out; the selection fails when none of them works.
        const outcomes = overlays.map(async ({ display, overlay }): Promise<Selection | null> => {
            try {
                const closed = new Promise<null>(resolve => overlay.once("closed", () => resolve(null)));
                await overlay.loadFile(page);
                if (display.id === underMouse.id) overlay.focus();

                const config = {
                    screen: display.size,
                    formats: FORMATS,
                    last: last?.displayId === display.id ? last.preset : null
                };
                const chosen: Promise<Pick<Selection, "zone" | "preset"> | null> = overlay.webContents.executeJavaScript(`choose(${JSON.stringify(config)})`);

                const choice = await Promise.race([chosen, closed]);
                return choice && { displayId: display.id, ...choice };
            } catch (err) {
                // once a choice is made the other overlays are destroyed, which is not a failure
                if (!finished) log(pagesDir, "overlay-failed", { screen: display.id, error: String(err) });
                throw err;
            }
        });

        const selection = await Promise.any(outcomes).catch((err: AggregateError) => {
            throw new Error(`The selection screen could not open on any screen: ${err.errors?.[0] ?? "no screen found"}`);
        });
        finished = true;
        log(pagesDir, "zone-chosen", { selection });

        return selection;
    } finally {
        finished = true;
        for (const { overlay } of overlays) {
            if (!overlay.isDestroyed()) overlay.destroy();
        }
    }
}

let mirror: BrowserWindow | null = null;

/**
 * Opens the window that mirrors the selection. Resolves with its native handle once the zone is showing.
 * A mirror that is not visible is still drawn and still capturable: it is fully transparent,
 * lets clicks through and stays out of the taskbar. (Minimizing it would stop the capture.)
 */
export async function openMirror(
    pagesDir: string,
    { displayId, zone }: Pick<Selection, "displayId" | "zone">,
    visible = true,
    // listScreens: where the capture sources come from; replaced in tests to hand over misnamed ones
    { listScreens = listScreenSources }: { listScreens?: () => Promise<ScreenSource[]>; } = {}
): Promise<string> {
    closeMirror();

    const displays = screen.getAllDisplays();
    const display = displays.find(d => d.id === displayId);
    if (!display) {
        log(pagesDir, "mirror-failed", { displayId, screens: displays.map(describe), error: "screen gone" });
        // mirroring another screen instead would share something that was never chosen
        throw new Error("The selected screen is no longer available");
    }

    const sources = await listScreens();
    log(pagesDir, "open-mirror", { screen: describe(display), zone, visible, screens: displays.map(describe), sources });

    const zoneOnDesktop = { ...zone, x: display.bounds.x + zone.x, y: display.bounds.y + zone.y };
    const toScreen = (d: Display) => ({ bounds: d.bounds, scale: d.scaleFactor });

    const placement = mirrorPlacement(zoneOnDesktop, toScreen(display), displays.map(toScreen));
    const { width, height, offsetX, offsetY } = mirrorGeometry(zone, display.scaleFactor, placement.scale);

    const win = new BrowserWindow({
        x: placement.x,
        y: placement.y,
        width,
        height,
        useContentSize: true,
        show: false,
        frame: false,
        resizable: false,
        skipTaskbar: !visible,
        title: MIRROR_TITLE,
        backgroundColor: "#000000",
        webPreferences
    });
    // Electron gets the size wrong when a window is created on a screen whose scale is not the primary one's
    win.setContentSize(width, height);
    // invisible while the right source is being looked for, so that it never hides the marker
    win.setOpacity(0);
    win.setIgnoreMouseEvents(true);
    // without taking the focus away from whatever is being shared
    win.showInactive();

    mirror = win;
    win.once("closed", () => {
        if (mirror === win) mirror = null;
    });

    try {
        await win.loadFile(writePage(pagesDir, "mirror.html", MIRROR_PAGE));

        let showing: string | null = null;
        const show = async (source: ScreenSource) => {
            await win.webContents.executeJavaScript(`start(${JSON.stringify({ sourceId: source.id, offsetX, offsetY, mirrorScale: placement.scale })})`);
            showing = source.id;
        };
        const colourAtCentre = (): Promise<number[]> => win.webContents.executeJavaScript(`sample(${width / 2}, ${height / 2})`);

        // Does this source show the selected screen? Flash a small coloured square in the middle of
        // the zone, on that screen, and see whether the mirror fed by this source shows it too.
        const showsScreen = async (source: ScreenSource) => {
            await show(source);

            const before = await colourAtCentre();
            // a colour that is not already there, so that only our square can explain seeing it
            const colour = MARKER_COLOURS.find(candidate => !sameColour(candidate, before)) ?? MARKER_COLOURS[0];
            const marker = await openMarker({ x: zoneOnDesktop.x + zone.width / 2, y: zoneOnDesktop.y + zone.height / 2 }, colour);
            try {
                const deadline = Date.now() + MARKER_TIMEOUT_MS;
                while (Date.now() < deadline) {
                    await sleep(50);
                    if (sameColour(await colourAtCentre(), colour)) return true;
                }
                return false;
            } finally {
                if (!marker.isDestroyed()) marker.destroy();
            }
        };

        const { source, verified } = await findScreenSource(sources, String(display.id), showsScreen);
        if (showing !== source.id) await show(source);
        log(pagesDir, "source-chosen", { source, verified, namedAfterScreen: source.display_id === String(display.id) });
    } catch (err) {
        log(pagesDir, "mirror-failed", { error: String(err) });
        if (!win.isDestroyed()) win.destroy();
        throw err;
    }

    if (visible) {
        win.setOpacity(1);
        win.setIgnoreMouseEvents(false);
    }

    return win.getNativeWindowHandle().readBigUInt64LE().toString();
}

async function listScreenSources(): Promise<ScreenSource[]> {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
    return sources.map(source => ({ id: source.id, display_id: source.display_id }));
}

const MARKER_SIZE = 48;
const MARKER_TIMEOUT_MS = 800;
const MARKER_COLOURS = [[255, 0, 255], [0, 255, 255], [255, 255, 0], [255, 128, 0], [0, 255, 128], [128, 0, 255]];

function sameColour(a: number[], b: number[]) {
    return a.length === 3 && a.every((channel, i) => Math.abs(channel - b[i]) <= 48);
}

// A small square of one colour, above everything, centred on a point of the desktop.
async function openMarker(centre: { x: number; y: number; }, colour: number[]) {
    const bounds = {
        x: Math.round(centre.x - MARKER_SIZE / 2),
        y: Math.round(centre.y - MARKER_SIZE / 2),
        width: MARKER_SIZE,
        height: MARKER_SIZE
    };
    const css = "#" + colour.map(channel => channel.toString(16).padStart(2, "0")).join("");

    const marker = new BrowserWindow({
        ...bounds,
        show: false,
        frame: false,
        resizable: false,
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        backgroundColor: css,
        webPreferences
    });
    marker.setBounds(bounds);
    marker.setAlwaysOnTop(true, "screen-saver");
    await marker.loadURL("data:text/html," + encodeURIComponent(`<body style="margin:0;background:${css}"></body>`));
    marker.showInactive();

    return marker;
}

export function closeMirror() {
    if (mirror && !mirror.isDestroyed()) mirror.destroy();
    mirror = null;
}

/**
 * Ties the current mirror to the page that asked for it: the mirror closes if that page reloads,
 * leaves or dies. A hidden mirror that nothing closes would keep capturing the screen unnoticed.
 */
export function closeMirrorWith(page: WebContents) {
    const win = mirror;
    if (!win || win.isDestroyed()) return;

    const close = () => {
        if (!win.isDestroyed()) win.destroy();
    };
    // moving around inside Discord stays in the same document; a reload does not
    const onNavigation = (event: { isMainFrame?: boolean; isSameDocument?: boolean; }, _url?: string, isInPlace?: boolean, isMainFrame?: boolean) => {
        const mainFrame = event.isMainFrame ?? isMainFrame;
        const sameDocument = event.isSameDocument ?? isInPlace;
        if (mainFrame && !sameDocument) close();
    };

    page.on("did-start-navigation", onNavigation);
    page.once("destroyed", close);
    win.once("closed", () => {
        if (page.isDestroyed()) return;
        page.off("did-start-navigation", onNavigation);
        page.off("destroyed", close);
    });
}

/** Resolves when the current mirror window is gone, or straight away if there is none. */
export function whenMirrorClosed(): Promise<void> {
    const win = mirror;
    if (!win || win.isDestroyed()) return Promise.resolve();

    return new Promise(resolve => win.once("closed", () => resolve()));
}
