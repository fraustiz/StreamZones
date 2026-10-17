/*
Made by Fraustiz
Offering updates of StreamZones: a check when Discord starts and every few hours; when GitHub has a
new version, a banner asks first, and installing it is one click (see updater.ts for how).
*/

import { popNotice, showNotice } from "@api/Notices";
import { Paragraph } from "@components/Paragraph";
import { relaunch } from "@utils/native";
import { Alerts, showToast } from "@webpack/common";

import { Native } from "./bridge";
import { settings } from "./settings";

// let Discord finish starting before going to GitHub
const FIRST_CHECK_DELAY_MS = 30_000;
const CHECK_EVERY_MS = 6 * 60 * 60_000;

let firstCheck: ReturnType<typeof setTimeout> | undefined;
let laterChecks: ReturnType<typeof setInterval> | undefined;
// the version already offered, so the banner is not shown again at every check
let offered: string | null = null;
let installing = false;

async function checkNow() {
    if (!settings.store.checkForUpdates) return;

    const state = await Native.checkForUpdate();
    if (state.status !== "available" || offered === state.latest) return;

    offered = state.latest;
    showNotice(`StreamZones : une nouvelle version est disponible (${state.latest}).`, "Mettre à jour", () => {
        popNotice();
        void install();
    });
}

async function install() {
    if (installing) return;
    installing = true;
    showToast("StreamZones : installation de la mise à jour…", "message");

    const result = await Native.applyUpdate();
    installing = false;

    if (!result.ok) {
        // offered again at the next check
        offered = null;
        Alerts.show({
            title: "La mise à jour de StreamZones a échoué",
            body: (
                <div>
                    <Paragraph>{result.error}</Paragraph>
                    <Paragraph>Ce fichier dit ce qui a été tenté :</Paragraph>
                    <Paragraph>
                        <code style={{ userSelect: "text", wordBreak: "break-all" }}>{result.log}</code>
                    </Paragraph>
                </div>
            ),
            confirmText: "OK"
        });
        return;
    }

    Alerts.show({
        title: "StreamZones est à jour",
        body: <Paragraph>Redémarre Discord pour utiliser la nouvelle version.</Paragraph>,
        confirmText: "Redémarrer maintenant",
        cancelText: "Plus tard",
        onConfirm: relaunch
    });
}

export function startUpdateChecks() {
    firstCheck = setTimeout(() => void checkNow(), FIRST_CHECK_DELAY_MS);
    laterChecks = setInterval(() => void checkNow(), CHECK_EVERY_MS);
}

export function stopUpdateChecks() {
    clearTimeout(firstCheck);
    clearInterval(laterChecks);
}
