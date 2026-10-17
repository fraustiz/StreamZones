/*
Made by Fraustiz
How the zone sharing picks the capture source of the screen that was selected. No imports, so it
can be tested with plain Node.
*/

export interface ScreenSource {
    id: string;
    /** the id of the screen this source is supposed to show; empty when Electron could not tell */
    display_id: string;
}

/**
 * Finds the capture source that really shows the wanted screen.
 *
 * Electron names each source after a screen, but only when one particular capture method is in
 * use, and by position in a list rather than by looking: after a change of screen layout that
 * name can be missing or point at another screen. So the name only decides which source is tried
 * first, and showsScreen (capture the source, look for our marker) decides.
 */
export async function findScreenSource<T extends ScreenSource>(
    sources: T[],
    displayId: string,
    showsScreen: (source: T) => Promise<boolean>
): Promise<{ source: T; verified: boolean; }> {
    if (!sources.length) throw new Error("No screen can be captured");

    const named = sources.find(source => source.display_id === displayId);
    const candidates = named ? [named, ...sources.filter(source => source !== named)] : sources;

    for (const source of candidates) {
        // a source that cannot be captured is just not the one
        if (await showsScreen(source).catch(() => false)) return { source, verified: true };
    }

    // Nothing could be confirmed, e.g. a game in exclusive full screen hides our marker.
    // Trust the name if there is one, or the only source there is; otherwise do not guess.
    const fallback = named ?? (sources.length === 1 ? sources[0] : null);
    if (!fallback) throw new Error("No capture source shows the selected screen");

    return { source: fallback, verified: false };
}
