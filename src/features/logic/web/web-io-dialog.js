import { markDirty } from "../../../state.js";
import { renderLogicCanvas } from "../../../logic/logic-nodes.js";
import { buildTypedInputWidget } from "../../../param-types.js";

// The web / data Logic nodes (docs/STATE.md):
//   http-request  call an API: msg.payload = response data, msg.statusCode, msg.ok, msg.error
//   storage       localStorage / sessionStorage: get / set / remove a key
//   cookie        get / set / remove a cookie (a login / session token and the like)
// Text fields take bindings: {line}, {$route.params.id}, {msg.payload.id}.
var TITLES = { "http-request": "HTTP Request", storage: "Storage", cookie: "Cookie" };
var HELP = {
    "http-request": "Calls a web API. The URL and header values take bindings — {variable}, {$route.params.id}, {msg.payload.id}. The request body is msg.payload (JSON). Out: msg.payload = the response (parsed JSON or text), msg.statusCode, msg.ok and msg.error (non-2xx, network error or timeout). msg.url / msg.method / msg.headers override the node's.",
    storage: "Reads or writes the browser's storage. \"Local\" is kept across visits, \"session\" until the tab closes. Values are stored as JSON.",
    cookie: "Reads, writes or removes a cookie — for example a session token after a login. Set / remove run in the page, so they are not HttpOnly (a server-set HttpOnly cookie is sent with HTTP Request calls automatically)."
};

export function openWebIoNodeEditor(node) {
    var type = node.type;
    var d = JSON.parse(JSON.stringify(node));
    window.RED.tray.show({
        id: "nexa-logic-webio-editor",
        title: "Configure " + TITLES[type] + " Node",
        width: 480,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    Object.keys(d).forEach(function (k) { if (k !== "id" && k !== "x" && k !== "y" && k !== "type") node[k] = d[k]; });
                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px" });
            window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "10px" }).text(HELP[type]).appendTo(body);
            var label = function (text, parent) { return window.$("<label>").css({ display: "block", "font-size": "11px", color: "#888", margin: "8px 0 4px" }).text(text).appendTo(parent || body); };
            var text = function (key, placeholder, parent) {
                return window.$("<input>", { type: "text", placeholder: placeholder || "" }).css({ width: "100%", "box-sizing": "border-box" })
                    .val(d[key] === undefined ? "" : d[key]).appendTo(parent || body).on("change", function () { d[key] = this.value; });
            };
            var select = function (key, options, parent, onChange) {
                var sel = window.$("<select>").css({ width: "100%" }).appendTo(parent || body);
                options.forEach(function (o) { window.$("<option>", { value: o[0] }).text(o[1]).appendTo(sel); });
                sel.val(d[key] !== undefined ? d[key] : options[0][0]);
                d[key] = sel.val();
                sel.on("change", function () { d[key] = sel.val(); if (onChange) onChange(); });
                return sel;
            };

            if (type === "http-request") {
                label("Method");
                select("method", [["GET", "GET"], ["POST", "POST"], ["PUT", "PUT"], ["PATCH", "PATCH"], ["DELETE", "DELETE"]]);
                label("URL");
                text("url", "https://api.example.com/orders/{msg.payload.id}?line={line}");
                label("Headers (JSON — values take bindings)");
                var h = window.$("<textarea>", { rows: 3, placeholder: '{"Authorization": "Bearer {token}"}' }).css({ width: "100%", "box-sizing": "border-box", "font-family": "monospace" })
                    .val(typeof d.headers === "string" ? d.headers : (d.headers ? JSON.stringify(d.headers, null, 1) : "")).appendTo(body)
                    .on("change", function () { d.headers = this.value.trim(); });
                h.attr("spellcheck", "false");
                label("Body");
                var bodyText;
                select("body", [["payload", "msg.payload (JSON)"], ["binding", "A binding / text, e.g. {item}"], ["none", "No body"]], body, function () { bodyText.toggle(d.body === "binding"); });
                bodyText = text("bodyText", "{item}  — or {\"qty\": 1, \"id\": \"{item.id}\"} as text");
                bodyText.toggle(d.body === "binding");
                label("Timeout (ms, 0 = none)");
                text("timeout", "10000");
                label("Cookies");
                select("credentials", [["same-origin", "Same site only (default)"], ["include", "Always send (cross-site API with cookies)"], ["omit", "Never"]]);
                return;
            }

            // storage / cookie
            label("Action");
            var valueWrap, targetWrap, cookieOpts;
            var sync = function () {
                if (valueWrap) valueWrap.toggle(d.action === "set");
                if (targetWrap) targetWrap.toggle(!d.action || d.action === "get");
                if (cookieOpts) cookieOpts.toggle(d.action !== "get");
            };
            select("action", [["get", "Get (into the message)"], ["set", "Set"], ["remove", "Remove"]], body, sync);
            if (type === "storage") {
                label("Store");
                select("store", [["local", "Local (kept across visits)"], ["session", "Session (until the tab closes)"]]);
                label("Key");
                text("key", "e.g. cart or prefs-{user}");
            } else {
                label("Cookie name");
                text("name", "e.g. session");
            }
            targetWrap = window.$("<div>").appendTo(body);
            label("Into msg property", targetWrap);
            text("target", "payload", targetWrap);
            valueWrap = window.$("<div>").appendTo(body);
            label("Value", valueWrap);
            var staticRow = window.$("<div>").css({ "margin-top": "6px" });
            select("valueSource", [["payload", "msg.payload"], ["static", "A fixed value"]], valueWrap, function () { staticRow.toggle(d.valueSource === "static"); });
            staticRow.appendTo(valueWrap);
            buildTypedInputWidget(staticRow, "string", d.value !== undefined ? d.value : "", function (v) { d.value = v; });
            staticRow.toggle(d.valueSource === "static");
            if (type === "cookie") {
                cookieOpts = window.$("<div>").appendTo(body);
                label("Expires after (days; empty = when the browser closes)", cookieOpts);
                text("days", "7", cookieOpts);
                label("Path", cookieOpts);
                text("path", "/", cookieOpts);
                label("SameSite", cookieOpts);
                select("sameSite", [["Lax", "Lax (default)"], ["Strict", "Strict"], ["None", "None (needs Secure)"]], cookieOpts);
                var secRow = window.$("<label>").css({ display: "flex", gap: "6px", "align-items": "center", "margin-top": "8px", "font-size": "12px" }).appendTo(cookieOpts);
                window.$("<input>", { type: "checkbox" }).prop("checked", !!d.secure).appendTo(secRow).on("change", function () { d.secure = this.checked; });
                window.$("<span>").text("Secure (HTTPS only)").appendTo(secRow);
            }
            sync();
        }
    });
}
