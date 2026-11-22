"use strict";

const byId = id => document.getElementById(id);
const sheet = byId("sheet");
const viewport = byId("viewport");
const shell = byId("shell");
const properties = byId("properties");
const sourceSheet = byId("source-sheet");
const sourceOutline = byId("source-outline");
const sourceCode = byId("source-code");
const codePanel = byId("code-panel");
const codeToggle = byId("code-toggle");
const types = {text:"テキスト", image:"画像", button:"ボタン", shape:"四角形"};
const symbols = {text:"T", image:"▧", button:"▣", shape:"■"};
const widths = {desktop:960, mobile:390};
const storageKey = "sitecanvas-v1";
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
function readProject(raw, getImage) {
  if (raw?.version !== 1 || !Array.isArray(raw.items) || raw.items.length > 500) {
    throw new Error("SiteCanvasから書き出したHTMLを選んでください。");
  }
  const result = blank();
  result.title = typeof raw.title === "string" ? raw.title.slice(0,160) : result.title;
  if (typeof raw.source === "string") return {...result,source:raw.source};
  result.background = safeColor(raw.background,result.background);
  for (const name of Object.keys(widths)) {
    result.heights[name] = number(raw.heights?.[name],result.heights[name],300,8000);
  }
  for (const item of raw.items) {
    if (!item || !Object.hasOwn(types,item.type)) continue;
    const data = make(item.type,
      boundedRect(item.desktop,widths.desktop,result.heights.desktop),
      boundedRect(item.mobile,widths.mobile,result.heights.mobile));
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
function load() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) return readProject(JSON.parse(saved));
  } catch {}
  return example();
}
let project = load();

