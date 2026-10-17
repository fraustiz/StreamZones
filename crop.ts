/*
Made by Fraustiz
Geometry for cropping the streams you watch. No Discord imports, so it can be tested with plain Node.
*/

export interface Size {
    width: number;
    height: number;
}

export interface Crop {
    /** width / height of the part of the picture to show */
    ratio: number;
    /** which part to show along each axis, 0 = left/top edge, 1 = right/bottom edge */
    x: number;
    y: number;
}

export interface VideoLayout {
    /** size of the video element, in % of the tile it is clipped by */
    widthPct: number;
    heightPct: number;
    /** how far to move the video left/up, in % of its own size */
    shiftXPct: number;
    shiftYPct: number;
}

const UNTOUCHED: VideoLayout = { widthPct: 100, heightPct: 100, shiftXPct: 0, shiftYPct: 0 };

function hasSize({ width, height }: Size) {
    return width > 0 && height > 0;
}

/** The size to announce to Discord so the tile takes the cropped format. */
export function croppedSize(source: Size, ratio: number): Size {
    if (!hasSize(source)) return source;

    return source.width / source.height > ratio
        ? { width: Math.round(source.height * ratio), height: source.height }
        : { width: source.width, height: Math.round(source.width / ratio) };
}

/** How to size and shift the video inside a tile that has the crop's format. */
export function videoLayout(source: Size, crop: Crop): VideoLayout {
    if (!hasSize(source)) return UNTOUCHED;

    // how many tiles wide (or tall) the whole picture is
    const stretch = (source.width / source.height) / crop.ratio;
    if (stretch === 1) return UNTOUCHED;

    return stretch > 1
        ? { widthPct: stretch * 100, heightPct: 100, shiftXPct: (1 - 1 / stretch) * crop.x * 100, shiftYPct: 0 }
        : { widthPct: 100, heightPct: 100 / stretch, shiftXPct: 0, shiftYPct: (1 - stretch) * crop.y * 100 };
}

/**
 * How far to translate the video along one axis, in % of its own size (negative = left/up).
 * placedAtPx is where the tile put the untranslated video relative to its own edge: 0 if it sits
 * against the edge, negative if the tile centred an element bigger than itself.
 */
export function translationPct(shiftPct: number, placedAtPx: number, sizePx: number): number {
    const alreadyMovedPct = sizePx > 0 ? -placedAtPx / sizePx * 100 : 0;

    return alreadyMovedPct - shiftPct;
}

/** The position after dragging the picture by deltaPx along an axis where hiddenPx of it are out of view. */
export function dragPosition(start: number, deltaPx: number, hiddenPx: number): number {
    if (hiddenPx <= 0) return start;

    return Math.min(1, Math.max(0, start - deltaPx / hiddenPx));
}
