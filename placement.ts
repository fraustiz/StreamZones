/*
Made by Fraustiz
Where the zone sharing puts its mirror window and how big it makes it. No imports, so it can be
tested with plain Node.
*/

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Screen {
    /** in global screen coordinates */
    bounds: Rect;
    /** real pixels per layout unit: 1.25 for a screen set to 125% */
    scale: number;
}

const MARGIN = 40;

function intersects(a: Rect, b: Rect) {
    return a.x < b.x + b.width && b.x < a.x + a.width
        && a.y < b.y + b.height && b.y < a.y + a.height;
}

function isSameScreen(a: Screen, b: Screen) {
    return a.bounds.x === b.bounds.x && a.bounds.y === b.bounds.y;
}

/**
 * Top-left corner for the mirror window, and the scale of the screen it lands on.
 * A mirror that overlaps the zone it mirrors would film itself, so it goes on another screen when
 * there is one (ideally of the same scale, so the picture is not resampled), and otherwise in a
 * corner of the mirrored screen that the zone leaves free. The zone is in global screen coordinates.
 */
export function mirrorPlacement(zone: Rect, mirrored: Screen, screens: Screen[]) {
    const others = screens.filter(screen => !isSameScreen(screen, mirrored));
    const other = others.find(screen => screen.scale === mirrored.scale) ?? others[0];
    if (other) return { x: other.bounds.x + MARGIN, y: other.bounds.y + MARGIN, scale: other.scale };

    const { bounds } = mirrored;
    const right = bounds.x + bounds.width - zone.width;
    const bottom = bounds.y + bounds.height - zone.height;
    const corners = [
        { x: bounds.x, y: bounds.y },
        { x: right, y: bounds.y },
        { x: bounds.x, y: bottom },
        { x: right, y: bottom }
    ];
    const corner = corners.find(c => !intersects({ ...c, width: zone.width, height: zone.height }, zone)) ?? corners[0];

    return { ...corner, scale: mirrored.scale };
}

/**
 * Size of the mirror window and shift of the picture inside it, in the layout units of the screen
 * the mirror is on, so that the zone's real pixels map one to one onto the mirror's.
 * The zone is relative to its own screen's corner, in that screen's layout units.
 */
export function mirrorGeometry(zone: Rect, zoneScale: number, mirrorScale: number) {
    const ratio = zoneScale / mirrorScale;

    return {
        width: Math.round(zone.width * ratio),
        height: Math.round(zone.height * ratio),
        offsetX: 0 - zone.x * ratio,
        offsetY: 0 - zone.y * ratio
    };
}
