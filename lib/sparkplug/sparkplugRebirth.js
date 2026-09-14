// Pure decision logic for nodes/nexa-sparkplug.js's auto-rebirth-request
// behavior — factored out so it's unit-testable without a real MQTT broker
// (same reasoning @kufayeka/node-red-asset-engine's sparkplugMapping.js was
// split out of sparkplug-edge-node.js for).
//
// WHY this exists at all: Sparkplug's NBIRTH/DBIRTH messages are only ever
// published ONCE, when an Edge Node first connects, and are NOT retained by
// the broker (spec: only the Death Certificate/Will and Host STATE messages
// are retained). A passive listener like Nexa Dashboard's own MQTT
// connection that starts up AFTER an Edge Node already birthed will never
// see that birth — it only sees later NDATA/DDATA for whichever metrics
// happen to change, so anything that stays constant is invisible forever,
// and metric names sent only as an alias (see sparkplugTree.js) can't even
// be resolved. The fix: request a Rebirth (a "Node Control/Rebirth"=true
// NCMD) for any Edge Node we see DATA from before we've ever seen its
// BIRTH — with a cooldown, so a slow-to-respond or rebirth-unsupporting
// Edge Node doesn't get spammed forever.
function keyOf(groupId, edgeNodeId) {
  return groupId + "::" + edgeNodeId;
}

function RebirthTracker(cooldownMs) {
  this.cooldownMs = typeof cooldownMs === "number" ? cooldownMs : 10000;
  this.birthed = Object.create(null); // key -> true, once we've seen this Edge Node's own NBIRTH
  this.lastRequestedAt = Object.create(null); // key -> epoch ms of the last rebirth request
}

RebirthTracker.prototype.markBirthed = function (groupId, edgeNodeId) {
  this.birthed[keyOf(groupId, edgeNodeId)] = true;
};

RebirthTracker.prototype.isBirthed = function (groupId, edgeNodeId) {
  return this.birthed[keyOf(groupId, edgeNodeId)] === true;
};

// An NDEATH means the Edge Node's session ended — its NEXT NBIRTH (a new
// session) must be waited for again, same as if we'd never seen one.
RebirthTracker.prototype.markDead = function (groupId, edgeNodeId) {
  delete this.birthed[keyOf(groupId, edgeNodeId)];
};

// Returns true (and records the attempt) exactly when a rebirth request for
// this Edge Node is actually due right now: never birthed, AND (never
// requested before, or the cooldown since the last request has elapsed).
// `now` is passed in (rather than read via Date.now() internally) so this
// stays a pure, exactly-repeatable function for tests.
RebirthTracker.prototype.shouldRequest = function (groupId, edgeNodeId, now) {
  var key = keyOf(groupId, edgeNodeId);
  if (this.birthed[key]) return false;
  var last = this.lastRequestedAt[key];
  if (last !== undefined && (now - last) < this.cooldownMs) return false;
  this.lastRequestedAt[key] = now;
  return true;
};

module.exports = { RebirthTracker: RebirthTracker };
