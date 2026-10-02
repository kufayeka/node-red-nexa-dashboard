// Nexa IO Binary Frame Decoder & Applicator
// Decodes with src/shared/io/frame.js (the same file the server encodes with).

import { decodeDataFrame, V } from "../../shared/io/frame.js";
import { state } from "../state.js";
import { makeSharedScope, refreshScope } from "../state/scope.js";
import { notifyWatchers, sameValue } from "../state/variable.js";
import { markSparkplugKeysDirty, refreshAllSparkplugBoundComponents } from "./sparkplug.js";
import { getEffectiveScreen, getActiveFlowScreen } from "../features/navigation.js";

export function ioApplyFrame(buffer) {
    let decoded;
    try {
        decoded = decodeDataFrame(buffer);
    } catch (e) {
        return;
    }
    if (!decoded) return;

    const entries = decoded.entries || decoded.records || [];
    const changed = [];
    for (let i = 0; i < entries.length; i++) {
        const rec = entries[i];
        const L = state.io.layout[rec.idx];
        if (!L) continue;

        // Synchronize @shared variables across screens/tabs/devices
        if (L.key.indexOf("@shared::") === 0) {
            const sVarName = L.key.slice(9);
            if (!state.currentSharedScope) state.currentSharedScope = makeSharedScope(window.__NEXA_APP__ || {});
            const oldVal = state.currentSharedScope[sVarName];
            state.currentSharedScope[sVarName] = rec.value;
            if (!sameValue(oldVal, rec.value)) {
                // the screen on show (and the flow around it) — navigation.js holds them
                const screen = getEffectiveScreen();
                const flowScreen = getActiveFlowScreen();
                if (screen) {
                    refreshScope(screen, state.currentSharedScope);
                    notifyWatchers(screen, state.currentSharedScope, sVarName, rec.value, oldVal);
                }
                if (flowScreen && flowScreen !== screen) {
                    notifyWatchers(flowScreen, state.currentSharedScope, sVarName, rec.value, oldVal);
                }
            }
            continue;
        }

        state.sparkplugCache[L.key] = {
            value: rec.value,
            type: L.type,
            isNull: typeof rec.isNull === "boolean" ? rec.isNull : (rec.vtype === V.NULL),
            online: typeof rec.online === "boolean" ? rec.online : (rec.vtype !== V.OFFLINE),
            timestamp: rec.timestamp,
            properties: L.properties,
            metadata: L.metadata,
            engUnit: L.engUnit
        };
        changed.push(L.key);
    }

    if (decoded.full && state.sparkplugConnectionLost) {
        state.sparkplugConnectionLost = false;
        refreshAllSparkplugBoundComponents();
    }
    markSparkplugKeysDirty(changed);
}
