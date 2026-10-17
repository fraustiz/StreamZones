/*
Made by Fraustiz
Preset zones for sharing: a format (16:9, 21:9...) placed somewhere on a screen.
No imports, so it can be tested with plain Node.

presetZone and positionAt are also copied as text into the selection page (see mirror.ts), which runs
in another process: each must stay self-contained, using nothing but its arguments and Math.
*/

export interface Preset {
    /** width / height */
    ratio: number;
    /** where the zone sits in the free space along each axis, 0 = left/top, 1 = right/bottom */
    x: number;
    y: number;
}

/** Whether a value read back from the settings can be used as a preset. */
export function isPreset(value: unknown): value is Preset {
    if (typeof value !== "object" || value === null) return false;

    const { ratio, x, y } = value as Record<string, unknown>;
    return typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0
        && typeof x === "number" && Number.isFinite(x)
        && typeof y === "number" && Number.isFinite(y);
}

/** The biggest zone of that format that fits the screen, placed by position. In whole pixels. */
export function presetZone(screen: { width: number; height: number; }, ratio: number, x: number, y: number) {
    const width = Math.min(screen.width, Math.round(screen.height * ratio));
    const height = Math.min(screen.height, Math.round(screen.width / ratio));
    const clamp = (position: number) => Math.min(1, Math.max(0, position));

    return {
        x: Math.round((screen.width - width) * clamp(x)),
        y: Math.round((screen.height - height) * clamp(y)),
        width,
        height
    };
}

/** The position of a zone whose corner is offsetPx along an axis that has freePx of free space. */
export function positionAt(offsetPx: number, freePx: number) {
    if (freePx <= 0) return 0;

    return Math.min(1, Math.max(0, offsetPx / freePx));
}
