/*
Made by Fraustiz
Cropping the screen shares you watch to a chosen format, e.g. one screen out of a triple-monitor stream.
Right click a stream > Recadrer, then Alt + drag the picture to adjust. Remembered for each person.
*/

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Stream } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import { ApplicationStreamingStore, Menu } from "@webpack/common";

import { Crop, croppedSize, dragPosition, Size, translationPct, videoLayout } from "./crop";
import { settings } from "./settings";

// the ref Discord's video component keeps its latest props in
interface VideoProps {
    current: {
        streamId: string;
        onResize?(size: Size): void;
    };
}

interface TrackedVideo {
    props: VideoProps;
    source: Size;
    styled: boolean;
}

const VideoStreamStore: {
    getStreamId(userId: string, guildId: string | null, context: string): string | undefined;
} = findStoreLazy("VideoStreamStore");

const FORMATS = [
    { id: "16-9", label: "16:9", ratio: 16 / 9 },
    { id: "21-9", label: "21:9", ratio: 21 / 9 },
    { id: "4-3", label: "4:3", ratio: 4 / 3 }
];

const POSITIONS = [
    { id: "left", label: "Gauche", x: 0 },
    { id: "centre", label: "Centre", x: 0.5 },
    { id: "right", label: "Droite", x: 1 }
];

const videos = new Map<HTMLVideoElement, TrackedVideo>();
// positions being dragged, only saved once the mouse is released
const dragged = new Map<string, Crop>();
let running = false;

function ownerOf(streamId: string) {
    return ApplicationStreamingStore.getAllActiveStreams()
        .find(stream => VideoStreamStore.getStreamId(stream.ownerId, stream.guildId, "stream") === streamId)
        ?.ownerId;
}

function cropOf(video: TrackedVideo): Crop | undefined {
    if (!running) return;

    const owner = ownerOf(video.props.current.streamId);
    if (owner) return dragged.get(owner) ?? settings.store.crops[owner];
}

// Sizes and shifts the element so only the cropped part shows.
// Returns the size Discord should lay the tile out for.
function layout(element: HTMLVideoElement, video: TrackedVideo): Size {
    const crop = cropOf(video);
    const { style } = element;
    const box = element.parentElement;

    if (!crop) {
        if (video.styled) {
            // back to what Discord set when it created the element
            style.setProperty("width", "100%");
            style.setProperty("height", "100%");
            style.removeProperty("max-width");
            style.removeProperty("max-height");
            style.removeProperty("transform");
            box?.style.removeProperty("overflow");
            video.styled = false;
        }
        return video.source;
    }

    const { widthPct, heightPct, shiftXPct, shiftYPct } = videoLayout(video.source, crop);

    // The element really is this big rather than zoomed with a transform:
    // Discord picks the stream quality from the element's size, so the visible part stays sharp.
    style.setProperty("width", `${widthPct}%`, "important");
    style.setProperty("height", `${heightPct}%`, "important");
    style.setProperty("max-width", "none", "important");
    style.setProperty("max-height", "none", "important");
    video.styled = true;

    if (box) {
        box.style.setProperty("overflow", "hidden", "important");

        // Where a tile puts an element bigger than itself is Discord's business (it centres it),
        // so measure that rather than assume the element starts at the tile's corner
        style.setProperty("transform", "none", "important");
        const picture = element.getBoundingClientRect();
        const tile = box.getBoundingClientRect();
        const moveX = translationPct(shiftXPct, picture.left - tile.left - box.clientLeft, picture.width);
        const moveY = translationPct(shiftYPct, picture.top - tile.top - box.clientTop, picture.height);
        style.setProperty("transform", `translate(${moveX}%, ${moveY}%)`, "important");
    }

    return croppedSize(video.source, crop.ratio);
}

// A tile can change shape, or only get its size, after the picture was positioned in it
const tileObserver = new ResizeObserver(entries => {
    for (const { target } of entries) {
        for (const [element, video] of videos) {
            if (element.parentElement === target) layout(element, video);
        }
    }
});

function refresh(owner: string | null, announce: boolean) {
    for (const [element, video] of videos) {
        if (!element.isConnected) {
            videos.delete(element);
            continue;
        }
        if (owner && ownerOf(video.props.current.streamId) !== owner) continue;

        const size = layout(element, video);
        if (announce) video.props.current.onResize?.(size);
    }
}

function setCrop(owner: string, crop: Crop | null) {
    const crops = { ...settings.store.crops };
    if (crop) crops[owner] = crop;
    else delete crops[owner];
    settings.store.crops = crops;

    refresh(owner, true);
}

