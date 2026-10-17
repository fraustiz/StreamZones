/*
Made by Fraustiz
How StreamZones updates itself. Its folder is a git clone of its GitHub repository: an update is a
fast-forward of that folder to what GitHub has, then a rebuild of Equicord, as Equicord's own updater
does for itself. No Equicord imports, so it can be tested against real git repositories.
*/

import { execFile } from "child_process";
import { readdirSync } from "fs";
import { join, resolve } from "path";
import { promisify } from "util";

const run = promisify(execFile);

export type UpdateState =
    | { status: "up-to-date"; }
    // behind: how many changes GitHub has that this folder has not; latest: the title of the newest
    | { status: "available"; behind: number; latest: string; }
    | { status: "unavailable"; reason: string; };

async function git(dir: string, ...args: string[]) {
    const { stdout } = await run("git", args, { cwd: dir, timeout: 60_000, windowsHide: true });
    return stdout.trim();
}

function samePath(a: string, b: string) {
    const normalize = (path: string) => resolve(path).replace(/[\\/]+$/, "");
    return process.platform === "win32"
        ? normalize(a).toLowerCase() === normalize(b).toLowerCase()
        : normalize(a) === normalize(b);
}

// The folder is the top of a clone of its own, not a plain copy somewhere inside Equicord's repository.
// Throws if git itself cannot be run, which is a different problem from "not a clone".
async function isOwnClone(dir: string) {
    try {
        return samePath(await git(dir, "rev-parse", "--show-toplevel"), dir);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new Error("git is not installed, or Discord cannot find it");
        return false;
    }
}

async function upstreamOf(dir: string) {
    const branch = await git(dir, "rev-parse", "--abbrev-ref", "HEAD");
    if (branch === "HEAD") throw new Error("the clone is not on a branch");
    return `origin/${branch}`;
}

/** Whether GitHub has a newer version that can be installed without touching anything done by hand. */
export async function checkForUpdate(dir: string): Promise<UpdateState> {
    try {
        if (!await isOwnClone(dir)) return { status: "unavailable", reason: "the plugin folder is not a git clone of its repository" };

        const upstream = await upstreamOf(dir);
        try {
            await git(dir, "fetch", "--quiet", "origin");
        } catch (err) {
            return { status: "unavailable", reason: `could not reach the repository: ${err}` };
        }

        // files added by hand do not matter, files of the plugin changed by hand do
        if (await git(dir, "status", "--porcelain", "--untracked-files=no")) return { status: "unavailable", reason: "files of the plugin were edited by hand" };

        const [ahead, behind] = (await git(dir, "rev-list", "--left-right", "--count", `HEAD...${upstream}`)).split(/\s+/).map(Number);
        if (!behind) return { status: "up-to-date" };
        // changes that are not on GitHub, like in the author's own copy: never overwritten
        if (ahead) return { status: "unavailable", reason: "this copy has changes that are not on GitHub" };

        return { status: "available", behind, latest: await git(dir, "log", "-1", "--format=%s", upstream) };
    } catch (err) {
        return { status: "unavailable", reason: String(err instanceof Error ? err.message : err) };
    }
}

/** Installs what checkForUpdate offers, then builds. Refuses in any other situation, so it never overwrites work. */
export async function applyUpdate(dir: string, build: () => Promise<void>) {
    const state = await checkForUpdate(dir);
    if (state.status !== "available") throw new Error(state.status === "up-to-date" ? "already up to date" : state.reason);

    await git(dir, "merge", "--ff-only", "--quiet", await upstreamOf(dir));
    await build();
}

/** The plugin folder that is a clone of the repository (as "owner/name"), whatever it was called. */
export async function findClone(userpluginsDir: string, repository: string): Promise<string | null> {
    let folders: string[];
    try {
        folders = readdirSync(userpluginsDir, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => join(userpluginsDir, entry.name));
    } catch {
        return null;
    }

    for (const dir of folders) {
        if (!await isOwnClone(dir).catch(() => false)) continue;

        const url = await git(dir, "remote", "get-url", "origin").catch(() => "");
        if (url.replaceAll("\\", "/").toLowerCase().includes(repository.toLowerCase())) return dir;
    }
    return null;
}
