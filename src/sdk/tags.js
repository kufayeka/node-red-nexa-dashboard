// --- Generic tags ----------------------------------------------------------------
// A tag reference is stored in a component's props as "{<provider>:<address>}",
// e.g. "{sparkplug:Plant::Edge1::Mixer::Speed}", later "{opcua:ns=2;s=Motor.Speed}",
// "{sql:plantdb/line1_speed}", "{udt:Motor1.Speed}". Components never parse
// that themselves: they declare `inputs` / `outputs` and read / write through
// the SDK; the tag picker (<nx-tag>) and the host (editor / runtime) talk to
// the PROVIDER registered for the prefix.
//
// defineTagProvider(name, {
//     label, icon,
//     parse(address) -> ref object | null      REQUIRED, pure: is the address valid?
//     format(ref) -> address                   pure, the inverse of parse
//     display(ref) -> "Plant / Edge1 / ..."    pure, a short human label
//     list() -> [{ address, label, detail }]   suggestions (the host fills this in)
//     read / write                             how the runtime reads / writes (host)
// })
// A provider may be defined in pieces: the SDK registers the pure part (so a
// deployed page can parse), the editor / runtime add list / write with
// extendTagProvider(name, {...}).
//
// The registry lives on window (window.NexaTags) so the SDK bundle, the
// property kit and the hosts all share one, whichever loads first.

function registry() {
    var w = window;
    if (!w.NexaTags) {
        w.NexaTags = { providers: {}, order: [] };
    }
    return w.NexaTags;
}

var TAG_RE = /^\{([A-Za-z][\w-]*):([\s\S]+)\}$/;

export function defineTagProvider(name, provider) {
    if (!/^[A-Za-z][\w-]*$/.test(name || "")) throw new Error("[nexa] tag provider name must be an identifier: " + name);
    if (!provider || typeof provider.parse !== "function") throw new Error("[nexa] tag provider \"" + name + "\" needs parse(address)");
    var reg = registry();
    if (!reg.providers[name]) reg.order.push(name);
    reg.providers[name] = Object.assign({ name: name, label: name, icon: "fa fa-tag" }, reg.providers[name] || {}, provider);
    return reg.providers[name];
}

export function extendTagProvider(name, parts) {
    var reg = registry();
    if (!reg.providers[name]) throw new Error("[nexa] unknown tag provider \"" + name + "\"");
    Object.assign(reg.providers[name], parts || {});
    return reg.providers[name];
}

export function getTagProvider(name) {
    return registry().providers[name] || null;
}

export function listTagProviders() {
    var reg = registry();
    return reg.order.map(function (n) { return reg.providers[n]; });
}

/** "{provider:address}" for a provider name + address. */
export function makeTag(provider, address) {
    return "{" + provider + ":" + address + "}";
}

/**
 * { provider, address, ref, valid, display } for a whole-value tag reference,
 * null when `raw` isn't one. `valid` = a provider exists and parses the address.
 */
export function parseTag(raw) {
    if (typeof raw !== "string") return null;
    var m = TAG_RE.exec(raw.trim());
    if (!m) return null;
    var p = getTagProvider(m[1]);
    var ref = p ? p.parse(m[2]) : null;
    return {
        provider: m[1],
        address: m[2],
        ref: ref,
        valid: !!ref,
        known: !!p,
        display: ref && p && typeof p.display === "function" ? p.display(ref) : m[2]
    };
}

/** true for a whole-value reference of a REGISTERED provider. */
export function isTag(raw) {
    var t = parseTag(raw);
    return !!(t && t.known);
}

// ---- built-in provider: Sparkplug B ------------------------------------------------
// Address "<group>::<edgeNode>::<device>::<metric>" — "::" because a metric
// name may itself contain "/"; the device is empty for a node-scoped metric.
// Same grammar as src/canvas/sparkplug-live.js (the existing bindings stay valid).
defineTagProvider("sparkplug", {
    label: "Sparkplug B",
    icon: "fa fa-bolt",
    parse: function (address) {
        var parts = String(address).split("::");
        if (parts.length < 4) return null;
        var metricName = parts.slice(3).join("::");
        if (!parts[0] || !parts[1] || !metricName) return null;
        return { groupId: parts[0], edgeNodeId: parts[1], deviceId: parts[2] || null, metricName: metricName };
    },
    format: function (ref) {
        return ref.groupId + "::" + ref.edgeNodeId + "::" + (ref.deviceId || "") + "::" + ref.metricName;
    },
    display: function (ref) {
        return [ref.groupId, ref.edgeNodeId, ref.deviceId, ref.metricName].filter(Boolean).join(" / ");
    },
    placeholder: "Group::EdgeNode::Device::Metric"
});
