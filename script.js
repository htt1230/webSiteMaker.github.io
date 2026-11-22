"use strict";

const byId = id => document.getElementById(id);
const sheet = byId("sheet");
const viewport = byId("viewport");
const shell = byId("shell");
const properties = byId("properties");
const sourceSheet = byId("source-sheet");
const sourceOutline = byId("source-outline");
const inspectBox = byId("inspect-box");
const inspectTooltip = byId("inspect-tooltip");
const canvasSpacing = byId("canvas-spacing");
const spacingControls = canvasSpacing.querySelector(".canvas-spacing-controls");
const spacingBar = canvasSpacing.querySelector(".canvas-spacing-bar");
const spacingGrips = Array.from(canvasSpacing.querySelectorAll(".canvas-spacing-grip"));
const inspectToggle = byId("inspect-toggle");
const sourceResize = byId("source-resize");
const sourceCode = byId("source-code");
const codePanel = byId("code-panel");
const codeToggle = byId("code-toggle");
const types = {text:"テキスト", image:"画像", button:"ボタン", shape:"四角形", header:"ヘッダー", footer:"フッター"};
const symbols = {text:"T", image:"▧", button:"▣", shape:"■", header:"▔", footer:"▁"};
const regionPresets = {
  header:{text:"サイト名",desktop:[72,24,28],mobile:[60,20,16]},
  footer:{text:"© サイト名",desktop:[64,16,28],mobile:[56,14,16]}
};
const widths = {desktop:960, mobile:390};
const storageKey = "sitecanvas-v1";
const saveInterval = 60000;
const savedTimeFormat = new Intl.DateTimeFormat("ja-JP",{dateStyle:"short",timeStyle:"medium"});
const sizeFormat = new Intl.NumberFormat("ja-JP",{maximumFractionDigits:2});
const fontOptions = {sans:"ゴシック", serif:"明朝", mono:"等幅"};
const fonts = {
  sans:'"BIZ UDPGothic","Hiragino Sans","Yu Gothic",Meiryo,system-ui,sans-serif',
  serif:'"BIZ UDPMincho","Hiragino Mincho ProN","Yu Mincho",serif',
  mono:'"BIZ UDGothic",ui-monospace,monospace'
};
const colorPattern = /^#[0-9a-f]{6}$/i;
const imagePattern = /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/;
const past = [], future = [];
const sides = {top:"上",right:"右",bottom:"下",left:"左"};
let view = "desktop";
let selected = null;
let scale = 1, gesture, imageRequest, statusTimer;
let codeBase = "";
let previewSource, sourceDocument, previewRevision = 0;
let sourceScroll;
let pendingField;
let inspectMode = false;
let inspectedPath = null;
let hoveredElement = null;
let sourceResizeGesture;
let spacingGesture;
let canvasSpacingTarget;
const inspectorSections = new Map();

