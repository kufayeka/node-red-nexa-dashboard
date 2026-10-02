// Templates and lists on the page. The repeater itself: src/runtime/logic/widgets/populate.js.
import { defineLogicRuntimes, flatConfig } from "../registry.js";
import { updateInstanceParam } from "../../../runtime/mounting/render.js";
import { runPopulate, sendToHost } from "../../../runtime/logic/widgets/populate.js";
import { valueFromMsg } from "../../../runtime/state/variable.js";

const passOn = { run: function (node, msg) { return msg; } };

defineLogicRuntimes({
    // fired by fireParamInputForInstance (src/runtime/mounting/render.js)
    "param-input": passOn,
    // fired by sendToHost (src/runtime/logic/widgets/populate.js)
    "template-event": passOn,
    "set-template-param": {
        run: function (node, msg, ctx) {
            updateInstanceParam(ctx.screen, node.props.instanceId, node.props.paramName, msg && msg.payload);
            return msg;
        }
    },
    "template-output": {
        run: function (node, msg, ctx) { sendToHost(ctx.screen, flatConfig(node), msg, ctx.budget); }
    },
    // with a container: fill it now. Without: add a job to msg.populate for the Layout node it is wired to.
    "populate": {
        run: function (node, msg, ctx) {
            if (node.props.container) {
                runPopulate(ctx.screen, flatConfig(node), msg);
                return msg;
            }
            const out = Object.assign({}, msg || {});
            const job = { template: node.props.template, itemParam: node.props.itemParam, mode: node.props.mode, key: node.props.key, fill: node.props.fill, virtualize: node.props.virtualize, items: valueFromMsg(flatConfig(node), msg) };
            const before = msg && msg.populate ? [].concat(msg.populate).filter(function (j) { return j && typeof j === "object"; }) : [];
            out.populate = before.length ? before.concat([job]) : job;
            return out;
        }
    },
    // runs the msg.populate jobs into its frame; its output is what the copies send (template-output)
    "layout": {
        run: function (node, msg, ctx) {
            if (!msg || !msg.populate || typeof msg.populate !== "object") return;
            [].concat(msg.populate).forEach(function (job) {
                if (!job || typeof job !== "object") return;
                runPopulate(ctx.screen, {
                    id: node.id, container: node.props.container, template: job.template, itemParam: job.itemParam, mode: job.mode,
                    key: job.key, fill: job.fill, virtualize: job.virtualize, valueSource: "static", value: job.items
                }, msg);
            });
        }
    }
});