function croppedVideoAt(x: number, y: number) {
    let found: { element: HTMLVideoElement; owner: string; crop: Crop; area: number; } | undefined;

    for (const [element, video] of videos) {
        const box = element.parentElement?.getBoundingClientRect();
        if (!box || x < box.left || x > box.right || y < box.top || y > box.bottom) continue;

        const owner = ownerOf(video.props.current.streamId);
        const crop = owner && settings.store.crops[owner];
        if (!owner || !crop) continue;

        // a picture-in-picture tile sits on top of the call and is the smaller of the two
        const area = box.width * box.height;
        if (!found || area < found.area) found = { element, owner, crop, area };
    }

    return found;
}

function onMouseDown(start: MouseEvent) {
    if (!start.altKey || start.button !== 0) return;

    const target = croppedVideoAt(start.clientX, start.clientY);
    if (!target) return;

    start.preventDefault();
    start.stopPropagation();

    const { element, owner, crop } = target;
    const picture = element.getBoundingClientRect();
    const box = element.parentElement!.getBoundingClientRect();
    const hiddenX = picture.width - box.width;
    const hiddenY = picture.height - box.height;

    const onMove = (event: MouseEvent) => {
        dragged.set(owner, {
            ...crop,
            x: dragPosition(crop.x, event.clientX - start.clientX, hiddenX),
            y: dragPosition(crop.y, event.clientY - start.clientY, hiddenY)
        });
        refresh(owner, false);
    };

    const onUp = () => {
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mouseup", onUp, true);

        const position = dragged.get(owner);
        dragged.delete(owner);
        if (position) setCrop(owner, position);
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
}

// Discord would otherwise treat the end of an Alt + drag as a click on the stream
function onClick(event: MouseEvent) {
    if (!event.altKey || !croppedVideoAt(event.clientX, event.clientY)) return;

    event.preventDefault();
    event.stopPropagation();
}

export const streamContextPatch: NavContextMenuPatchCallback = (children, { stream }: { stream?: Stream; }) => {
    const { crops } = settings.use(["crops"]);
    if (!stream) return;

    const owner = stream.ownerId;
    const crop: Crop | undefined = crops[owner];

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem id="stream-crop" label="Recadrer">
            <Menu.MenuGroup label="Format">
                <Menu.MenuRadioItem
                    id="stream-crop-format-original"
                    group="stream-crop-format"
                    label="Original"
                    checked={!crop}
                    action={() => setCrop(owner, null)}
                />
                {FORMATS.map(format => (
                    <Menu.MenuRadioItem
                        key={format.id}
                        id={`stream-crop-format-${format.id}`}
                        group="stream-crop-format"
                        label={format.label}
                        checked={crop?.ratio === format.ratio}
                        action={() => setCrop(owner, { ratio: format.ratio, x: crop?.x ?? 0.5, y: crop?.y ?? 0.5 })}
                    />
                ))}
            </Menu.MenuGroup>
            <Menu.MenuGroup label="Position">
                {POSITIONS.map(position => (
                    <Menu.MenuRadioItem
                        key={position.id}
                        id={`stream-crop-position-${position.id}`}
                        group="stream-crop-position"
                        label={position.label}
                        checked={crop?.x === position.x && crop.y === 0.5}
                        disabled={!crop}
                        action={() => crop && setCrop(owner, { ...crop, x: position.x, y: 0.5 })}
                    />
                ))}
            </Menu.MenuGroup>
        </Menu.MenuItem>
    );
};

export const streamCropPatches = [
    {
        // the desktop video component: it creates the <video> element and tells Discord its size
        find: '"DirectVideo"',
        replacement: {
            match: /(\i)\.current\?\.videoHeight\?\?0;(.{0,80}?)(\i)\.current\.onResize\?\.\((\i)\)/,
            replace: "$1.current?.videoHeight??0;$2$3.current.onResize?.($self.onVideoResize($1.current,$3,$4))"
        }
    }
];

// called by the patched code through $self
export const streamCropMembers = {
    // Called with the real size of a video each time it changes; what it returns is what Discord is told
    onVideoResize(element: HTMLVideoElement | null, props: VideoProps, source: Size): Size {
        if (!element) return source;

        const video = videos.get(element) ?? { props, source, styled: false };
        video.props = props;
        video.source = source;
        videos.set(element, video);
        if (element.parentElement) tileObserver.observe(element.parentElement);

        return layout(element, video);
    }
};

export function startStreamCrop() {
    running = true;
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("click", onClick, true);
    refresh(null, true);
}

export function stopStreamCrop() {
    running = false;
    document.removeEventListener("mousedown", onMouseDown, true);
    document.removeEventListener("click", onClick, true);
    dragged.clear();
    refresh(null, true);
}
