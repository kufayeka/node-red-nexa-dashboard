// The page's reader for binding priority lists (src/model/binding.js): what each source kind has
// now, for one component: its scope chain, the message its Update Component node sent, the
// Sparkplug cache (typed values: a number stays a number in an expression).
import { state } from "../state.js";
import { resolveBindableValue } from "./variable.js";
import { parseSparkplugBindingPath, sparkplugRefKey, resolveSparkplugProps } from "../io/sparkplug.js";
import { scopeReader } from "../../model/binding.js";

/**
 * The message an item of a target list (a chart's series) reads: the last one its own Update node
 * sent, else the component's (one message for the whole chart still feeds every series).
 */
export function itemMessage(comp, list, id) {
    const own = comp && comp.__itemMsgs && comp.__itemMsgs[list + "#" + id];
    return own || (comp && comp.__lastMsg) || null;
}

/** The target lists of a component (keys of the lists whose items are Logic targets). */
export function targetListsOf(comp) {
    const def = comp && window.NEXA && window.NEXA.getComponent(comp.type);
    return def && Array.isArray(def.targets) ? def.targets : [];
}

export function sparkplugTagValue(address) {
    const ref = parseSparkplugBindingPath("{sparkplug:" + address + "}");
    if (!ref || state.sparkplugConnectionLost) return "???";
    const entry = state.sparkplugCache[sparkplugRefKey(ref)];
    if (!entry || !entry.online || entry.isNull || entry.value === undefined || entry.value === null) return "???";
    return entry.value;
}

/**
 * read(src, ref) for a component: its scope (comp.__paramState unless given), its last message
 * (or `msg`: an item's own, see itemMessage).
 */
export function runtimeReader(comp, scope, msg) {
    const s = scope || (comp && comp.__paramState) || state.currentAppScope || null;
    return scopeReader({
        scope: s,
        msg: msg || (comp && comp.__lastMsg ? comp.__lastMsg : null),
        // a tag address may hold {variables} (…::{line}/Speed)
        address: (text) => (String(text).indexOf("{") !== -1 && s ? resolveBindableValue(String(text), s) : text),
        tag: (provider, address) => (provider === "sparkplug" ? sparkplugTagValue(address) : undefined),
        // a type member whose source is a tag: the legacy pipeline reads it
        deref: (text) => {
            const v = s ? resolveBindableValue(text, s) : text;
            return typeof v === "string" ? resolveSparkplugProps({ v: v }).v : v;
        }
    });
}