function id() {
  return "item-" + (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
}
function rect(x,y,w,h,size = 24) {
  return {x,y,w,h,size,padding:readSpacing(),margin:readSpacing()};
}
function readSpacing(value,minimum = 0) {
  return Object.fromEntries(Object.keys(sides).map(side => [side,number(value?.[side],0,minimum,8000)]));
}
function spacingCSS(spacing,unit = value => value + "px") {
  return Object.keys(sides).map(side => unit(spacing[side])).join(" ");
}
function blank() {
  return {version:1,title:"無題のサイト",background:"#ffffff",heights:{desktop:640,mobile:760},items:[]};
}
function make(type, desktop, mobile, overrides = {}) {
  return {
    id:id(),type,text:type === "text" ? "テキストを入力" : type === "button" ? "ボタン" : "",
    color:"#202821",fill:"#225840",font:"sans",bold:false,align:"left",radius:0,
    href:"",src:"",alt:"",desktop,mobile,...overrides
  };
}
function isPageRegion(type) {
  return Object.hasOwn(regionPresets,type);
}
function hasFill(type) {
  return type === "shape" || type === "button" || isPageRegion(type);
}
function example() {
  const site = blank();
  site.title = "サンプルページ";
  site.background = "#f7f6f1";
  site.items = [
    make("shape",rect(541,54,355,497),rect(24,349,342,351),{fill:"#dce8d7",radius:18}),
    make("shape",rect(588,124,260,260),rect(68,393,254,254),{fill:"#b5d192",radius:500}),
    make("shape",rect(642,222,155,183),rect(126,475,138,154),{fill:"#32644b",radius:500}),
    make("shape",rect(728,294,89,89),rect(202,541,73,73),{fill:"#f0d676",radius:500}),
    make("text",rect(62,62,430,32,18),rect(24,41,342,26,14),{text:"YOUR WEBSITE",color:"#32644b",bold:true}),
    make("text",rect(60,135,465,170,65),rect(24,83,342,113,43),{text:"余白から、\nはじめよう。",color:"#203b2d",bold:true}),
    make("text",rect(63,337,420,100,21),rect(24,214,342,60,16),{text:"ここを選んで、自分のサイトの文章に変えてみよう。",color:"#3c5747"}),
    make("button",rect(63,455,184,54,17),rect(24,284,163,44,15),{text:"詳しく見る",color:"#ffffff",bold:true,align:"center",radius:8})
  ];
  return site;
}

function clamp(value,minimum,maximum) {
  return Math.max(minimum,Math.min(maximum,value));
}
function number(value,fallback,min,max) {
  return typeof value === "number" && Number.isFinite(value) ? clamp(Math.round(value),min,max) : fallback;
}
function safeColor(value,fallback) {
  return typeof value === "string" && colorPattern.test(value) ? value : fallback;
}
function safeImage(value) {
  return typeof value === "string" && value.length <= 12000000 && imagePattern.test(value) ? value : "";
}
function safeLink(value) {
  if (typeof value !== "string") return "";
  const link = value.trim();
  if (!/^(?:https?:\/\/|mailto:|tel:)/i.test(link)) return "";
  try { return new URL(link).href; } catch { return ""; }
}
function boundedRect(raw,width,height) {
  const x = number(raw?.x,16,0,width-16);
  const y = number(raw?.y,16,0,height-16);
  return {
    x,y,w:number(raw?.w,16,16,width-x),h:number(raw?.h,16,16,height-y),size:number(raw?.size,24,8,160),
    padding:readSpacing(raw?.padding),margin:readSpacing(raw?.margin,-8000)
  };
}
function readProject(raw, getImage, keepIds = false) {
  if (raw?.version !== 1 || !Array.isArray(raw.items) || raw.items.length > 500) {
    throw new Error("SiteCanvasから書き出したHTMLを選んでください。");
  }
  const result = blank();
  result.title = typeof raw.title === "string" ? raw.title.slice(0,160) : result.title;
  if (typeof raw.fileName === "string") result.fileName = raw.fileName;
  if (typeof raw.source === "string") return {...result,source:raw.source};
  result.background = safeColor(raw.background,result.background);
  for (const name of Object.keys(widths)) {
    result.heights[name] = number(raw.heights?.[name],result.heights[name],300,8000);
  }
  const ids = new Set();
  for (const item of raw.items) {
    if (!item || !Object.hasOwn(types,item.type)) continue;
    const data = make(item.type,
      boundedRect(item.desktop,widths.desktop,result.heights.desktop),
      boundedRect(item.mobile,widths.mobile,result.heights.mobile));
    if (keepIds && typeof item.id === "string" && /^item-[a-z0-9-]+$/i.test(item.id) && !ids.has(item.id)) data.id = item.id;
    ids.add(data.id);
    data.text = typeof item.text === "string" ? item.text.slice(0,4000) : data.text;
    data.alt = typeof item.alt === "string" ? item.alt.slice(0,500) : "";
    data.color = safeColor(item.color,data.color);
    data.fill = safeColor(item.fill,data.fill);
    data.font = Object.hasOwn(fontOptions,item.font) ? item.font : data.font;
    data.align = ["left","center","right"].includes(item.align) ? item.align : data.align;
    data.bold = item.bold === true;
    data.radius = number(item.radius,0,0,500);
    data.href = safeLink(item.href);
    data.src = safeImage(getImage ? getImage(item.id) : item.src);
    result.items.push(data);
  }
  return result;
}
function loadWorkspace() {
  try {
    const content = localStorage.getItem(storageKey);
    if (content) {
      const saved = JSON.parse(content);
      return {
        project:readProject(saved.project ?? saved,undefined,true),
        editor:saved.editor ?? {},
        savedAt:Number.isFinite(Date.parse(saved.savedAt)) ? saved.savedAt : null
      };
    }
  } catch {}
  return {project:example(),editor:{},savedAt:null};
}
const workspace = loadWorkspace();
let project = workspace.project;
view = workspace.editor.view === "mobile" ? "mobile" : "desktop";
inspectMode = workspace.editor.inspectMode === true;
function isTagPath(value) {
  return typeof value === "string" && /^(?:\d+(?:\.\d+)*)?$/.test(value);
}
if (isTagPath(workspace.editor.inspectedPath)) inspectedPath = workspace.editor.inspectedPath;
const restoredSelection = workspace.editor.selected;
if (typeof project.source === "string") {
  if (isTagPath(restoredSelection)) selected = restoredSelection;
} else {
  selected = project.items.find(item => item.id === restoredSelection)?.id ?? null;
}
let showFiles = workspace.editor.showFiles === true;
let lastSavedAt = workspace.savedAt;
let savePending = false;
let saveError = false;

function status(message) {
  byId("status").textContent = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { byId("status").textContent = ""; },4000);
}
function renderSaveStatus() {
  const label = byId("save-state");
  const message = saveError ? "ローカルに保存できません" : savePending ? "自動保存待ち" :
    lastSavedAt ? "ローカルに保存済み" : "最終保存時刻なし";
  if (label.textContent !== message) label.textContent = message;
  label.dataset.error = String(saveError);
  byId("save-time").hidden = !lastSavedAt;
  if (lastSavedAt) {
    const time = byId("saved-at");
    time.dateTime = lastSavedAt;
    time.textContent = savedTimeFormat.format(new Date(lastSavedAt));
  }
}
function queueSave() {
  if (savePending) return;
  savePending = true;
  renderSaveStatus();
}
function flushSave() {
  if (pendingField?.isConnected) pendingField.dispatchEvent(new Event("change",{bubbles:true}));
  if (!savePending) return;
  const savedAt = new Date().toISOString();
  const editor = {view,selected,showFiles,inspectMode,inspectedPath,codeOpen:!codePanel.hidden,draft:codeDirty() ? sourceCode.value : null};
  try {
    localStorage.setItem(storageKey,JSON.stringify({project,editor,savedAt}));
    lastSavedAt = savedAt;
    savePending = saveError = false;
  } catch {
    saveError = true;
  }
  renderSaveStatus();
}
function snapshot() {
  return {project:structuredClone(project),selected};
}
function record(before) {
  past.push(before);
  if (past.length > 50) past.shift();
  future.length = 0;
  queueSave();
}
function change(update) {
  const before = snapshot();
  update();
  record(before);
  render();
}
function restore(from,to) {
  if (!from.length) return;
  const fromSource = typeof project.source === "string";
  to.push(snapshot());
  ({project,selected} = from.pop());
  if (fromSource && typeof project.source !== "string") {
    inspectMode = false;
    inspectedPath = hoveredElement = null;
  }
  queueSave();
  render();
}
function itemSelected() {
  return project.items.find(item => item.id === selected);
}
function titleFor(item) {
  return item.text.trim().split("\n")[0] || item.alt || types[item.type];
}
function itemTag(item) {
  if (isPageRegion(item.type)) return item.type;
  return item.type === "button" && item.href ? "a" : "div";
}
function footerAtBottom(item,position) {
  return item.type === "footer" && position.y + position.h === project.heights[view];
}
function select(which) {
  if (selected === which) return;
  selected = which;
  queueSave();
  render();
}
function textStyle(item) {
  const align = {left:"flex-start",center:"center",right:"flex-end"};
  return {
    color:item.color,fontFamily:fonts[item.font],fontWeight:item.bold ? "700" : "400",
    textAlign:item.align,justifyContent:align[item.align],
    alignItems:item.type === "button" || isPageRegion(item.type) ? "center" : "flex-start"
  };
}
function renderArt() {
  const usesSource = tagCanvas();
  sheet.hidden = usesSource;
  sourceSheet.hidden = !usesSource;
  if (usesSource) {
    renderSourceSheet();
    fit();
    return;
  }
  if (previewSource !== undefined) {
    previewSource = sourceDocument = sourceScroll = undefined;
    sourceSheet.removeAttribute("srcdoc");
    sourceOutline.hidden = sourceResize.hidden = true;
    showInspection(null);
  }
  sheet.style.width = widths[view] + "px";
  sheet.style.height = project.heights[view] + "px";
  sheet.style.backgroundColor = project.background;
  const elements = project.items.map(item => {
    const element = document.createElement("div");
    element.className = "object" + (item.id === selected ? " selected" : "");
    element.dataset.id = item.id;
    const position = item[view];
    Object.assign(element.style,textStyle(item),{
      left:position.x + "px",top:position.y + "px",width:position.w + "px",
      height:position.h + "px",fontSize:position.size + "px",borderRadius:item.radius + "px",
      padding:spacingCSS(position.padding),margin:spacingCSS(position.margin),
      backgroundColor:hasFill(item.type) ? item.fill : "transparent"
    });
    const content = document.createElement("div");
    content.className = "object-content";
    if (item.type === "image") {
      const image = document.createElement("img");
      image.src = item.src;
      image.alt = item.alt;
      image.draggable = false;
      content.append(image);
    } else {
      content.textContent = item.text;
    }
    element.append(content);
    if (item.id === selected) {
      const handle = document.createElement("span");
      handle.className = "handle";
      if (footerAtBottom(item,position)) handle.classList.add("from-top");
      handle.setAttribute("aria-hidden","true");
      element.append(handle);
    }
    return element;
  });
  sheet.replaceChildren(...elements);
  fit();
}
function fit() {
  const padding = getComputedStyle(viewport);
  const available = viewport.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
  if (available <= 0) return;
  scale = Math.min(1,available / widths[view]);
  const art = sourceSheet.hidden ? sheet : sourceSheet;
  art.style.transform = "scale(" + scale + ")";
  if (art === sourceSheet) {
    art.style.width = widths[view] + "px";
    art.style.height = project.heights[view] + "px";
    highlightSource();
  }
  shell.style.width = widths[view] * scale + "px";
  shell.style.height = project.heights[view] * scale + "px";
  refreshCanvasSpacing();
  byId("stage-size").textContent = widths[view] + " × " + project.heights[view] + " px · " + Math.round(scale * 100) + "%";
}
function renderLayers() {
  const usesSource = tagCanvas();
  byId("add-heading").hidden = usesSource;
  byId("add-tools").hidden = usesSource;
  byId("layer-tools").hidden = usesSource;
  byId("layers-tab").textContent = usesSource ? "HTML 要素" : "レイヤー";
  byId("canvas-help").textContent = usesSource ? "クリックで選択 · 角のつまみでサイズ変更" :
    "ドラッグで移動 · 角のつまみでサイズ変更";
  if (usesSource) {
    renderSourceLayers();
    return;
  }
  const index = project.items.findIndex(item => item.id === selected);
  byId("front").disabled = index < 0 || index === project.items.length-1;
  byId("back").disabled = index <= 0;
  const rows = [...project.items].reverse().map(item => {
    const row = document.createElement("button");
    row.className = "layer";
    row.setAttribute("aria-pressed",String(item.id === selected));
    row.addEventListener("click",() => select(item.id));
    const symbol = document.createElement("span");
    symbol.textContent = symbols[item.type];
    symbol.setAttribute("aria-hidden","true");
    const name = document.createElement("span");
    name.textContent = titleFor(item);
    row.title = name.textContent;
    row.append(symbol,name);
    return row;
  });
  if (!rows.length) {
    const message = document.createElement("div");
    message.className = "empty";
    message.textContent = "要素を追加するとここに表示されます。";
    rows.push(message);
  }
  byId("layers").replaceChildren(...rows);
}
function renderHistory() {
  const dirty = codeDirty();
  byId("undo").disabled = dirty || past.length === 0;
  byId("redo").disabled = dirty || future.length === 0;
}
function render() {
  inspectToggle.setAttribute("aria-pressed",String(inspectMode));
  renderArt();
  renderLayers();
  renderFilePanel();
  renderProperties();
  refreshCode();
  renderHistory();
  for (const control of document.querySelectorAll("[data-view]")) {
    control.setAttribute("aria-pressed",String(control.dataset.view === view));
  }
}
function field(name, kind, value, update, options = {}) {
  const label = document.createElement("label");
  label.className = "field";
  label.append(name);
  const input = document.createElement(kind === "textarea" || kind === "select" ? kind : "input");
  if (input.tagName === "INPUT") input.type = kind;
  if (kind === "select") {
    for (const [key,caption] of Object.entries(options)) input.add(new Option(caption,key));
  } else {
    Object.assign(input,options);
  }
  if (kind === "checkbox") input.checked = value;
  else input.value = value;
  function commit() {
    if (pendingField === input) pendingField = undefined;
    const next = kind === "checkbox" ? input.checked : kind === "number" ? input.valueAsNumber : input.value;
    const before = snapshot();
    const actual = update(next);
    if (actual !== undefined && kind !== "checkbox") input.value = actual;
    if (JSON.stringify(before.project) !== JSON.stringify(project)) {
      record(before);
      renderArt();
      renderLayers();
      renderFilePanel();
      refreshCode();
      renderHistory();
    }
  }
  input.addEventListener("input",() => {
    pendingField = input;
    queueSave();
  });
  input.addEventListener("change",commit);
  label.append(input);
  return label;
}
function group(...controls) {
  const container = document.createElement("div");
  container.className = "group";
  container.append(...controls);
  return container;
}
function section(...controls) {
  const container = document.createElement("div");
  container.className = "property-group";
  container.append(...controls);
  return container;
}
function action(text,run) {
  const button = document.createElement("button");
  button.className = "action";
  button.textContent = text;
  button.addEventListener("click",run);
  return button;
}
function boxModel(spacingField,visibleElement) {
  const band = (key,caption,center) => {
    const layer = document.createElement("div");
    layer.className = "box-"+key;
    const label = document.createElement("p");
    label.className = "box-label";
    label.textContent = caption;
    const diagram = document.createElement("div");
    diagram.className = "box-diagram";
    center.classList.add("box-center");
    for (const [side,name] of Object.entries(sides)) {
      const edge = document.createElement("div");
      edge.className = "box-edge";
      edge.dataset.side = side;
      const control = spacingField(key,side);
      const input = control.querySelector("input");
      input.dataset.spacing = key + "-" + side;
      control.firstChild.remove();
      if (input.type === "number") input.addEventListener("keydown",event => {
        if (event.key === "Enter" && !event.isComposing) input.dispatchEvent(new Event("change",{bubbles:true}));
      });
      const arrow = document.createElement("button");
      arrow.type = "button";
      arrow.className = "box-arrow";
      arrow.tabIndex = -1;
      arrow.title = key + " " + name + "をドラッグして調整";
      arrow.setAttribute("aria-label",arrow.title);
      const icon = document.createElement("span");
      icon.textContent = "↑";
      icon.setAttribute("aria-hidden","true");
      arrow.append(icon);
      arrow.addEventListener("pointerdown",event => startSpacingDrag(event,arrow,input,key,side,visibleElement));
      edge.append(arrow,control);
      diagram.append(edge);
    }
    diagram.append(center);
    layer.append(label,diagram);
    return layer;
  };
  const content = document.createElement("div");
  content.className = "box-content";
  content.textContent = "内容";
  const diagram = band("margin","margin · 外側",band("padding","padding · 内側",content));
  const hint = document.createElement("p");
  hint.className = "box-hint";
  hint.textContent = "矢印をドラッグ · 数値を直接入力";
  const box = document.createElement("div");
  box.className = "box-model";
  box.append(hint,diagram);
  return box;
}
function startSpacingDrag(event,arrow,input,key,side,visibleElement,unitScale = 1) {
  if (!input || event.button !== 0 || !event.isPrimary || spacingGesture || sourceResizeGesture || codeDirty()) return;
  event.preventDefault();
  arrow.focus({preventScroll:true});
  const element = visibleElement();
  if (!element || !arrow.isConnected) return;
  const vertical = side === "top" || side === "bottom";
  const outward = side === "top" || side === "left" ? -1 : 1;
  const property = key + "-" + side;
  const css = element.ownerDocument.defaultView.getComputedStyle(element);
  const layer = !tagCanvas() || inspectedItem(element);
  spacingGesture = {
    pointer:event.pointerId,arrow,input,element,property,vertical,unitScale,start:vertical ? event.clientY : event.clientX,
    direction:key === "margin" ? outward : -outward,minimum:key !== "margin" ? 0 : layer ? -8000 : -Infinity,
    maximum:layer ? 8000 : Infinity,integer:Boolean(layer),
    initial:parseFloat(css.getPropertyValue(property)) || 0,initialInput:input.value,
    original:element.getAttribute("style"),priority:element.style.getPropertyPriority(property),changed:false
  };
  hoveredElement = null;
  arrow.classList.add("is-dragging");
  shell.classList.add("resizing");
  arrow.setPointerCapture(event.pointerId);
}
window.addEventListener("pointermove",event => {
  const drag = spacingGesture;
  if (drag?.pointer !== event.pointerId || !drag.element.isConnected || !drag.input.isConnected) return;
  const delta = Math.round(((drag.vertical ? event.clientY : event.clientX)-drag.start)*drag.direction/drag.unitScale);
  const next = drag.initial+delta;
  const amount = clamp(drag.integer ? Math.round(next) : next,drag.minimum,drag.maximum);
  drag.changed = delta !== 0 && amount !== drag.initial;
  if (drag.changed) {
    drag.input.value = String(amount);
    drag.element.style.setProperty(drag.property,amount+"px",drag.priority);
  } else {
    drag.input.value = drag.initialInput;
    restoreDragPreview(drag);
  }
  if (tagCanvas()) highlightSource();
  if (canvasSpacingTarget) {
    if (!tagCanvas()) refreshCanvasSpacing();
  } else {
    paintInspection(canvasBox(drag.element),drag.element.ownerDocument.defaultView.getComputedStyle(drag.element));
    inspectBox.hidden = false;
  }
});
function finishSpacingDrag(cancelled) {
  const drag = spacingGesture;
  if (!drag) return;
  spacingGesture = undefined;
  drag.arrow.classList.remove("is-dragging");
  shell.classList.remove("resizing");
  restoreDragPreview(drag);
  if (drag.arrow.hasPointerCapture(drag.pointer)) drag.arrow.releasePointerCapture(drag.pointer);
  inspectBox.hidden = true;
  if (tagCanvas()) highlightSource();
  else refreshCanvasSpacing();
  if (cancelled || !drag.changed || !drag.element.isConnected || !drag.input.isConnected) {
    drag.input.value = drag.initialInput;
    return;
  }
  if (drag.priority && drag.input.type === "text") drag.input.value += " !important";
  drag.input.dispatchEvent(new Event("change",{bubbles:true}));
}
for (const eventName of ["pointerup","pointercancel","lostpointercapture"]) {
  window.addEventListener(eventName,event => {
    if (spacingGesture?.pointer === event.pointerId) finishSpacingDrag(eventName !== "pointerup");
  });
}
function tagName(label) {
  const tag = document.createElement("p");
  tag.className = "tag-name";
  tag.textContent = label;
  return tag;
}
function resizePage(value) {
  const height = project.heights[view];
  const atBottom = [];
  let minimum = 300;
  for (const item of project.items) {
    const position = item[view];
    const bottom = position.y + position.h;
    if (footerAtBottom(item,position)) {
      atBottom.push(position);
      minimum = Math.max(minimum,position.h);
    } else {
      minimum = Math.max(minimum,bottom);
    }
  }
  const next = number(value,height,minimum,8000);
  for (const position of atBottom) position.y = next - position.h;
  project.heights[view] = next;
  return next;
}
function renderProperties() {
  if (tagCanvas()) {
    renderSourceProperties();
    return;
  }
  const item = itemSelected();
  byId("properties-title").textContent = item ? types[item.type] + "の設定" : "ページ設定";
  if (!item) {
    properties.replaceChildren(section(
      field("ページタイトル","text",project.title,value => { project.title = value; },{maxLength:160}),
      field("背景色","color",project.background,value => { project.background = value; }),
      field("ページの高さ (px)","number",project.heights[view],resizePage,{min:300,max:8000})
    ));
    return;
  }
  const position = item[view];
  const geometry = (name,key,min,max) => field(name,"number",position[key],value => {
    position[key] = number(value,position[key],min,max());
    return position[key];
  },{min,max:max()});
  const spacingField = (key,side) => {
    const spacing = position[key];
    const min = key === "margin" ? -8000 : 0;
    const control = field(sides[side],"number",spacing[side],value => {
      spacing[side] = number(value,spacing[side],min,8000);
      return spacing[side];
    },{min,max:8000});
    control.querySelector("input").setAttribute("aria-label",key + " " + sides[side] + " (px)");
    return control;
  };
  const x = geometry("横位置","x",0,() => widths[view]-position.w);
  const y = geometry("縦位置","y",0,() => project.heights[view]-position.h);
  const w = geometry("幅","w",16,() => widths[view]-position.x);
  const maxHeight = () => project.heights[view] - (footerAtBottom(item,position) ? 0 : position.y);
  const h = field("高さ","number",position.h,value => {
    const next = number(value,position.h,16,maxHeight());
    if (footerAtBottom(item,position)) position.y = project.heights[view] - next;
    position.h = next;
    return next;
  },{min:16,max:maxHeight()});
  const layout = section(
    tagName("<" + itemTag(item) + "> · " + (view === "desktop" ? "PC" : "スマホ") + " · px"),
    group(w,h),group(x,y),boxModel(spacingField,() => sheet.querySelector(".selected"))
  );
  layout.addEventListener("change",() => {
    x.querySelector("input").max = widths[view] - position.w;
    y.querySelector("input").max = project.heights[view] - position.h;
    y.querySelector("input").value = position.y;
    w.querySelector("input").max = widths[view] - position.x;
    h.querySelector("input").max = maxHeight();
  });
  const appearance = section();
  if (item.type === "text" || item.type === "button" || isPageRegion(item.type)) {
    appearance.append(
      field("表示する文字","textarea",item.text,value => { item.text = value; },{maxLength:4000}),
      group(geometry("文字サイズ","size",8,() => 160),field("文字色","color",item.color,value => { item.color = value; })),
      field("書体","select",item.font,value => { item.font = value; },fontOptions),
      field("文字揃え","select",item.align,value => { item.align = value; },{left:"左揃え",center:"中央揃え",right:"右揃え"}),
      field("太字","checkbox",item.bold,value => { item.bold = value; })
    );
  }
  if (item.type === "image") {
    appearance.append(
      field("代替テキスト","text",item.alt,value => { item.alt = value; },{maxLength:500}),
      action("画像を差し替え",() => chooseImage(item.id))
    );
  }
  if (hasFill(item.type)) {
    appearance.append(field(isPageRegion(item.type) ? "背景色" : "塗り色","color",item.fill,value => { item.fill = value; }));
  }
  if (item.type !== "text") {
    appearance.append(field("角の丸み (px)","number",item.radius,value => {
      item.radius = number(value,item.radius,0,500);
      return item.radius;
    },{min:0,max:500}));
  }
  if (item.type === "button") {
    appearance.append(field("リンク先 URL","text",item.href,value => {
      item.href = safeLink(value);
      if (value.trim() && !item.href) status("https:// から始まるURLなどを入力してください。");
      return item.href;
    },{placeholder:"https://example.com"}));
  }
  properties.replaceChildren(layout,appearance,section(group(
    action("複製",duplicate),action("削除",remove)
  ),action("ページ設定",() => select(null))));
}

