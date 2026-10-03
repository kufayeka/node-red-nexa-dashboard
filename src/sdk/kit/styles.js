// --- Nexa property kit: tokens + the one stylesheet every nx-* widget uses ---
// Widgets render in LIGHT DOM (Font Awesome icons and the editor's own
// "is the user typing?" checks work unchanged), so they are styled by this
// global sheet, injected once. Every rule is scoped under .nx-kit and doubled
// (.nx-kit.nx-kit ...) where it has to beat the Node-RED editor's own form
// rules. Colours come from Nexa tokens (--nx-*), which default to the
// editor theme's --red-ui-* variables: dark theme works for free, and a page
// outside Node-RED (a test harness, a deployed screen) gets the fallbacks.
var CSS = `
:root {
  --nx-font: var(--red-ui-primary-font, "Helvetica Neue", Arial, Helvetica, sans-serif);
  --nx-font-size: 12px;
  --nx-mono: var(--red-ui-monospace-font, Menlo, Consolas, "DejaVu Sans Mono", monospace);
  --nx-text: var(--red-ui-primary-text-color, #555);
  --nx-text-strong: var(--red-ui-form-text-color, #444);
  --nx-text-muted: var(--red-ui-secondary-text-color, #777);
  --nx-text-faint: var(--red-ui-tertiary-text-color, #999);
  --nx-bg: var(--red-ui-form-input-background, #fff);
  --nx-bg-disabled: var(--red-ui-form-input-background-disabled, #efefef);
  --nx-bg-subtle: var(--red-ui-secondary-background, #f3f3f3);
  --nx-bg-hover: var(--red-ui-secondary-background-hover, #e6e6e6);
  --nx-bg-selected: var(--red-ui-secondary-background-selected, #efefef);
  --nx-border: var(--red-ui-form-input-border-color, #ccc);
  --nx-border-subtle: var(--red-ui-secondary-border-color, #ddd);
  --nx-focus: var(--red-ui-form-input-focus-color, rgba(85, 150, 230, 0.8));
  --nx-accent: var(--red-ui-text-color-link, #0070c0);
  --nx-error: var(--red-ui-text-color-error, #d6615f);
  --nx-warn: var(--red-ui-text-color-warning, #c7851c);
  --nx-success: var(--red-ui-text-color-success, #3a9a5b);
  --nx-placeholder: var(--red-ui-form-placeholder-color, #aaa);
  --nx-radius: 3px;
  --nx-control-h: 26px;
  --nx-gap: 8px;
}

.nx-kit { font-family: var(--nx-font); font-size: var(--nx-font-size); color: var(--nx-text); line-height: 1.4; }
.nx-kit *, .nx-kit *::before, .nx-kit *::after { box-sizing: border-box; }

/* ---- field frame: label / control / help / message ---- */
.nx-kit .nx-field { display: block; margin: 0 0 10px; min-width: 0; }
.nx-kit .nx-field-head { display: flex; align-items: center; gap: 4px; min-height: 16px; margin-bottom: 3px; }
.nx-kit .nx-label { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; color: var(--nx-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nx-kit .nx-label i { color: var(--nx-text-faint); }
.nx-kit .nx-req { color: var(--nx-error); font-weight: 700; }
.nx-kit .nx-dot { flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%; background: var(--nx-accent); }
.nx-kit .nx-help { font-size: 10.5px; line-height: 1.35; color: var(--nx-text-faint); margin-top: 3px; }
.nx-kit .nx-message { font-size: 10.5px; line-height: 1.35; color: var(--nx-error); margin-top: 3px; }
.nx-kit .nx-inline { display: flex; align-items: center; gap: 6px; }

/* ---- controls ---- */
.nx-kit.nx-kit .nx-control, .nx-kit.nx-kit input.nx-control, .nx-kit.nx-kit select.nx-control, .nx-kit.nx-kit textarea.nx-control {
  display: block; width: 100%; height: var(--nx-control-h); min-height: var(--nx-control-h); margin: 0; padding: 0 7px;
  font-family: inherit; font-size: 12px; line-height: normal; color: var(--nx-text-strong);
  background: var(--nx-bg); border: 1px solid var(--nx-border); border-radius: var(--nx-radius);
  box-shadow: none; outline: none; transition: border-color 80ms ease, box-shadow 80ms ease;
}
.nx-kit.nx-kit textarea.nx-control { height: auto; padding: 5px 7px; resize: vertical; line-height: 1.4; }
.nx-kit.nx-kit select.nx-control { padding: 0 4px; }
.nx-kit.nx-kit .nx-control::placeholder { color: var(--nx-placeholder); }
.nx-kit.nx-kit .nx-control:focus { border-color: var(--nx-focus); box-shadow: 0 0 0 1px var(--nx-focus); }
.nx-kit.nx-kit .nx-control:disabled, .nx-kit.nx-kit .nx-control[readonly] { background: var(--nx-bg-disabled); color: var(--nx-text-muted); }
.nx-kit.nx-kit .nx-invalid .nx-control, .nx-kit.nx-kit .nx-invalid .nx-group, .nx-kit.nx-kit .nx-invalid .nx-seg { border-color: var(--nx-error); }
.nx-kit.nx-kit .nx-mono, .nx-kit.nx-kit .nx-control.nx-mono { font-family: var(--nx-mono); font-size: 11px; }

/* input group: [addon][control][addon / button] */
.nx-kit .nx-group { display: flex; align-items: stretch; min-width: 0; border: 1px solid var(--nx-border); border-radius: var(--nx-radius); background: var(--nx-bg); }
.nx-kit .nx-group:focus-within { border-color: var(--nx-focus); box-shadow: 0 0 0 1px var(--nx-focus); }
.nx-kit.nx-kit .nx-group > .nx-control { flex: 1 1 auto; min-width: 0; width: auto; border: none; box-shadow: none; border-radius: 0; background: transparent; }
.nx-kit .nx-addon { flex: 0 0 auto; display: flex; align-items: center; padding: 0 7px; font-size: 11px; color: var(--nx-text-muted); background: var(--nx-bg-subtle); white-space: nowrap; }
.nx-kit .nx-addon:first-child { border-right: 1px solid var(--nx-border-subtle); }
.nx-kit .nx-addon:last-child { border-left: 1px solid var(--nx-border-subtle); }

/* ---- buttons ---- */
.nx-kit.nx-kit .nx-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: var(--nx-control-h); margin: 0; padding: 0 10px;
  font-family: inherit; font-size: 11px; font-weight: 600; color: var(--nx-text); background: var(--nx-bg-subtle);
  border: 1px solid var(--nx-border); border-radius: var(--nx-radius); cursor: pointer; white-space: nowrap; box-shadow: none;
}
.nx-kit.nx-kit .nx-btn:hover:not(:disabled) { background: var(--nx-bg-hover); }
.nx-kit.nx-kit .nx-btn:disabled { opacity: 0.5; cursor: default; }
.nx-kit.nx-kit .nx-btn.nx-block { width: 100%; }
.nx-kit.nx-kit .nx-icon-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 16px; margin: 0; padding: 0;
  border: none; background: transparent; color: var(--nx-text-faint); font-size: 11px; cursor: pointer; border-radius: 2px; box-shadow: none;
}
.nx-kit.nx-kit .nx-icon-btn:hover { color: var(--nx-text); background: var(--nx-bg-hover); }
.nx-kit.nx-kit .nx-icon-btn.nx-on { color: var(--nx-accent); }
.nx-kit.nx-kit .nx-group > .nx-icon-btn { width: 24px; height: auto; border-radius: 0; border-left: 1px solid var(--nx-border-subtle); }

/* ---- checkbox / toggle ---- */
.nx-kit .nx-check { display: flex; align-items: flex-start; gap: 7px; cursor: pointer; font-size: 12px; color: var(--nx-text-strong); user-select: none; }
.nx-kit.nx-kit .nx-check input[type=checkbox] { flex: 0 0 auto; width: 13px; height: 13px; margin: 1px 0 0; accent-color: var(--nx-accent); cursor: pointer; }
.nx-kit .nx-check.nx-disabled { opacity: 0.55; cursor: default; }
.nx-kit .nx-switch { position: relative; flex: 0 0 auto; width: 28px; height: 16px; margin-top: 0; border-radius: 8px; background: var(--nx-border); transition: background 120ms ease; }
.nx-kit .nx-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.25); transition: left 120ms ease; }
.nx-kit .nx-switch.nx-on { background: var(--nx-accent); }
.nx-kit .nx-switch.nx-on::after { left: 14px; }

/* ---- segmented ---- */
.nx-kit .nx-seg { display: flex; min-width: 0; border: 1px solid var(--nx-border); border-radius: var(--nx-radius); overflow: hidden; background: var(--nx-bg); }
.nx-kit.nx-kit .nx-seg-item {
  flex: 1 1 0; min-width: 0; height: calc(var(--nx-control-h) - 2px); margin: 0; padding: 0 6px; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  font-family: inherit; font-size: 11px; color: var(--nx-text-muted); background: transparent; border: none; border-right: 1px solid var(--nx-border-subtle);
  border-radius: 0; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: none;
}
.nx-kit.nx-kit .nx-seg-item:last-child { border-right: none; }
.nx-kit.nx-kit .nx-seg-item:hover:not(:disabled) { background: var(--nx-bg-hover); }
.nx-kit.nx-kit .nx-seg-item.nx-on { background: var(--nx-bg-selected); color: var(--nx-text-strong); font-weight: 600; box-shadow: inset 0 -2px 0 var(--nx-accent); }

/* ---- slider ---- */
.nx-kit .nx-slider { display: flex; align-items: center; gap: 8px; }
.nx-kit.nx-kit .nx-slider input[type=range] { flex: 1 1 auto; min-width: 0; margin: 0; accent-color: var(--nx-accent); }
.nx-kit.nx-kit .nx-slider .nx-control { flex: 0 0 58px; width: 58px; }

/* ---- color ---- */
.nx-kit .nx-swatch { position: relative; flex: 0 0 auto; width: 26px; border-right: 1px solid var(--nx-border-subtle); cursor: pointer; overflow: hidden;
  background-image: linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%);
  background-size: 8px 8px; background-position: 0 0, 0 4px, 4px -4px, -4px 0; background-color: #fff; }
.nx-kit .nx-swatch-fill { position: absolute; inset: 0; }
.nx-kit.nx-kit .nx-swatch input[type=color] { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: none; padding: 0; }

/* ---- combobox ---- */
.nx-kit .nx-combo { position: relative; }
.nx-kit .nx-menu { position: absolute; z-index: 1000; left: 0; right: 0; top: calc(100% + 2px); max-height: 220px; overflow-y: auto;
  background: var(--nx-bg); border: 1px solid var(--nx-border); border-radius: var(--nx-radius); box-shadow: 0 4px 12px rgba(0,0,0,0.15); padding: 2px 0; }
.nx-kit .nx-menu-item { display: flex; flex-direction: column; padding: 4px 8px; cursor: pointer; font-size: 11.5px; color: var(--nx-text-strong); }
.nx-kit .nx-menu-item small { font-family: var(--nx-mono); font-size: 10px; color: var(--nx-text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nx-kit .nx-menu-item.nx-active, .nx-kit .nx-menu-item:hover { background: var(--nx-bg-selected); }
.nx-kit .nx-menu-empty { padding: 6px 8px; font-size: 11px; color: var(--nx-text-faint); }

/* ---- code launcher ---- */
.nx-kit .nx-code { display: flex; gap: 4px; }
.nx-kit .nx-code-preview { flex: 1 1 auto; min-width: 0; height: var(--nx-control-h); padding: 0 7px; display: flex; align-items: center; gap: 6px;
  font-family: var(--nx-mono); font-size: 11px; color: var(--nx-text-muted); background: var(--nx-bg-subtle); border: 1px solid var(--nx-border-subtle); border-radius: var(--nx-radius); overflow: hidden; }
.nx-kit .nx-code-preview span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nx-kit .nx-code-preview .nx-empty-text { font-family: var(--nx-font); font-style: italic; color: var(--nx-text-faint); }

/* ---- tag ---- */
.nx-kit .nx-tag-status { display: flex; align-items: center; gap: 5px; margin-top: 3px; font-size: 10.5px; color: var(--nx-text-faint); min-width: 0; }
.nx-kit .nx-tag-status span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nx-kit .nx-tag-status.nx-ok { color: var(--nx-success); }
.nx-kit .nx-tag-status.nx-bad { color: var(--nx-error); }

/* ---- list ---- */
.nx-kit .nx-list { border: 1px solid var(--nx-border-subtle); border-radius: var(--nx-radius); background: var(--nx-bg); }
.nx-kit .nx-list-row { display: flex; align-items: flex-start; gap: 6px; padding: 6px 6px 0; border-bottom: 1px solid var(--nx-border-subtle); background: var(--nx-bg); }
.nx-kit .nx-list-row.nx-dragging { opacity: 0.4; }
.nx-kit .nx-list-row.nx-drop-before { box-shadow: inset 0 2px 0 var(--nx-accent); }
.nx-kit .nx-list-grip { flex: 0 0 auto; width: 12px; padding-top: 5px; color: var(--nx-text-faint); cursor: grab; text-align: center; }
.nx-kit .nx-list-body { flex: 1 1 auto; min-width: 0; }
.nx-kit .nx-list-body .nx-field { margin-bottom: 6px; }
.nx-kit .nx-list-foot { display: flex; align-items: center; justify-content: space-between; padding: 5px 6px; }
.nx-kit .nx-list-empty { padding: 8px; font-size: 11px; color: var(--nx-text-faint); text-align: center; border-bottom: 1px solid var(--nx-border-subtle); }

/* ---- layout: nx-section, nx-tabs / nx-tab, nx-row (the elements carry these classes) ---- */
nx-section, nx-tabs, nx-tab, nx-row { display: block; }
.nx-section { border-top: 1px solid var(--nx-border-subtle); }
.nx-section:first-child, .nx-tabs-bar + .nx-section, nx-tab > .nx-section:first-of-type { border-top: none; }
.nx-kit.nx-kit .nx-section-head {
  display: flex; align-items: center; gap: 6px; width: 100%; margin: 0; padding: 9px 0 7px; border: none; background: transparent; box-shadow: none;
  font-family: var(--nx-font); font-size: 10.5px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--nx-text-muted); cursor: pointer; text-align: left;
}
.nx-kit.nx-kit .nx-section-head[hidden] { display: none; }
.nx-section-head .nx-chevron { width: 10px; color: var(--nx-text-faint); transition: transform 120ms ease; }
.nx-section.nx-collapsed > .nx-section-head .nx-chevron { transform: rotate(-90deg); }
.nx-section-head .nx-title { flex: 1 1 auto; }
.nx-section.nx-collapsed > :not(.nx-section-head) { display: none !important; }
.nx-section > :last-child { margin-bottom: 4px; }
.nx-kit .nx-tabs-bar { display: flex; gap: 2px; border-bottom: 1px solid var(--nx-border-subtle); margin: 0 0 8px; overflow-x: auto; scrollbar-width: none; }
.nx-kit.nx-kit .nx-tab {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; margin: 0 0 -1px; padding: 6px 9px; border: none; border-bottom: 2px solid transparent;
  background: transparent; box-shadow: none; font-family: var(--nx-font); font-size: 11px; font-weight: 600; color: var(--nx-text-muted); cursor: pointer; border-radius: 0;
}
.nx-kit.nx-kit .nx-tab:hover { color: var(--nx-text-strong); }
.nx-kit.nx-kit .nx-tab.nx-on { color: var(--nx-text-strong); border-bottom-color: var(--nx-accent); }
nx-tab[hidden] { display: none !important; }
.nx-row { display: grid; grid-template-columns: repeat(var(--nx-cols, 2), minmax(0, 1fr)); column-gap: var(--nx-gap); }
.nx-kit .nx-tag-providers { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 4px; }

/* ---- alert / badge ---- */
.nx-kit .nx-alert { display: flex; gap: 7px; margin: 0 0 10px; padding: 7px 9px; font-size: 11px; line-height: 1.4; border-radius: var(--nx-radius);
  background: var(--red-ui-form-tips-background, var(--nx-bg-subtle)); border: 1px solid var(--nx-border-subtle); border-left: 3px solid var(--nx-accent); color: var(--nx-text); }
.nx-kit .nx-alert.nx-warn { border-left-color: var(--nx-warn); }
.nx-kit .nx-alert.nx-error { border-left-color: var(--nx-error); }
.nx-kit .nx-alert.nx-success { border-left-color: var(--nx-success); }
.nx-kit .nx-badge { display: inline-flex; align-items: center; gap: 3px; padding: 0 6px; height: 16px; border-radius: 8px; font-size: 9.5px; font-weight: 700;
  letter-spacing: 0.3px; text-transform: none; background: var(--nx-bg-selected); color: var(--nx-text-muted); white-space: nowrap; }
.nx-kit .nx-badge.nx-accent { background: var(--nx-accent); color: #fff; }
.nx-kit .nx-badge.nx-warn { background: var(--nx-warn); color: #fff; }
.nx-kit .nx-badge.nx-error { background: var(--nx-error); color: #fff; }
.nx-kit .nx-badge.nx-success { background: var(--nx-success); color: #fff; }

/* ---- state switcher ---- */
.nx-kit .nx-states { display: flex; flex-wrap: wrap; gap: 4px; }
.nx-kit.nx-kit .nx-state {
  display: inline-flex; align-items: center; gap: 5px; height: 22px; margin: 0; padding: 0 8px; font-family: inherit; font-size: 11px; color: var(--nx-text-muted);
  background: var(--nx-bg); border: 1px solid var(--nx-border); border-radius: 11px; cursor: pointer; box-shadow: none;
}
.nx-kit.nx-kit .nx-state:hover { background: var(--nx-bg-hover); }
.nx-kit.nx-kit .nx-state.nx-on { color: var(--nx-text-strong); font-weight: 600; border-color: var(--nx-accent); box-shadow: 0 0 0 1px var(--nx-accent); }
.nx-kit .nx-state-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--nx-text-faint); }

/* ---- tree (the MQTT Sparkplug explorer's look) ---- */
.nx-kit .nx-tree { font-size: 12px; user-select: none; width: max-content; min-width: 100%; }
.nx-kit .nx-tree-row { position: relative; display: flex; align-items: center; gap: 5px; min-height: 24px; padding: 2px 6px 2px 4px; border-radius: 3px; cursor: default; color: var(--nx-text-strong); white-space: nowrap; }
.nx-kit .nx-tree-row:hover { background: var(--nx-bg-hover); }
.nx-kit .nx-tree-row.nx-on { background: var(--nx-bg-selected); box-shadow: inset 2px 0 0 var(--nx-accent); }
.nx-kit .nx-tree-row.nx-muted { color: var(--nx-text-faint); }
.nx-kit .nx-tree-row.nx-muted .nx-tree-label { font-style: italic; }
.nx-kit .nx-tree-row.nx-drop-before { box-shadow: inset 0 2px 0 var(--nx-accent); }
.nx-kit .nx-tree-row.nx-drop-after { box-shadow: inset 0 -2px 0 var(--nx-accent); }
.nx-kit .nx-tree-row.nx-drop-inside { background: var(--nx-bg-selected); outline: 1px dashed var(--nx-accent); outline-offset: -1px; }
.nx-kit .nx-tree-indent { flex: 0 0 auto; align-self: stretch; }
.nx-kit .nx-tree-caret { flex: 0 0 10px; width: 10px; color: var(--nx-text-muted); text-align: center; cursor: pointer; }
.nx-kit .nx-tree-icon { flex: 0 0 auto; width: 14px; text-align: center; color: var(--nx-text-muted); }
.nx-kit .nx-tree-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nx-kit.nx-kit .nx-tree-rename { flex: 1 1 auto; height: 20px; min-height: 20px; padding: 0 4px; font-size: 12px; }
.nx-kit .nx-tree-actions { flex: 0 0 auto; display: flex; gap: 2px; opacity: 0.45; margin-left: auto; }
.nx-kit .nx-tree-row:hover .nx-tree-actions, .nx-kit .nx-tree-row.nx-on .nx-tree-actions, .nx-kit .nx-tree-actions .nx-on { opacity: 1; }
.nx-kit .nx-tree-children { margin-left: 9px; border-left: 1px dotted var(--nx-border); }
.nx-kit .nx-tree-empty { padding: 10px; font-size: 11px; color: var(--nx-text-faint); text-align: center; }

/* ---- dialog ---- */
.nx-dialog-backdrop { position: fixed; inset: 0; z-index: 100000; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.35); }
.nx-kit .nx-dialog { min-width: 320px; max-width: min(640px, 92vw); max-height: 86vh; display: flex; flex-direction: column; background: var(--red-ui-primary-background, #fff);
  border: 1px solid var(--nx-border); border-radius: 4px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); }
.nx-kit .nx-dialog-title { padding: 10px 14px; font-weight: 700; font-size: 13px; color: var(--nx-text-strong); border-bottom: 1px solid var(--nx-border-subtle); }
.nx-kit .nx-dialog-body { padding: 12px 14px; overflow: auto; }
.nx-kit .nx-dialog-foot { display: flex; justify-content: flex-end; gap: 6px; padding: 8px 14px; border-top: 1px solid var(--nx-border-subtle); }
.nx-kit.nx-kit .nx-btn.nx-primary { background: var(--nx-accent); border-color: var(--nx-accent); color: #fff; }
.nx-kit.nx-kit .nx-btn.nx-pt-action.nx-on { border-color: var(--nx-accent); background: var(--nx-bg-selected); font-weight: 600; }
.nx-kit .nx-pt-info { margin: 0 0 8px; font-size: 11.5px; color: var(--nx-text-muted); }

/* the prop currently previewed in the state switcher */
.nx-kit .nx-field.nx-current > .nx-field-head .nx-label { color: var(--nx-accent); }
/* nx-binding (binding.js) */
.nx-kit .nx-binding { display: flex; flex-direction: column; gap: 6px; }
.nx-kit .nx-binding-source { width: 100%; }
.nx-kit.nx-kit .nx-binding-source .nx-seg-item { flex: 1 1 0; min-width: 0; padding-left: 2px; padding-right: 2px; font-size: 11px; }
.nx-kit.nx-kit .nx-binding-source .nx-seg-item i { display: none; }
.nx-kit.nx-kit .nx-binding-source .nx-seg-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nx-kit .nx-binding-expr { display: flex; flex-direction: column; gap: 4px; }
/* theme tokens (base.js): the ◆ picker, a token as a chip */
.nx-kit .nx-token-panel { margin: 0 0 4px; border: 1px solid var(--nx-border); border-radius: var(--nx-radius); background: var(--nx-bg); padding: 4px; }
.nx-kit.nx-kit .nx-token-filter { width: 100%; box-sizing: border-box; margin-bottom: 4px; }
.nx-kit .nx-token-list { max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; }
.nx-kit.nx-kit .nx-token-item { display: flex; align-items: center; gap: 6px; padding: 2px 4px; margin: 0; border: none; background: transparent; text-align: left; cursor: pointer; font-size: 11px; border-radius: 3px; }
.nx-kit.nx-kit .nx-token-item:hover { background: var(--nx-bg-hover); }
.nx-kit .nx-token-swatch { flex: 0 0 auto; width: 14px; height: 14px; border-radius: 3px; border: 1px solid rgba(0,0,0,0.15); }
.nx-kit .nx-token-path { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--nx-mono, monospace); color: var(--nx-text); }
.nx-kit .nx-token-val { flex: 0 1 auto; color: var(--nx-text-faint); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 45%; }
.nx-kit .nx-token-chip { display: flex; align-items: center; gap: 6px; padding: 3px 4px 3px 6px; border: 1px solid var(--nx-accent); border-radius: var(--nx-radius); background: var(--nx-bg); font-size: 11px; min-height: 22px; }
.nx-kit .nx-token-chip > .fa-diamond { color: var(--nx-accent); font-size: 10px; }
/* a bound field's fallback (base.js frame) */
.nx-kit .nx-fallback { margin-top: 6px; padding: 6px 0 0; border-top: 1px dashed var(--nx-border-subtle); }
.nx-kit .nx-fallback-label { font-size: 10.5px; color: var(--nx-text-faint); margin-bottom: 3px; }
/* a field's breakpoint chips (base.js frame, the 📱 of a field) */
.nx-kit .nx-bp-strip { display: flex; flex-wrap: wrap; gap: 3px; margin: 0 0 4px; }
.nx-kit.nx-kit .nx-bp-chip { display: inline-flex; align-items: center; gap: 3px; height: 18px; padding: 0 5px; margin: 0; font-size: 10px; line-height: 1;
    border: 1px solid var(--nx-border); border-radius: 9px; background: var(--nx-bg); color: var(--nx-text-faint); cursor: pointer; }
.nx-kit.nx-kit .nx-bp-chip:hover { color: var(--nx-text); background: var(--nx-bg-hover); }
.nx-kit.nx-kit .nx-bp-chip.nx-set { color: var(--nx-text-strong); border-color: var(--nx-accent); }
.nx-kit.nx-kit .nx-bp-chip.nx-design { color: var(--nx-text-strong); }
.nx-kit.nx-kit .nx-bp-chip.nx-sel { background: var(--nx-accent); border-color: var(--nx-accent); color: #fff; }
.nx-kit .nx-bp-chip .nx-bp-val { font-family: var(--nx-mono, monospace); opacity: .85; max-width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nx-kit .nx-bp-chip .nx-bp-x { margin-left: 1px; opacity: .8; }
.nx-kit .nx-bp-chip .nx-bp-x:hover { opacity: 1; }
.nx-kit.nx-kit .nx-binding-expr textarea { width: 100%; box-sizing: border-box; resize: vertical; }
/* nx-align, nx-spacing (layout-widgets.js) */
.nx-kit .nx-align { display: grid; grid-template-columns: repeat(3, 22px); grid-template-rows: repeat(3, 22px); gap: 2px; padding: 3px; width: max-content;
    border: 1px solid var(--nx-border); border-radius: var(--nx-radius); background: var(--nx-bg); }
.nx-kit.nx-kit .nx-align-cell { display: flex; align-items: center; justify-content: center; padding: 0; margin: 0; border: none; border-radius: 3px; background: transparent; cursor: pointer; }
.nx-kit.nx-kit .nx-align-cell span { width: 4px; height: 4px; border-radius: 50%; background: var(--nx-text-muted, #999); }
.nx-kit.nx-kit .nx-align-cell:hover:not(:disabled) { background: var(--nx-bg-hover); }
.nx-kit.nx-kit .nx-align-cell.nx-on span { width: 12px; height: 12px; border-radius: 2px; background: var(--nx-accent, #ff5722); }
.nx-kit .nx-spacing { display: flex; gap: 4px; align-items: center; }
.nx-kit.nx-kit .nx-spacing-input { flex: 1 1 0; min-width: 0; width: auto; }

/* ---- the inspector: property tree + editor pane (prop-tree/view.js) ---- */
.nx-kit .nx-pt { display: flex; flex-direction: column; min-width: 0; }
.nx-kit .nx-pt-head { display: grid; gap: 6px; padding: 0 0 6px; }
.nx-kit .nx-pt-search { display: flex; align-items: center; gap: 6px; height: var(--nx-control-h); padding: 0 7px; margin: 0;
    background: var(--nx-bg); border: 1px solid var(--nx-border); border-radius: var(--nx-radius); color: var(--nx-text-faint); cursor: text; font-weight: normal; }
.nx-kit .nx-pt-search:focus-within { border-color: var(--nx-focus); box-shadow: 0 0 0 1px var(--nx-focus); }
.nx-kit.nx-kit .nx-pt-search input.nx-pt-q { flex: 1 1 auto; min-width: 0; width: auto; height: 100%; margin: 0; padding: 0; border: none; outline: none; box-shadow: none;
    background: transparent; color: var(--nx-text-strong); font: inherit; font-size: 12px; }
.nx-kit .nx-pt-hits { flex: 0 0 auto; font-size: 10.5px; color: var(--nx-text-faint); white-space: nowrap; }
.nx-kit .nx-pt-tree { height: var(--nx-pt-h, 260px); overflow: auto; outline: none; padding: 2px 0;
    border: 1px solid var(--nx-border-subtle); border-radius: var(--nx-radius) var(--nx-radius) 0 0; background: var(--nx-bg); }
.nx-kit .nx-pt-max .nx-pt-tree { height: 84px; }
.nx-kit .nx-pt-tree:focus-visible { border-color: var(--nx-focus); }
.nx-kit .nx-pt-row { display: grid; grid-template-columns: 14px minmax(0, 1fr) minmax(0, 1.1fr); align-items: center; gap: 4px; height: 22px;
    padding: 0 6px 0 calc(3px + var(--d, 0) * 12px); cursor: default; user-select: none; }
.nx-kit .nx-pt-row:hover { background: var(--nx-bg-hover); }
.nx-kit .nx-pt-row.nx-on { background: var(--nx-bg-selected); box-shadow: inset 2px 0 0 var(--nx-accent); }
.nx-kit .nx-pt-group, .nx-kit .nx-pt-section { grid-template-columns: 14px minmax(0, 1fr) auto; }
.nx-kit .nx-pt-group .nx-pt-label { font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--nx-text-muted); }
.nx-kit .nx-pt-section .nx-pt-label { font-weight: 600; color: var(--nx-text-muted); }
.nx-kit .nx-pt-item .nx-pt-label { font-weight: 600; }
.nx-kit.nx-kit .nx-pt-caret { display: flex; align-items: center; justify-content: center; width: 14px; height: 14px; margin: 0; padding: 0; border: none;
    background: none; color: var(--nx-text-faint); cursor: pointer; border-radius: 2px; }
.nx-kit .nx-pt-caret svg { transition: transform .1s; }
.nx-kit .nx-pt-caret.nx-open svg { transform: rotate(90deg); }
.nx-kit .nx-pt-label { display: flex; align-items: center; gap: 4px; min-width: 0; color: var(--nx-text-strong); }
.nx-kit .nx-pt-t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.nx-kit .nx-pt-val { display: flex; align-items: center; gap: 5px; min-width: 0; font-family: var(--nx-mono); font-size: 10.5px; color: var(--nx-text-muted); font-variant-numeric: tabular-nums; }
.nx-kit .nx-pt-count { color: var(--nx-text-faint); font-family: inherit; }
.nx-kit .nx-pt-none { color: var(--nx-text-faint); font-style: italic; font-family: var(--nx-font); }
.nx-kit .nx-pt-swatch { flex: 0 0 auto; width: 11px; height: 11px; border-radius: 2px; border: 1px solid var(--nx-border); }
.nx-kit .nx-pt-check { flex: 0 0 auto; position: relative; width: 11px; height: 11px; border-radius: 2px; border: 1px solid var(--nx-border); background: var(--nx-bg); }
.nx-kit .nx-pt-check.nx-on { background: var(--nx-accent); border-color: var(--nx-accent); }
.nx-kit .nx-pt-check.nx-on::after { content: ""; position: absolute; left: 2.5px; top: 1px; width: 3px; height: 6px; border: solid #fff; border-width: 0 1.5px 1.5px 0; transform: rotate(45deg); }
.nx-kit .nx-pt-mark { flex: 0 0 auto; color: var(--nx-accent); font-size: 11px; }
.nx-kit .nx-pt-bad { flex: 0 0 auto; color: var(--nx-error); font-size: 11px; }
.nx-kit .nx-pt-warn { flex: 0 0 auto; color: var(--nx-warn); font-size: 11px; }
.nx-kit .nx-pt mark { background: var(--nx-warn); color: #fff; border-radius: 2px; padding: 0 1px; }
.nx-kit .nx-pt-empty { padding: 14px 8px; font-size: 11px; color: var(--nx-text-faint); text-align: center; }
.nx-kit .nx-pt-split { flex: 0 0 auto; height: 7px; cursor: row-resize; touch-action: none; display: flex; align-items: center; justify-content: center;
    background: var(--nx-bg-subtle); border: 1px solid var(--nx-border-subtle); border-top: none; border-radius: 0 0 var(--nx-radius) var(--nx-radius); }
.nx-kit .nx-pt-split::after { content: ""; width: 26px; height: 2px; border-radius: 1px; background: var(--nx-border); }
.nx-kit .nx-pt-pane { padding: 10px 0 0; min-width: 0; }
.nx-kit .nx-pt-panehead { display: flex; align-items: flex-start; gap: 6px; }
.nx-kit .nx-pt-panehead .nx-pt-crumb { flex: 1 1 auto; }
.nx-kit .nx-pt-crumb { display: flex; flex-wrap: wrap; gap: 0 5px; margin: 0 0 6px; font-size: 10.5px; color: var(--nx-text-faint); min-width: 0; }
.nx-kit .nx-pt-crumb span + span::before { content: "A"; margin-right: 5px; }
.nx-kit .nx-pt-title { margin: 0 0 6px; font-size: 13px; font-weight: 600; color: var(--nx-text-strong); }
.nx-kit .nx-pt-items { border: 1px solid var(--nx-border-subtle); border-radius: var(--nx-radius); margin: 0 0 8px; }
.nx-kit .nx-pt-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px; min-height: 26px; padding: 0 4px 0 8px; border-top: 1px solid var(--nx-border-subtle); }
.nx-kit .nx-pt-item:first-child { border-top: none; }
.nx-kit .nx-pt-item > .nx-pt-val { justify-content: flex-end; max-width: 150px; }
.nx-kit.nx-kit .nx-pt-go { margin: 0; padding: 3px 0; border: none; background: none; text-align: left; font: inherit; color: var(--nx-text-strong); cursor: pointer;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.nx-kit.nx-kit .nx-pt-go:hover { color: var(--nx-accent); text-decoration: underline; }
.nx-kit .nx-pt-tools { display: inline-flex; gap: 1px; }
.nx-kit .nx-pt-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 0 0 10px; }
.nx-kit.nx-kit .nx-pt-danger { color: var(--nx-error); }
.nx-kit .nx-pt-form > * { display: block; }
.nx-kit .nx-pt-dialogrow { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 4px 4px 4px 8px; border: 1px solid var(--nx-border-subtle); border-radius: var(--nx-radius); }
.nx-kit .nx-pt-dialogrow .nx-pt-t { flex: 1 1 auto; font-family: var(--nx-mono); font-size: 11px; }
.nx-kit.nx-kit .nx-btn.nx-primary { background: var(--nx-accent); border-color: var(--nx-accent); color: #fff; }
`;

export function ensureStyles(doc) {
    doc = doc || document;
    if (doc.getElementById("nexa-kit-styles")) return;
    var style = doc.createElement("style");
    style.id = "nexa-kit-styles";
    style.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(style);
}
