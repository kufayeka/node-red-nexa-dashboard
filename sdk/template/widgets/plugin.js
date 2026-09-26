// Backend: serve dist/ to the editor and to deployed pages, register the module.
module.exports = function (RED) {
    require("@kufayeka/node-red-nexa-dashboard/sdk/package")(RED, {
        id: "acme-nexa-sample",
        name: "acme-nexa-sample",
        dir: require("path").join(__dirname, "..", "dist"),
        modules: ["sample.js"]
    });
};