function centered(name,w,h,size) {
  const width = widths[name], height = project.heights[name];
  return rect(Math.round((width-w)/2),Math.min(120,height-h),w,h,size);
}
function makeRegion(type) {
  const preset = regionPresets[type];
  const position = name => {
    const [height,size,padding] = preset[name];
    const y = type === "footer" ? project.heights[name] - height : 0;
    const box = rect(0,y,widths[name],height,size);
    box.padding.left = box.padding.right = padding;
    return box;
  };
  return make(type,position("desktop"),position("mobile"),{
    text:preset.text,color:"#ffffff",fill:type === "footer" ? "#203b2d" : "#225840",bold:type === "header"
  });
}
function makeObject(type,image) {
  const dimensions = {text:[340,86,30,245,76,23],button:[175,52,18,150,45,16],
    image:[320,210,24,260,170,24],shape:[150,120,24,125,104,24]};
  const d = dimensions[type];
  const item = make(type,centered("desktop",...d.slice(0,3)),centered("mobile",...d.slice(3)));
  if (type === "button") Object.assign(item,{color:"#ffffff",bold:true,align:"center",radius:8});
  if (type === "shape") Object.assign(item,{fill:"#dce8d7",radius:8});
  if (image) item.src = image;
  return item;
}
function add(type,image) {
  if (project.items.length >= 500) return status("このページには500個まで要素を追加できます。");
  const item = isPageRegion(type) ? makeRegion(type) : makeObject(type,image);
  change(() => { project.items.push(item); selected = item.id; });
}
function remove() {
  if (!itemSelected()) return;
  change(() => {
    project.items = project.items.filter(item => item.id !== selected);
    selected = null;
  });
}
function duplicate() {
  const item = itemSelected();
  if (!item) return;
  if (project.items.length >= 500) return status("このページには500個まで要素を追加できます。");
  const copy = structuredClone(item);
  copy.id = id();
  for (const name of Object.keys(widths)) {
    const position = copy[name];
    position.x = Math.min(position.x+12,widths[name]-position.w);
    position.y = Math.min(position.y+12,project.heights[name]-position.h);
  }
  change(() => {
    project.items.splice(project.items.indexOf(item)+1,0,copy);
    selected = copy.id;
  });
}
function moveLayer(step) {
  const index = project.items.findIndex(item => item.id === selected);
  const dest = index + step;
  if (index < 0 || dest < 0 || dest >= project.items.length) return;
  change(() => { [project.items[index],project.items[dest]] = [project.items[dest],project.items[index]]; });
}
function offsetGeometry(position,dx,dy,resize,fromTop = false) {
  if (resize) {
    position.w = clamp(position.w+dx,16,widths[view]-position.x);
    if (fromTop) {
      const bottom = position.y + position.h;
      position.h = clamp(position.h-dy,16,bottom);
      position.y = bottom-position.h;
    } else {
      position.h = clamp(position.h+dy,16,project.heights[view]-position.y);
    }
  } else {
    position.x = clamp(position.x+dx,0,widths[view]-position.w);
    position.y = clamp(position.y+dy,0,project.heights[view]-position.h);
  }
}
sheet.addEventListener("pointerdown",event => {
  if (event.button !== 0 || !event.isPrimary) return;
  const target = event.target.closest(".object");
  if (!target) { select(null); return; }
  event.preventDefault();
  sheet.focus({preventScroll:true});
  const resize = event.target.classList.contains("handle");
  const fromTop = event.target.classList.contains("from-top");
  select(target.dataset.id);
  const item = itemSelected();
  gesture = {pointer:event.pointerId,startX:event.clientX,startY:event.clientY,resize,fromTop,
    position:{...item[view]},view,scale,before:snapshot(),item};
  sheet.setPointerCapture(event.pointerId);
});
sheet.addEventListener("pointermove",event => {
  if (gesture?.pointer !== event.pointerId) return;
  const dx = Math.round((event.clientX-gesture.startX)/gesture.scale);
  const dy = Math.round((event.clientY-gesture.startY)/gesture.scale);
  const position = {...gesture.position};
  offsetGeometry(position,dx,dy,gesture.resize,gesture.fromTop);
  gesture.item[gesture.view] = position;
  queueSave();
  const element = sheet.querySelector(".selected");
  Object.assign(element.style,{left:position.x+"px",top:position.y+"px",
    width:position.w+"px",height:position.h+"px"});
});
function finishGesture(event,cancelled) {
  if (gesture?.pointer !== event.pointerId) return;
  const current = gesture;
  gesture = null;
  if (cancelled) {
    current.item[current.view] = current.position;
    queueSave();
  }
  if (JSON.stringify(current.item[current.view]) !== JSON.stringify(current.position)) record(current.before);
  render();
}
sheet.addEventListener("pointerup",event => finishGesture(event,false));
sheet.addEventListener("pointercancel",event => finishGesture(event,true));
sheet.addEventListener("lostpointercapture",event => finishGesture(event,true));
sheet.addEventListener("contextmenu",event => {
  const element = event.target.closest(".object");
  if (!element || codeDirty()) return;
  event.preventDefault();
  select(element.dataset.id);
  openCanvasSpacing();
});
sheet.addEventListener("dblclick",event => {
  if (!event.target.closest(".object")) return;
  const text = properties.querySelector("textarea");
  text?.focus();
  text?.select();
});