function status(message) {
  byId("status").textContent = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { byId("status").textContent = ""; },4000);
}
function save() {
  try { localStorage.setItem(storageKey,JSON.stringify(project)); }
  catch { status("ブラウザに自動保存できません。HTMLを書き出して保存してください。"); }
}
function snapshot() {
  return {project:structuredClone(project),selected};
}
function record(before) {
  past.push(before);
  if (past.length > 50) past.shift();
  future.length = 0;
  save();
}
function change(update) {
  const before = snapshot();
  update();
  record(before);
  render();
}
function restore(from,to) {
  if (!from.length) return;
  to.push(snapshot());
  ({project,selected} = from.pop());
  save();
  render();
}
function itemSelected() {
  return project.items.find(item => item.id === selected);
}
function titleFor(item) {
  return item.text.trim().split("\n")[0] || item.alt || types[item.type];
}
function itemTag(item) {
  return item.type === "button" && item.href ? "a" : "div";
}
function select(which) {
  if (selected === which) return;
  selected = which;
  render();
}
function textStyle(item) {
  const align = {left:"flex-start",center:"center",right:"flex-end"};
  return {
    color:item.color,fontFamily:fonts[item.font],fontWeight:item.bold ? "700" : "400",
    textAlign:item.align,justifyContent:align[item.align],
    alignItems:item.type === "button" ? "center" : "flex-start"
  };
}
function renderArt() {
  const usesSource = typeof project.source === "string";
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
    sourceOutline.hidden = true;
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
      backgroundColor:["shape","button"].includes(item.type) ? item.fill : "transparent"
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
  byId("stage-size").textContent = widths[view] + " × " + project.heights[view] + " px · " + Math.round(scale * 100) + "%";
}
function renderLayers() {
  const usesSource = typeof project.source === "string";
  byId("add-heading").hidden = usesSource;
  byId("add-tools").hidden = usesSource;
  byId("layer-tools").hidden = usesSource;
  byId("layers-heading").textContent = usesSource ? "HTML 要素" : "レイヤー";
  byId("canvas-help").textContent = usesSource ? "キャンバスまたは HTML 要素の一覧から選択" : "ドラッグで移動 · 右下のつまみでサイズ変更";
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
  renderArt();
  renderLayers();
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
  input.addEventListener("change",() => {
    const next = kind === "checkbox" ? input.checked : kind === "number" ? input.valueAsNumber : input.value;
    const before = snapshot();
    const actual = update(next);
    if (actual !== undefined && kind !== "checkbox") input.value = actual;
    if (JSON.stringify(before.project) !== JSON.stringify(project)) {
      record(before);
      renderArt();
      renderLayers();
      refreshCode();
      renderHistory();
    }
  });
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
function boxModel(width,height,spacingField) {
  const label = text => {
    const title = document.createElement("p");
    title.className = "box-label";
    title.textContent = text;
    return title;
  };
  const spacing = key => [
    group(spacingField(key,"top"),spacingField(key,"right")),
    group(spacingField(key,"bottom"),spacingField(key,"left"))
  ];
  const size = document.createElement("div");
  size.className = "box-size";
  size.append(label("サイズ"),group(width,height));
  const padding = document.createElement("div");
  padding.className = "box-padding";
  padding.append(label("padding"),...spacing("padding"),size);
  const margin = document.createElement("div");
  margin.className = "box-model";
  margin.append(label("margin"),...spacing("margin"),padding);
  return margin;
}
function tagName(label) {
  const tag = document.createElement("p");
  tag.className = "tag-name";
  tag.textContent = label;
  return tag;
}
function renderProperties() {
  if (typeof project.source === "string") {
    renderSourceProperties();
    return;
  }
  const item = itemSelected();
  byId("properties-title").textContent = item ? types[item.type] + "の設定" : "ページ設定";
  if (!item) {
    properties.replaceChildren(section(
      field("ページタイトル","text",project.title,value => { project.title = value; },{maxLength:160}),
      field("背景色","color",project.background,value => { project.background = value; }),
      field("ページの高さ (px)","number",project.heights[view],value => {
        const minimum = project.items.reduce((height,layer) => Math.max(height,layer[view].y + layer[view].h),300);
        project.heights[view] = number(value,project.heights[view],minimum,8000);
        return project.heights[view];
      },{min:300,max:8000})
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
  const h = geometry("高さ","h",16,() => project.heights[view]-position.y);
  const layout = section(
    tagName("<" + itemTag(item) + "> · " + (view === "desktop" ? "PC" : "スマホ") + " · px"),
    group(x,y),boxModel(w,h,spacingField)
  );
  layout.addEventListener("change",() => {
    x.querySelector("input").max = widths[view] - position.w;
    y.querySelector("input").max = project.heights[view] - position.h;
    w.querySelector("input").max = widths[view] - position.x;
    h.querySelector("input").max = project.heights[view] - position.y;
  });
  const appearance = section();
  if (item.type === "text" || item.type === "button") {
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
  if (item.type === "shape" || item.type === "button") {
    appearance.append(field("塗り色","color",item.fill,value => { item.fill = value; }));
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
function add(type,image) {
  if (project.items.length >= 500) return status("このページには500個まで要素を追加できます。");
  const dimensions = {text:[340,86,30,245,76,23],button:[175,52,18,150,45,16],
    image:[320,210,24,260,170,24],shape:[150,120,24,125,104,24]};
  const d = dimensions[type];
  const item = make(type,centered("desktop",...d.slice(0,3)),centered("mobile",...d.slice(3)));
  if (type === "button") Object.assign(item,{color:"#ffffff",bold:true,align:"center",radius:8});
  if (type === "shape") Object.assign(item,{fill:"#dce8d7",radius:8});
  if (image) item.src = image;
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
function offsetGeometry(position,dx,dy,resize) {
  if (resize) {
    position.w = clamp(position.w+dx,16,widths[view]-position.x);
    position.h = clamp(position.h+dy,16,project.heights[view]-position.y);
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
  select(target.dataset.id);
  const item = itemSelected();
  gesture = {pointer:event.pointerId,startX:event.clientX,startY:event.clientY,resize,
    position:{...item[view]},view,scale,before:snapshot(),item};
  sheet.setPointerCapture(event.pointerId);
});
sheet.addEventListener("pointermove",event => {
  if (gesture?.pointer !== event.pointerId) return;
  const dx = Math.round((event.clientX-gesture.startX)/gesture.scale);
  const dy = Math.round((event.clientY-gesture.startY)/gesture.scale);
  const position = {...gesture.position};
  offsetGeometry(position,dx,dy,gesture.resize);
  gesture.item[gesture.view] = position;
  const element = sheet.querySelector(".selected");
  Object.assign(element.style,{left:position.x+"px",top:position.y+"px",
    width:position.w+"px",height:position.h+"px"});
});
function finishGesture(event,cancelled) {
  if (gesture?.pointer !== event.pointerId) return;
  const current = gesture;
  gesture = null;
  if (cancelled) current.item[current.view] = current.position;
  if (JSON.stringify(current.item[current.view]) !== JSON.stringify(current.position)) record(current.before);
  render();
}
sheet.addEventListener("pointerup",event => finishGesture(event,false));
sheet.addEventListener("pointercancel",event => finishGesture(event,true));
sheet.addEventListener("lostpointercapture",event => finishGesture(event,true));
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
function exportItem(item) {
  const style = textStyle(item);
  const css = [
    inlineGeometry(item),"color:"+style.color,"font-family:"+style.fontFamily,
    "font-weight:"+style.fontWeight,"text-align:"+style.textAlign,
    "justify-content:"+style.justifyContent,"align-items:"+style.alignItems
  ];
  if (["button","shape"].includes(item.type)) css.push("background:"+item.fill);
  const tag = itemTag(item);
  const extra = tag === "a" ? ' href="' + htmlEscape(item.href) + '"' : item.type === "shape" ? ' aria-hidden="true"' : "";
  const content = item.type === "image" ?
    '<img src="' + htmlEscape(item.src) + '" alt="' + htmlEscape(item.alt) + '">' : htmlEscape(item.text);
  return '<' + tag + ' class="site-object" id="' + htmlEscape(item.id) + '" style="' +
    htmlEscape(css.join(";")) + '"' + extra + '>' + content + '</' + tag + '>';
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
    '<body><main class="site"><div class="page">',
    ...project.items.map(exportItem),
    '</div></main>',
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
function projectFromSource(source) {
  const title = parseHTML(source).title.trim().slice(0,160) || "無題のサイト";
  return {...blank(),title,source};
}
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
function renderSourceSheet() {
  if (previewSource === project.source) return;
  if (selected === null) sourceScroll = undefined;
  else if (sourceDocument) {
    const {scrollLeft,scrollTop} = sourceDocument.scrollingElement;
    sourceScroll = [scrollLeft,scrollTop];
  }
  previewSource = project.source;
  sourceDocument = undefined;
  sourceOutline.hidden = true;
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
  return element.style && !["link","meta","script","style","template"].includes(element.localName);
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
    row.setAttribute("aria-pressed",String(path === selected));
    row.dataset.path = path;
    row.title = sourceLabel(element);
    const name = document.createElement("span");
    name.textContent = row.title;
    row.append(name);
    row.addEventListener("click",() => {
      element.scrollIntoView({block:"nearest",inline:"nearest",container:"nearest"});
      select(path);
      highlightSource();
    });
    return row;
  });
  layers.replaceChildren(...rows);
  layers.scrollTop = scrollTop;
  rows.find(row => row.dataset.path === focusedPath)?.focus({preventScroll:true});
}
function highlightSource() {
  const element = sourceElement(sourceDocument,selected);
  if (!element) {
    sourceOutline.hidden = true;
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
}
function editSourceStyle(path,key,value) {
  const page = parseHTML(project.source);
  const element = sourceElement(page,path);
  if (!element) return "";
  const previous = element.style.getPropertyValue(key);
  const previousPriority = element.style.getPropertyPriority(key);
  const priority = /\s*!important\s*$/i.test(value) ? "important" : "";
  const input = value.replace(/\s*!important\s*$/i,"").trim();
  const next = /^-?(?:\d+\.?\d*|\.\d+)$/.test(input) ? input + "px" : input;
  if (next && !CSS.supports(key,next)) {
    status("CSS の値を確認してください。例 24px、2rem、10%");
    return inlineStyleValue(element,key);
  }
  if (next !== previous || priority !== previousPriority) {
    element.style.setProperty(key,next,priority);
    if (!element.style.length) element.removeAttribute("style");
    project.source = serializeHTML(page);
  }
  return inlineStyleValue(element,key);
}
function inlineStyleValue(element,key) {
  const value = element.style.getPropertyValue(key);
  return element.style.getPropertyPriority(key) ? value + " !important" : value;
}
function renderSourceProperties() {
  const heading = byId("properties-title");
  const element = sourceElement(sourceDocument,selected);
  heading.textContent = "要素のスタイル";
  if (!element) {
    const help = document.createElement("p");
    help.className = "help";
    help.textContent = "編集する HTML 要素を選んでください。";
    properties.replaceChildren(help);
    return;
  }
  const computed = sourceSheet.contentWindow.getComputedStyle(element);
  const cssField = (name,key,accessibleName = name) => {
    const control = field(name,"text",inlineStyleValue(element,key),
      value => editSourceStyle(selected,key,value),{placeholder:computed.getPropertyValue(key)});
    control.querySelector("input").setAttribute("aria-label",accessibleName);
    return control;
  };
  const help = document.createElement("p");
  help.className = "help";
  help.textContent = "入力した値はタグの style に反映されます。空欄にすると指定を解除します。";
  const focused = properties.contains(document.activeElement) && document.activeElement.getAttribute("aria-label");
  properties.replaceChildren(tagName(sourceLabel(element)),boxModel(cssField("幅","width"),cssField("高さ","height"),
    (key,side) => cssField(sides[side],key + "-" + side,key + " " + sides[side])),help);
  if (focused) {
    Array.from(properties.querySelectorAll("input")).find(input => input.getAttribute("aria-label") === focused)?.focus({preventScroll:true});
  }
}
sourceSheet.addEventListener("load",() => {
  const page = sourceSheet.contentDocument;
  if (previewSource === undefined || page?.head?.firstElementChild?.dataset.preview !== String(previewRevision)) return;
  sourceDocument = page;
  const frameWindow = page.defaultView;
  if (sourceScroll) frameWindow.scrollTo(...sourceScroll);
  page.addEventListener("click",event => {
    event.preventDefault();
    if (codeDirty()) return;
    const element = event.target;
    if (page.body.contains(element) && inspectable(element)) select(pathFor(element));
  },true);
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
  byId("code-apply").disabled = !dirty || !sourceCode.value.trim();
  byId("code-reset").disabled = !dirty;
  for (const control of ["new","open","preview","export"]) byId(control).disabled = dirty;
  for (const area of [".panel.left",".panel.right",".viewport"]) document.querySelector(area).inert = dirty;
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
codeToggle.addEventListener("click",() => {
  codePanel.hidden = !codePanel.hidden;
  codeToggle.setAttribute("aria-pressed",String(!codePanel.hidden));
  if (!codePanel.hidden) {
    refreshCode();
    sourceCode.focus();
  }
});
sourceCode.addEventListener("input",() => { updateCodeControls(); renderHistory(); });
byId("code-reset").addEventListener("click",() => {
  sourceCode.value = codeBase;
  refreshCode();
  renderHistory();
});
byId("code-apply").addEventListener("click",() => {
  const next = projectFromSource(sourceCode.value);
  codeBase = sourceCode.value;
  change(() => { project = next; selected = null; });
  status("コードをキャンバスに反映しました。");
});
function download() {
  const filename = (project.title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g,"-").replace(/[. ]+$/,"") || "index") + ".html";
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
      next = projectFromSource(source);
    }
    change(() => { project = next; selected = null; });
    status("HTMLを開きました。");
  } catch (error) {
    status(error instanceof SyntaxError ? "このHTMLの編集データを読み込めません。" : error.message || "HTMLを読み込めませんでした。");
  }
});
byId("new").addEventListener("click",() => change(() => { project = blank(); selected = null; }));
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
  control.addEventListener("click",() => { view = control.dataset.view; render(); });
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
  if (event.key === "Escape") { select(null); return; }
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
render();