const htmlEscape = value => String(value).replace(/[&<>"']/g,character =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]);
const asUnit = (value,width) => +(value*100/width).toFixed(5) + "cqw";
function inlineGeometry(item) {
  const keys = ["x","y","w","h","size"];
  return Object.entries(widths).flatMap(([name,width]) => {
    const prefix = "--" + name[0] + "-";
    const position = item[name];
    const unit = value => asUnit(value,width);
    return [
      ...keys.map(key => prefix + key + ":" + unit(position[key])),
      prefix + "radius:" + unit(item.radius),
      prefix + "padding:" + spacingCSS(position.padding,unit),
      prefix + "margin:" + spacingCSS(position.margin,unit)
    ];
  }).join(";");
}
function exportItem(item,layer) {
  const style = textStyle(item);
  const css = [
    inlineGeometry(item),"color:"+style.color,"font-family:"+style.fontFamily,
    "font-weight:"+style.fontWeight,"text-align:"+style.textAlign,
    "justify-content:"+style.justifyContent,"align-items:"+style.alignItems
  ];
  if (hasFill(item.type)) css.push("background:"+item.fill);
  if (layer !== undefined) css.push("z-index:"+layer);
  const tag = itemTag(item);
  const extra = tag === "a" ? ' href="' + htmlEscape(item.href) + '"' : item.type === "shape" ? ' aria-hidden="true"' : "";
  const content = item.type === "image" ?
    '<img src="' + htmlEscape(item.src) + '" alt="' + htmlEscape(item.alt) + '">' : htmlEscape(item.text);
  return '<' + tag + ' class="site-object" id="' + htmlEscape(item.id) + '" style="' +
    htmlEscape(css.join(";")) + '"' + extra + '>' + content + '</' + tag + '>';
}
function exportPage() {
  if (!project.items.some(item => isPageRegion(item.type))) {
    return ['<main class="site"><div class="page">',...project.items.map(item => exportItem(item)),'</div></main>'];
  }
  const sections = {header:[],main:[],footer:[]};
  project.items.forEach((item,index) => {
    const section = isPageRegion(item.type) ? item.type : "main";
    sections[section].push(exportItem(item,index));
  });
  return [
    '<div class="site"><div class="page">',...sections.header,
    '<main>',...sections.main,'</main>',...sections.footer,'</div></div>'
  ];
}
function exportHTML(includeMetadata = true) {
  if (typeof project.source === "string") return project.source;
  const metadata = includeMetadata ? {...project,items:project.items.map(({src,...item}) => item)} : null;
  const embedded = metadata ? JSON.stringify(metadata).replace(/</g,"\\u003c") : "";
  const pageBreak = 600;
  return [
    '<!doctype html>',
    '<html lang="ja">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + htmlEscape(project.title || "無題のサイト") + '</title>',
    '<style>',
    '*{box-sizing:border-box}body{margin:0;background:'+project.background+'}',
    '.site{container-type:inline-size;width:min(100%,960px);margin:0 auto}',
    '.page{position:relative;overflow:hidden;height:'+asUnit(project.heights.desktop,widths.desktop)+'}',
    '.site-object{position:absolute;display:flex;overflow:hidden;min-width:0;overflow-wrap:anywhere;white-space:pre-wrap;line-height:1.12;text-decoration:none;left:var(--d-x);top:var(--d-y);width:var(--d-w);height:var(--d-h);font-size:var(--d-size);border-radius:var(--d-radius);padding:var(--d-padding);margin:var(--d-margin)}',
    '.site-object img{width:100%;height:100%;object-fit:cover;display:block}',
    '.site-object:focus-visible{outline:2px solid currentColor;outline-offset:-3px}',
    '@media(max-width:'+pageBreak+'px){.site{width:min(100%,390px)}.page{height:'+asUnit(project.heights.mobile,widths.mobile)+'}.site-object{left:var(--m-x);top:var(--m-y);width:var(--m-w);height:var(--m-h);font-size:var(--m-size);border-radius:var(--m-radius);padding:var(--m-padding);margin:var(--m-margin)}}',
    '</style>',
    '</' + 'head>',
    '<body>',...exportPage(),
    ...(metadata ? ['<script type="application/json" id="sitecanvas-project">' + embedded + '</' + 'script>'] : []),
    '</' + 'body></' + 'html>'
  ].join("\n");
}
function parseHTML(source) {
  return new DOMParser().parseFromString(source,"text/html");
}
function serializeHTML(page) {
  const serializer = new XMLSerializer();
  return Array.from(page.childNodes,node => node.outerHTML ?? serializer.serializeToString(node)).join("\n");
}
function projectFromSource(source,fileName) {
  const title = parseHTML(source).title.trim().slice(0,160) || "無題のサイト";
  return {...blank(),title,source,fileName};
}
function downloadFilename() {
  const safeName = (project.fileName || project.title).trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g,"-").replace(/[. ]+$/,"");
  return project.fileName && /\.html?$/i.test(safeName) ? safeName : (safeName || "index") + ".html";
}
function fileDirectory() {
  return {folders:new Map(),files:new Map()};
}
function addFileReference(directory,reference) {
  const value = reference.trim();
  if (!value || /^[?#]/.test(value)) return;
  let path = value.split(/[?#]/,1)[0];
  if (/^(?:https?:)?\/\//i.test(value)) {
    try {
      const url = new URL(value,"https://sitecanvas.invalid/");
      path = "外部参照/" + url.host + (url.pathname === "/" ? "/" + url.host : url.pathname);
    } catch { return; }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return;
  const parts = path.split("/").filter(part => part && part !== ".");
  const filename = parts.pop();
  if (!filename) return;
  for (const folder of parts) {
    if (!directory.folders.has(folder)) directory.folders.set(folder,fileDirectory());
    directory = directory.folders.get(folder);
  }
  directory.files.set(filename,value);
}
function sourceFiles(source) {
  const template = document.createElement("template");
  template.innerHTML = source;
  const page = template.content;
  const directory = fileDirectory();
  const embedded = new Set();
  const reference = value => {
    if (/^data:/i.test(value.trim())) embedded.add(value.trim());
    else addFileReference(directory,value);
  };
  for (const element of page.querySelectorAll("[src],video[poster],[srcset],link[href],a[href]")) {
    for (const name of ["src","poster"]) {
      if (element.hasAttribute(name)) reference(element.getAttribute(name));
    }
    const href = element.getAttribute("href");
    if (href && (element.localName === "link" || /\.[a-z\d]+(?:[?#]|$)/i.test(href))) reference(href);
    const srcset = element.getAttribute("srcset") ?? "";
    for (const match of srcset.matchAll(/(?:^|,)\s*(data:\S+|[^,\s]+)(?:\s+[^,]*)?/gi)) reference(match[1]);
  }
  const styles = Array.from(page.querySelectorAll("style"),node => node.textContent);
  const inlineStyles = Array.from(page.querySelectorAll("[style]"),node => node.getAttribute("style"));
  for (const css of [...styles,...inlineStyles]) {
    for (const match of css.replace(/\/\*[\s\S]*?\*\//g,"").matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi)) {
      reference(match.slice(1).find(part => part !== undefined));
    }
  }
  return {
    directory,styles:styles.length,scripts:page.querySelectorAll("script:not([src])").length,embedded:embedded.size
  };
}
function fileEntry(name,title,open) {
  const row = document.createElement(open ? "button" : "span");
  row.className = "file-entry";
  row.textContent = name;
  if (title) row.title = title;
  if (open) row.addEventListener("click",open);
  const item = document.createElement("li");
  item.append(row);
  return item;
}
function fileFolder(name,entries,open) {
  const title = document.createElement("summary");
  title.textContent = name;
  const details = document.createElement("details");
  details.open = open;
  details.append(title,entries);
  const item = document.createElement("li");
  item.append(details);
  return item;
}
function fileEntries(directory,depth = 0) {
  const list = document.createElement("ul");
  for (const [name,folder] of directory.folders) list.append(fileFolder(name,fileEntries(folder,depth+1),depth < 2));
  for (const [name,path] of directory.files) list.append(fileEntry(name,path));
  return list;
}
let renderedFiles;
function renderFilePanel() {
  byId("layers-panel").hidden = showFiles;
  byId("files-panel").hidden = !showFiles;
  byId("layers-tab").setAttribute("aria-pressed",String(!showFiles));
  byId("files-tab").setAttribute("aria-pressed",String(showFiles));
  if (!showFiles) return;
  const fileName = downloadFilename(), source = project.source;
  const images = project.items.filter(item => item.type === "image" && item.src).length;
  if (renderedFiles?.fileName === fileName && renderedFiles.source === source && renderedFiles.images === images) return;
  renderedFiles = {fileName,source,images};
  const files = typeof source === "string" ? sourceFiles(source) : {styles:1,scripts:0,embedded:images};
  const tree = document.createElement("ul");
  const html = fileEntry(fileName,"HTML をコードで開く",() => openCode(true));
  const parts = document.createElement("ul");
  if (files.styles) parts.append(fileEntry("埋め込み CSS（" + files.styles + "件）"));
  if (files.scripts) parts.append(fileEntry("埋め込みスクリプト（" + files.scripts + "件）"));
  if (files.embedded) parts.append(fileEntry("埋め込みデータ（" + files.embedded + "件）"));
  if (parts.childElementCount) html.append(parts);
  tree.append(html);
  if (files.directory && (files.directory.folders.size || files.directory.files.size)) {
    tree.append(fileFolder("参照ファイル",fileEntries(files.directory),true));
  }
  byId("file-tree").replaceChildren(tree);
}
function setFilePanel(files) {
  if (showFiles === files) return;
  showFiles = files;
  renderFilePanel();
  queueSave();
}
byId("layers-tab").addEventListener("click",() => setFilePanel(false));
byId("files-tab").addEventListener("click",() => setFilePanel(true));
function previewHTML(source,revision) {
  const page = parseHTML(source);
  for (const refresh of page.querySelectorAll('meta[http-equiv="refresh" i]')) refresh.removeAttribute("http-equiv");
  const policy = page.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = "script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'";
  if (revision !== undefined) policy.dataset.preview = revision;
  page.head.prepend(policy);
  return serializeHTML(page);
}
function tagCanvas() {
  return inspectMode || typeof project.source === "string";
}
function selectedTagPath() {
  return typeof project.source === "string" ? selected : inspectedPath;
}
function inspectedItem(element) {
  if (!element?.id || typeof project.source === "string") return;
  return project.items.find(item => item.id === element.id);
}
function pickSource(path) {
  if (typeof project.source === "string") {
    select(path);
    return;
  }
  if (inspectedPath !== path) queueSave();
  inspectedPath = path;
  const target = sourceElement(sourceDocument,path);
  const id = inspectedItem(target)?.id ?? null;
  if (selected !== id) { selected = id; queueSave(); }
  renderSourceLayers();
  renderSourceProperties();
  highlightSource();
}
function toggleInspection() {
  inspectMode = !inspectMode;
  inspectedPath = hoveredElement = null;
  queueSave();
  render();
}
inspectToggle.addEventListener("click",toggleInspection);
function renderSourceSheet() {
  const source = project.source ?? exportHTML(false);
  if (previewSource === source) return;
  if (selectedTagPath() === null) sourceScroll = undefined;
  else if (sourceDocument) {
    const {scrollLeft,scrollTop} = sourceDocument.scrollingElement;
    sourceScroll = [scrollLeft,scrollTop];
  }
  previewSource = source;
  sourceDocument = undefined;
  hoveredElement = null;
  sourceOutline.hidden = sourceResize.hidden = true;
  showInspection(null);
  sourceSheet.srcdoc = previewHTML(previewSource,++previewRevision);
}
function sourceElement(page,path) {
  if (!page?.body || path === null) return;
  if (path === "") return page.body;
  return path.split(".").reduce((parent,index) => parent?.children[index],page.body);
}
function pathFor(element) {
  const indexes = [];
  while (element !== element.ownerDocument.body) {
    indexes.push(Array.prototype.indexOf.call(element.parentElement.children,element));
    element = element.parentElement;
  }
  return indexes.reverse().join(".");
}
function inspectable(element) {
  return element?.style && !["link","meta","script","style","template"].includes(element.localName);
}
function sourceLabel(element) {
  return "<" + element.localName + ">" + (element.id ? " #" + element.id : "");
}
function renderSourceLayers() {
  const layers = byId("layers");
  const body = sourceDocument?.body;
  if (!body) {
    layers.replaceChildren();
    return;
  }
  const scrollTop = layers.scrollTop;
  const focusedPath = layers.contains(document.activeElement) ? document.activeElement.dataset.path : undefined;
  const rows = [body,...body.querySelectorAll("*")].filter(inspectable).map(element => {
    const path = pathFor(element);
    const row = document.createElement("button");
    row.className = "layer tag-row";
    const depth = path ? path.split(".").length : 0;
    row.style.setProperty("--depth",Math.min(depth,8));
    row.setAttribute("aria-pressed",String(path === selectedTagPath()));
    row.dataset.path = path;
    row.title = sourceLabel(element);
    const name = document.createElement("span");
    name.textContent = row.title;
    row.append(name);
    row.addEventListener("click",() => {
      element.scrollIntoView({block:"nearest",inline:"nearest",container:"nearest"});
      pickSource(path);
      highlightSource();
    });
    row.addEventListener("pointerenter",() => hoverSource(element));
    row.addEventListener("pointerleave",() => hoverSource(null));
    return row;
  });
  layers.replaceChildren(...rows);
  layers.scrollTop = scrollTop;
  rows.find(row => row.dataset.path === focusedPath)?.focus({preventScroll:true});
}
function highlightSource() {
  const element = sourceElement(sourceDocument,selectedTagPath());
  showInspection(inspectMode && !canvasSpacingTarget ? hoveredElement : null);
  refreshCanvasSpacing();
  if (!element) {
    sourceOutline.hidden = sourceResize.hidden = true;
    return;
  }
  const box = element.getBoundingClientRect();
  const left = Math.max(0,box.left), top = Math.max(0,box.top);
  const right = Math.min(sourceSheet.clientWidth,box.right);
  const bottom = Math.min(sourceSheet.clientHeight,box.bottom);
  sourceOutline.hidden = right <= left || bottom <= top;
  Object.assign(sourceOutline.style,{
    left:left*scale+"px",top:top*scale+"px",width:(right-left)*scale+"px",height:(bottom-top)*scale+"px"
  });
  const item = inspectedItem(element);
  const fromTop = item && footerAtBottom(item,item[view]);
  sourceResize.hidden = sourceOutline.hidden;
  sourceResize.classList.toggle("from-top",Boolean(fromTop));
  sourceResize.style.left = right*scale+"px";
  sourceResize.style.top = (fromTop ? top : bottom)*scale+"px";
}
function resizeCSSSize(element,css,key) {
  const current = css.getPropertyValue(key);
  if (current.endsWith("px")) return parseFloat(current);
  const horizontal = key === "width";
  const box = element.getBoundingClientRect();
  const borderBox = horizontal ? element.offsetWidth ?? box.width : element.offsetHeight ?? box.height;
  if (css.boxSizing === "border-box") return borderBox;
  const edges = horizontal ? ["left","right"] : ["top","bottom"];
  return Math.max(0,borderBox-edges.reduce((sum,side) => sum+
    (parseFloat(css.getPropertyValue("padding-"+side)) || 0)+
    (parseFloat(css.getPropertyValue("border-"+side+"-width")) || 0),0));
}
function writeResizeStyles(element,values) {
  for (const [key,value] of values) element.style.setProperty(key,value,element.style.getPropertyPriority(key));
}
function restoreDragPreview(drag) {
  if (drag.original === null) drag.element.removeAttribute("style");
  else drag.element.setAttribute("style",drag.original);
}
sourceResize.addEventListener("pointerdown",event => {
  if (event.button !== 0 || !event.isPrimary || sourceResizeGesture || spacingGesture || codeDirty()) return;
  event.preventDefault();
  sourceResize.focus({preventScroll:true});
  const path = selectedTagPath();
  const element = sourceElement(sourceDocument,path);
  if (!element) return;
  const item = inspectedItem(element);
  const css = sourceDocument.defaultView.getComputedStyle(element);
  sourceResizeGesture = {
    pointer:event.pointerId,x:event.clientX,y:event.clientY,scale,view,project,path,element,item,
    original:element.getAttribute("style"),position:item ? {...item[view]} : null,
    fromTop:item && footerAtBottom(item,item[view]),width:resizeCSSSize(element,css,"width"),
    height:resizeCSSSize(element,css,"height"),values:[],
    inline:css.display === "inline" && element.namespaceURI === "http://www.w3.org/1999/xhtml" &&
      !element.matches("img,input,textarea,select,video,audio,canvas,iframe,embed,object")
  };
  hoveredElement = null;
  showInspection(null);
  shell.classList.add("resizing");
  sourceResize.setPointerCapture(event.pointerId);
});
function resizeStillCurrent(drag) {
  return drag.project === project && drag.view === view && drag.element.ownerDocument === sourceDocument &&
    drag.path === selectedTagPath();
}
window.addEventListener("pointermove",event => {
  const drag = sourceResizeGesture;
  if (drag?.pointer !== event.pointerId || !resizeStillCurrent(drag)) return;
  const dx = Math.round((event.clientX-drag.x)/drag.scale);
  const dy = Math.round((event.clientY-drag.y)/drag.scale);
  const values = [];
  if (drag.item) {
    const next = {...drag.position};
    offsetGeometry(next,dx,dy,true,drag.fromTop);
    if (next.w !== drag.position.w) values.push(["width",next.w+"px"]);
    if (next.h !== drag.position.h) values.push(["height",next.h+"px"]);
    if (next.y !== drag.position.y) values.push(["top",next.y+"px"]);
    drag.next = next;
  } else {
    if (dx) values.push(["width",Math.max(1,Math.round(drag.width+dx))+"px"]);
    if (dy) values.push(["height",Math.max(1,Math.round(drag.height+dy))+"px"]);
    if (drag.inline && values.length) values.push(["display","inline-block"]);
  }
  restoreDragPreview(drag);
  writeResizeStyles(drag.element,values);
  drag.values = values;
  highlightSource();
});
function finishSourceResize(cancelled) {
  const drag = sourceResizeGesture;
  if (!drag) return;
  sourceResizeGesture = undefined;
  shell.classList.remove("resizing");
  restoreDragPreview(drag);
  if (sourceResize.hasPointerCapture(drag.pointer)) sourceResize.releasePointerCapture(drag.pointer);
  if (cancelled || !drag.values.length || !resizeStillCurrent(drag)) {
    highlightSource();
    return;
  }
  const before = snapshot();
  if (drag.item) drag.item[view] = drag.next;
  else {
    updateSourceElementStyle(drag.path,element => writeResizeStyles(element,drag.values));
    if (project.source === before.project.source) { highlightSource(); return; }
  }
  record(before);
  render();
}
for (const eventName of ["pointerup","pointercancel","lostpointercapture"]) {
  window.addEventListener(eventName,event => {
    if (sourceResizeGesture?.pointer === event.pointerId) finishSourceResize(eventName !== "pointerup");
  });
}
function metricsList(rows) {
  const list = document.createElement("dl");
  list.className = "inspect-metrics";
  for (const [name,value,clip] of rows) {
    const term = document.createElement("dt"), detail = document.createElement("dd");
    term.textContent = name;
    detail.textContent = value;
    if (clip) { detail.className = "clip"; detail.title = value; }
    list.append(term,detail);
  }
  return list;
}
function boxSize(box) {
  return sizeFormat.format(box.width) + " × " + sizeFormat.format(box.height) + " px";
}
function hoverSource(element) {
  if (!inspectMode || canvasSpacingTarget || hoveredElement === element) return;
  hoveredElement = element;
  showInspection(element);
}
function canvasBox(element) {
  const box = element.getBoundingClientRect();
  if (tagCanvas()) return box;
  const origin = sheet.getBoundingClientRect();
  return {
    left:(box.left-origin.left)/scale, top:(box.top-origin.top)/scale,
    right:(box.right-origin.left)/scale, bottom:(box.bottom-origin.top)/scale
  };
}
function canvasSpacingElement() {
  if (!canvasSpacingTarget || canvasSpacingTarget.tags !== tagCanvas()) return null;
  if (tagCanvas()) {
    return canvasSpacingTarget.selection === selectedTagPath() ? sourceElement(sourceDocument,selectedTagPath()) : null;
  }
  return canvasSpacingTarget.selection === selected ? sheet.querySelector(".selected") : null;
}
function openCanvasSpacing() {
  const tags = tagCanvas();
  const selection = tags ? selectedTagPath() : selected;
  if (canvasSpacingTarget?.tags !== tags || canvasSpacingTarget.selection !== selection) {
    canvasSpacingTarget = {tags,selection,key:"padding"};
  }
  hoveredElement = null;
  inspectTooltip.hidden = true;
  refreshCanvasSpacing();
}
function closeCanvasSpacing() {
  canvasSpacingTarget = undefined;
  canvasSpacing.hidden = inspectBox.hidden = true;
}
function refreshCanvasSpacing() {
  if (!canvasSpacingTarget) return;
  const tags = tagCanvas();
  if (canvasSpacingTarget.tags !== tags || canvasSpacingTarget.selection !== (tags ? selectedTagPath() : selected)) {
    closeCanvasSpacing();
    return;
  }
  const element = canvasSpacingElement();
  const box = element && canvasBox(element);
  const w = shell.clientWidth, h = shell.clientHeight;
  const dragging = spacingGrips.includes(spacingGesture?.arrow);
  const visible = box && box.right > Math.max(0,box.left) && box.bottom > Math.max(0,box.top) &&
    box.left*scale < w && box.top*scale < h;
  canvasSpacing.hidden = !box || (!visible && !dragging);
  inspectBox.hidden = !visible;
  if (canvasSpacing.hidden) return;
  const css = element.ownerDocument.defaultView.getComputedStyle(element);
  paintInspection(box,css);
  inspectTooltip.hidden = true;
  for (const grip of spacingGrips) {
    const side = grip.dataset.side, mode = grip.dataset.mode;
    const value = css.getPropertyValue(mode+"-"+side);
    grip.textContent = value;
    grip.title = mode+" "+sides[side]+" "+value+" · ドラッグで調整";
    grip.setAttribute("aria-label",grip.title);
  }
  if (dragging) return;
  const spacingEdge = (mode,side,position,sign) => {
    const space = parseFloat(css.getPropertyValue(mode+"-"+side)) || 0;
    const border = parseFloat(css.getPropertyValue("border-"+side+"-width")) || 0;
    const offset = mode === "margin" ? sign*space : -sign*(space+border);
    return position+offset;
  };
  const x = clamp((box.left+box.right)*scale/2,20,Math.max(20,w-20));
  const y = clamp((box.top+box.bottom)*scale/2,13,Math.max(13,h-13));
  const points = {
    "margin-top":[x,spacingEdge("margin","top",box.top,-1)-10],
    "padding-top":[x,spacingEdge("padding","top",box.top,-1)+10],
    "margin-right":[spacingEdge("margin","right",box.right,1)+18,y],
    "padding-right":[spacingEdge("padding","right",box.right,1)-18,y],
    "margin-bottom":[x,spacingEdge("margin","bottom",box.bottom,1)+10],
    "padding-bottom":[x,spacingEdge("padding","bottom",box.bottom,1)-10],
    "margin-left":[spacingEdge("margin","left",box.left,-1)-18,y],
    "padding-left":[spacingEdge("padding","left",box.left,-1)+18,y]
  };
  for (const grip of spacingGrips) {
    const point = points[grip.dataset.mode+"-"+grip.dataset.side];
    const row = canvasSpacing.querySelector('.canvas-spacing-row[data-side="'+grip.dataset.side+'"]');
    Object.assign(row.style,{left:clamp(point[0]*scale,18,w-18)+"px",top:clamp(point[1]*scale,18,h-18)+"px"});
  }
  canvasSpacing.dataset.compact = "false";
  for (const row of canvasSpacing.querySelectorAll(".canvas-spacing-row")) {
    const [left,top,width,height] = [row.offsetLeft-row.offsetWidth/2,row.offsetTop-row.offsetHeight/2,row.offsetWidth,row.offsetHeight];
    if (left < 0 || top < 0 || left+width > w || top+height > h) canvasSpacing.dataset.compact = "true";
  }
  if (canvasSpacing.dataset.compact === "true") {
    spacingControls.style.left = clamp(x-spacingControls.offsetWidth/2,0,Math.max(0,w-spacingControls.offsetWidth))+"px";
    spacingControls.style.top = clamp(y-spacingControls.offsetHeight/2,0,Math.max(0,h-spacingControls.offsetHeight))+"px";
    for (const row of canvasSpacing.querySelectorAll(".canvas-spacing-row")) {
      row.style.left = ""; row.style.top = "";
    }
  }
}
byId("close-spacing").addEventListener("click",closeCanvasSpacing);
for (const grip of spacingGrips) {
  const inputFor = () => canvasSpacingTarget && properties.querySelector(
    '[data-spacing="'+grip.dataset.mode+'-'+grip.dataset.side+'"]');
  grip.addEventListener("pointerdown",event => {
    if (canvasSpacingTarget) startSpacingDrag(event,grip,inputFor(),grip.dataset.mode,grip.dataset.side,canvasSpacingElement,scale);
  });
  grip.addEventListener("click",event => {
    if (event.detail === 0) inputFor()?.focus();
  });
}
function paintInspection(box,css) {
  const lengths = (key,suffix = "") => ["top","right","bottom","left"].map(side => Math.max(0,parseFloat(css.getPropertyValue(key+"-"+side+suffix)) || 0));
  const margin = lengths("margin"), border = lengths("border","-width"), padding = lengths("padding");
  const outer = {left:box.left-margin[3],top:box.top-margin[0],right:box.right+margin[1],bottom:box.bottom+margin[2]};
  for (const [index,edges] of [margin,border,padding,[0,0,0,0]].entries()) {
    const [top,right,bottom,left] = edges;
    Object.assign(inspectBox.children[index].style,{
      left:outer.left*scale+"px",top:outer.top*scale+"px",
      width:Math.max(0,outer.right-outer.left)*scale+"px",height:Math.max(0,outer.bottom-outer.top)*scale+"px",
      borderWidth:edges.map(edge => edge*scale+"px").join(" ")
    });
    outer.left += left; outer.top += top; outer.right -= right; outer.bottom -= bottom;
  }
}
function showInspection(element) {
  const box = element?.isConnected ? element.getBoundingClientRect() : null;
  const visible = box && box.width > 0 && box.height > 0 && box.right > 0 && box.bottom > 0 &&
    box.left < sourceSheet.clientWidth && box.top < sourceSheet.clientHeight;
  inspectBox.hidden = inspectTooltip.hidden = !visible;
  if (!visible) return;
  const css = element.ownerDocument.defaultView.getComputedStyle(element);
  paintInspection(box,css);
  const title = document.createElement("div");
  title.className = "inspect-label";
  const classes = Array.from(element.classList).slice(0,3).map(name => "."+name).join("");
  title.textContent = element.localName + (element.id ? "#"+element.id : "") + classes;
  const access = metricsList(accessibilityInfo(element,css));
  access.classList.add("inspect-access");
  inspectTooltip.replaceChildren(title,metricsList([
    ["サイズ",boxSize(box)], ["position",css.position], ["display",css.display],
    ["color",css.color], ["背景",css.backgroundColor], ["フォント",css.fontSize+" "+css.fontFamily,true],
    ["padding",css.padding], ["margin",css.margin]
  ]),access);
  const frame = shell.getBoundingClientRect();
  inspectTooltip.style.maxWidth = Math.min(shell.clientWidth,document.documentElement.clientWidth-16)+"px";
  const maxLeft = Math.max(0,shell.clientWidth-inspectTooltip.offsetWidth);
  const maxTop = Math.max(8-frame.top,window.innerHeight-frame.top-inspectTooltip.offsetHeight-8);
  const above = Math.max(0,box.top*scale) - inspectTooltip.offsetHeight - 7;
  const top = above + frame.top >= 8 ? above : box.bottom*scale + 7;
  inspectTooltip.style.left = clamp(box.left*scale,0,maxLeft)+"px";
  inspectTooltip.style.top = clamp(top,8-frame.top,maxTop)+"px";
}
function accessibilityInfo(element,css) {
  const names = Array.from(element.labels ?? [],label => label.textContent.trim()).join(" ");
  const labelled = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).map(id =>
    element.ownerDocument.getElementById(id)?.textContent.trim()).filter(Boolean).join(" ");
  const tag = element.localName;
  const roles = {button:"button",summary:"button",nav:"navigation",main:"main",aside:"complementary",img:"img",ul:"list",ol:"list",li:"listitem",p:"paragraph",select:"combobox",textarea:"textbox",table:"table"};
  const inputRoles = {checkbox:"checkbox",radio:"radio",range:"slider",number:"spinbutton",button:"button",submit:"button",reset:"button",image:"button",hidden:""};
  let role = Object.hasOwn(roles,tag) ? roles[tag] : "";
  if (tag === "a" && element.hasAttribute("href")) role = "link";
  if (/^h[1-6]$/.test(tag)) role = "heading";
  if (tag === "input") role = inputRoles[element.type] ?? "textbox";
  if ((tag === "header" || tag === "footer") && !element.parentElement?.closest("article,aside,main,nav,section")) role = tag === "header" ? "banner" : "contentinfo";
  role = element.getAttribute("role")?.trim().split(/\s+/)[0] || role;
  const textName = ["button","link","heading"].includes(role) ? element.textContent.trim() || element.value : "";
  const name = labelled || element.getAttribute("aria-label") || names || element.getAttribute("alt") || textName || element.title;
  const focusable = element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest("[inert]") &&
    css.visibility === "visible" && element.getClientRects().length > 0;
  return [["名前",name || "—",true],["ロール",role || "—"],["Tab フォーカス",focusable ? "可" : "不可"]];
}
function updateSourceElementStyle(path,update) {
  const page = parseHTML(project.source ?? exportHTML(false));
  const element = sourceElement(page,path);
  if (!element) return "";
  const previous = element.getAttribute("style");
  const result = update(element);
  if (element.getAttribute("style") !== previous) {
    if (!element.style.length) element.removeAttribute("style");
    const source = serializeHTML(page);
    if (typeof project.source === "string") project.source = source;
    else {
      project = projectFromSource(source,project.fileName);
      selected = path;
    }
  }
  return result;
}
function editSourceStyle(path,key,value) {
  if (!CSS.supports(key,"initial")) {
    status("CSS プロパティ名を確認してください。");
    return "";
  }
  const priority = /\s*!important\s*$/i.test(value) ? "important" : "";
  const input = value.replace(/\s*!important\s*$/i,"").trim();
  const next = /^-?(?:\d+\.?\d*|\.\d+)$/.test(input) && !CSS.supports(key,input) && CSS.supports(key,input+"px") ? input+"px" : input;
  if (next && !CSS.supports(key,next)) {
    status("CSS の値を確認してください。例 24px、2rem、10%");
    const element = sourceElement(sourceDocument,path);
    return element ? inlineStyleValue(element,key) : "";
  }
  return updateSourceElementStyle(path,element => {
    if (next !== element.style.getPropertyValue(key) || priority !== element.style.getPropertyPriority(key)) {
      element.style.setProperty(key,next,priority);
    }
    return inlineStyleValue(element,key);
  });
}
function editInspectedLayout(path,key,value) {
  const item = inspectedItem(sourceElement(sourceDocument,path));
  const pixels = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:px)?$/i.exec(value.trim());
  if (!item || !pixels) return editSourceStyle(path,key,value);
  const size = Number(pixels[1]);
  const position = item[view];
  const [spacing,side] = key.split("-");
  if (side) {
    position[spacing][side] = number(size,position[spacing][side],spacing === "margin" ? -8000 : 0,8000);
    return position[spacing][side]+"px";
  }
  if (size < 0) return editSourceStyle(path,key,value);
  const fromTop = footerAtBottom(item,position);
  const width = key === "width";
  const rounded = Math.round(size);
  offsetGeometry(position,width ? rounded-position.w : 0,width ? 0 : (rounded-position.h)*(fromTop ? -1 : 1),true,fromTop);
  return (width ? position.w : position.h)+"px";
}
function inlineStyleValue(element,key) {
  const value = element.style.getPropertyValue(key);
  return element.style.getPropertyPriority(key) ? value + " !important" : value;
}
function inspectorSection(name,open,...body) {
  const details = document.createElement("details");
  details.className = "inspector-section";
  details.open = inspectorSections.get(name) ?? open;
  const summary = document.createElement("summary");
  summary.textContent = name;
  details.append(summary,...body);
  details.addEventListener("toggle",() => {
    if (details.isConnected) inspectorSections.set(name,details.open);
  });
  return details;
}
function customStyleForm() {
  const form = document.createElement("form");
  form.className = "inspector-custom";
  const control = (label,hint) => {
    const wrapper = document.createElement("label");
    wrapper.className = "field";
    const input = document.createElement("input");
    input.type = "text";
    input.spellcheck = false;
    input.placeholder = hint;
    wrapper.append(label,input);
    form.append(wrapper);
    return input;
  };
  const key = control("プロパティ名","例 transform");
  key.required = true;
  const value = control("値","例 rotate(5deg)");
  const apply = document.createElement("button");
  apply.className = "action";
  apply.textContent = "適用";
  form.append(apply);
  form.addEventListener("submit",event => {
    event.preventDefault();
    const name = key.value.trim();
    const property = name.startsWith("--") ? name : name.toLowerCase();
    const before = snapshot();
    editSourceStyle(selectedTagPath(),property,value.value);
    if (project.source !== before.project.source) {
      record(before);
      render();
    }
  });
  return form;
}
function renderSourceProperties() {
  const heading = byId("properties-title");
  const path = selectedTagPath();
  const element = sourceElement(sourceDocument,path);
  heading.textContent = "CSS インスペクター";
  if (!element) {
    const help = document.createElement("p");
    help.className = "help";
    help.textContent = "編集する HTML 要素を選んでください。";
    properties.replaceChildren(help);
    return;
  }
  const computed = sourceSheet.contentWindow.getComputedStyle(element);
  const item = inspectedItem(element);
  const known = new Set();
  const cssField = (name,key = name,accessibleName = name,options) => {
    known.add(key);
    const computedValue = computed.getPropertyValue(key);
    const dimension = key === "width" || key === "height";
    const spacing = /^(margin|padding)-(top|right|bottom|left)$/.exec(key);
    const position = item?.[view];
    const pixels = dimension ? position?.[key === "width" ? "w" : "h"] : spacing ? position?.[spacing[1]][spacing[2]] : undefined;
    const value = pixels === undefined ? inlineStyleValue(element,key) : pixels+"px";
    const update = dimension || spacing ? editInspectedLayout : editSourceStyle;
    const control = field(name,"text",value,entered => update(path,key,entered),{placeholder:computedValue,spellcheck:false});
    const input = control.querySelector("input");
    input.setAttribute("aria-label",accessibleName);
    if (computedValue) input.title = "計算値 " + computedValue;
    if (options) {
      const choices = document.createElement("datalist");
      choices.id = "css-" + key + "-options";
      for (const option of options) choices.append(new Option(option,option));
      input.setAttribute("list",choices.id);
      control.append(choices);
    }
    input.addEventListener("keydown",event => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        input.dispatchEvent(new Event("change",{bubbles:true}));
      }
    });
    return control;
  };
  const dimensions = group(cssField("幅","width"),cssField("高さ","height"));
  dimensions.classList.add("inspector-size");
  const spacing = boxModel((key,side) => cssField(sides[side],key + "-" + side,key + " " + sides[side]),
    () => sourceElement(sourceDocument,path));
  const size = inspectorSection("サイズの制約",false,
    group(cssField("min-width"),cssField("max-width")),
    group(cssField("min-height"),cssField("max-height")),
    cssField("box-sizing","box-sizing","box-sizing",["content-box","border-box"]),cssField("aspect-ratio"));
  const position = inspectorSection("位置と重なり",true,
    cssField("position","position","position",["static","relative","absolute","fixed","sticky"]),
    group(cssField("top"),cssField("right")),group(cssField("bottom"),cssField("left")),cssField("z-index"));
  if (computed.position === "absolute" || computed.position === "fixed") {
    position.append(metricsList([["配置の基準",element.offsetParent ? sourceLabel(element.offsetParent) : "ビューポート"]]));
  }
  const layout = inspectorSection("表示・Flex・Grid",false,
    cssField("display","display","display",["block","inline","inline-block","flex","inline-flex","grid","inline-grid","contents","none"]),
    cssField("overflow","overflow","overflow",["visible","hidden","clip","auto","scroll"]),
    group(cssField("gap"),cssField("flex-direction")),cssField("flex-wrap"),
    cssField("justify-content"),cssField("align-items"),cssField("align-self"),
    cssField("grid-template-columns"),cssField("grid-template-rows"),group(cssField("grid-column"),cssField("grid-row")));
  const appearance = inspectorSection("文字と見た目",false,cssField("color"),cssField("background-color"),
    group(cssField("font-size"),cssField("line-height")),cssField("font-family"),
    cssField("border"),cssField("border-radius"),cssField("opacity"),cssField("transform"));
  const extras = Array.from(element.style).filter(key => !known.has(key)).map(key => cssField(key));
  const custom = inspectorSection("任意の CSS プロパティ",false,customStyleForm(),...extras);
  const accessibility = inspectorSection("アクセシビリティの目安",false,metricsList(accessibilityInfo(element,computed)));
  const help = document.createElement("p");
  help.className = "help";
  help.textContent = item ? "幅・高さ・余白の px 指定は現在の画面幅のレイヤーに反映します。詳細 CSS の適用で HTML タグ編集に切り替わります。" :
    "角をドラッグするか、幅・高さを入力できます。CSS の入力を空欄にすると指定を解除します。";
  const focused = properties.contains(document.activeElement) && document.activeElement.getAttribute("aria-label");
  properties.replaceChildren(tagName(sourceLabel(element)),metricsList([["表示サイズ",boxSize(element.getBoundingClientRect())]]),
    dimensions,spacing,help,position,size,layout,appearance,custom,accessibility);
  if (focused) {
    Array.from(properties.querySelectorAll("input")).find(input => input.getAttribute("aria-label") === focused)?.focus({preventScroll:true});
  }
}
sourceSheet.addEventListener("load",() => {
  const page = sourceSheet.contentDocument;
  if (previewSource === undefined || page?.head?.firstElementChild?.dataset.preview !== String(previewRevision)) return;
  sourceDocument = page;
  if (typeof project.source !== "string" && selected) {
    const previous = page.getElementById(selected);
    inspectedPath = page.body.contains(previous) ? pathFor(previous) : null;
  }
  const frameWindow = page.defaultView;
  if (sourceScroll) frameWindow.scrollTo(...sourceScroll);
  page.addEventListener("click",event => {
    event.preventDefault();
    if (codeDirty()) return;
    const element = event.target;
    if (page.body.contains(element) && inspectable(element)) pickSource(pathFor(element));
  },true);
  page.addEventListener("contextmenu",event => {
    const element = event.target;
    if (codeDirty() || !page.body.contains(element) || !inspectable(element)) return;
    event.preventDefault();
    pickSource(pathFor(element));
    openCanvasSpacing();
  },true);
  page.addEventListener("keydown",event => {
    if (event.key === "Escape" && canvasSpacingTarget) closeCanvasSpacing();
  });
  page.addEventListener("pointerover",event => {
    if (page.body.contains(event.target) && inspectable(event.target)) hoverSource(event.target);
  });
  page.addEventListener("pointerout",event => {
    if (!event.relatedTarget?.nodeType || !page.body.contains(event.relatedTarget)) hoverSource(null);
  });
  page.addEventListener("auxclick",event => event.preventDefault(),true);
  page.addEventListener("scroll",highlightSource,true);
  frameWindow.addEventListener("resize",() => {
    highlightSource();
    if (sourceDocument === page && !properties.contains(document.activeElement)) renderSourceProperties();
  });
  renderSourceLayers();
  renderSourceProperties();
  highlightSource();
});

function codeDirty() {
  return sourceCode.value !== codeBase;
}
function updateCodeControls() {
  const dirty = codeDirty();
  codeToggle.disabled = dirty;
  inspectToggle.disabled = dirty;
  byId("code-apply").disabled = !dirty || !sourceCode.value.trim();
  byId("code-reset").disabled = !dirty;
  for (const control of ["new","open","preview","export"]) byId(control).disabled = dirty;
  for (const area of ["#add-tools","#layers-panel",".panel.right",".viewport"]) document.querySelector(area).inert = dirty;
  byId("code-help").textContent = dirty ? "キャンバスで編集を続けるには、コードを反映するか変更を破棄してください。" :
    typeof project.source === "string" ? "HTML と CSS の変更は「コードを反映」でキャンバスに表示されます。" :
    "コードを反映すると、レイヤー編集から HTML タグの編集に切り替わります。";
}
function refreshCode() {
  if (codePanel.hidden) return;
  if (!codeDirty()) {
    const next = exportHTML(false);
    if (sourceCode.value !== next) sourceCode.value = next;
    codeBase = sourceCode.value;
  }
  updateCodeControls();
}
function setCodePanel(open) {
  codePanel.hidden = !open;
  codeToggle.setAttribute("aria-pressed",String(open));
  if (open) refreshCode();
}
function openCode(focus) {
  if (codePanel.hidden) {
    setCodePanel(true);
    queueSave();
  }
  if (focus) sourceCode.focus();
}
codeToggle.addEventListener("click",() => {
  if (codePanel.hidden) openCode(true);
  else {
    setCodePanel(false);
    queueSave();
  }
});
sourceCode.addEventListener("input",() => { queueSave(); updateCodeControls(); renderHistory(); });
byId("code-reset").addEventListener("click",() => {
  sourceCode.value = codeBase;
  queueSave();
  refreshCode();
  renderHistory();
});
byId("code-apply").addEventListener("click",() => {
  const next = projectFromSource(sourceCode.value,project.fileName);
  codeBase = sourceCode.value;
  change(() => { project = next; selected = null; });
  status("コードをキャンバスに反映しました。");
});
function download() {
  const filename = downloadFilename();
  const url = URL.createObjectURL(new Blob([exportHTML()],{type:"text/html;charset=utf-8"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url),60000);
  status("HTMLファイルを保存しました。");
}
const dialog = byId("preview-dialog");
const previewFrame = byId("preview-frame");
const iframe = previewFrame.querySelector("iframe");
let previewDevice = "desktop";
function fitPreview() {
  if (!dialog.open) return;
  const width = widths[previewDevice];
  const zoom = Math.min(1,previewFrame.clientWidth/width);
  iframe.style.width = width+"px";
  iframe.style.height = previewFrame.clientHeight/zoom+"px";
  iframe.style.transform = "scale("+zoom+")";
  iframe.style.transformOrigin = "top left";
  iframe.style.marginLeft = Math.max(0,(previewFrame.clientWidth - width*zoom)/2)+"px";
}
function setPreview(device) {
  previewDevice = device;
  for (const control of dialog.querySelectorAll("[data-preview]")) {
    control.setAttribute("aria-pressed",String(control.dataset.preview === device));
  }
  fitPreview();
}
function showPreview() {
  iframe.srcdoc = typeof project.source === "string" ? previewHTML(project.source) : exportHTML(false);
  dialog.showModal();
  setPreview(view);
}
dialog.addEventListener("close",() => iframe.removeAttribute("srcdoc"));

function chooseImage(target) {
  imageRequest = {target,project};
  byId("file-image").click();
}
byId("file-image").addEventListener("change",async event => {
  const input = event.target;
  const file = input.files[0], request = imageRequest;
  input.value = "";
  if (!file || !request) return;
  const allowed = ["image/png","image/jpeg","image/webp","image/gif","image/avif"];
  if (!allowed.includes(file.type)) return status("PNG・JPEG・WebP・GIF・AVIFを選んでください。");
  if (file.size > 8000000) return status("画像は8 MB以下のファイルを選んでください。");
  try {
    const data = await new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.addEventListener("load",() => resolve(reader.result));
      reader.addEventListener("error",reject);
      reader.readAsDataURL(file);
    });
    const image = safeImage(data);
    if (!image) throw new Error();
    if (request !== imageRequest || request.project !== project) return;
    if (!request.target) { add("image",image); return; }
    const item = project.items.find(layer => layer.id === request.target && layer.type === "image");
    if (item) change(() => { item.src = image; });
  } catch { status("画像を読み込めませんでした。"); }
});
byId("file-open").addEventListener("change",async event => {
  const input = event.target, file = input.files[0];
  input.value = "";
  if (!file) return;
  try {
    const template = document.createElement("template");
    const source = await file.text();
    if (codeDirty()) return;
    template.innerHTML = source;
    const metadata = template.content.querySelector('script[id="sitecanvas-project"][type="application/json"]');
    let next;
    if (metadata) {
      const images = new Map();
      for (const image of template.content.querySelectorAll(".site-object[id] > img")) {
        images.set(image.parentElement.id,image.getAttribute("src"));
      }
      next = readProject(JSON.parse(metadata.textContent),key => images.get(key));
    } else {
      next = projectFromSource(source,file.name);
    }
    next.fileName = file.name;
    change(() => { project = next; selected = null; });
    status("HTMLを開きました。");
  } catch (error) {
    status(error instanceof SyntaxError ? "このHTMLの編集データを読み込めません。" : error.message || "HTMLを読み込めませんでした。");
  }
});
byId("new").addEventListener("click",() => change(() => {
  project = blank();
  selected = inspectedPath = hoveredElement = null;
  inspectMode = false;
}));
byId("open").addEventListener("click",() => byId("file-open").click());
byId("export").addEventListener("click",download);
byId("preview").addEventListener("click",showPreview);
byId("front").addEventListener("click",() => moveLayer(1));
byId("back").addEventListener("click",() => moveLayer(-1));
byId("undo").addEventListener("click",() => restore(past,future));
byId("redo").addEventListener("click",() => restore(future,past));
byId("add-tools").addEventListener("click",event => {
  const button = event.target.closest("[data-add]");
  if (!button) return;
  if (button.dataset.add === "image") chooseImage(null);
  else add(button.dataset.add);
});
for (const control of document.querySelectorAll("[data-view]")) {
  control.addEventListener("click",() => {
    if (view === control.dataset.view) return;
    view = control.dataset.view;
    queueSave();
    render();
  });
}
for (const control of dialog.querySelectorAll("[data-preview]")) {
  control.addEventListener("click",() => setPreview(control.dataset.preview));
}
document.addEventListener("keydown",event => {
  if (dialog.open || codeDirty() || event.target.closest?.("input,textarea,select,[contenteditable]")) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "z") {
    event.preventDefault();
    if (event.shiftKey) restore(future,past);
    else restore(past,future);
    return;
  }
  if (event.key === "Escape") {
    if (spacingGesture) { finishSpacingDrag(true); return; }
    if (canvasSpacingTarget) { closeCanvasSpacing(); return; }
    if (sourceResizeGesture) { finishSourceResize(true); return; }
    if (tagCanvas()) pickSource(null);
    else select(null);
    return;
  }
  const item = itemSelected();
  if (!item || event.target !== sheet) return;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    remove();
  }
  const directions = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
  const direction = directions[event.key];
  if (direction) {
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    change(() => offsetGeometry(item[view],direction[0]*step,direction[1]*step,false));
  }
});
new ResizeObserver(fit).observe(viewport);
new ResizeObserver(fitPreview).observe(previewFrame);
if (workspace.editor.codeOpen === true || typeof workspace.editor.draft === "string") {
  setCodePanel(true);
  if (typeof workspace.editor.draft === "string") sourceCode.value = workspace.editor.draft;
}
render();
renderSaveStatus();
setInterval(flushSave,saveInterval);
window.addEventListener("pagehide",flushSave);
document.addEventListener("visibilitychange",() => {
  if (document.visibilityState === "hidden") flushSave();
});
