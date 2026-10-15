// 操作マニュアル用のスクリーンショット撮影（2026-10 全面改訂＝注釈付きの画面・手順の連続画面・部分拡大・実物画像）
//
// 使い方（リポジトリのルートで）:
//   node マニュアル/作成ツール/serve.js                    … 別ターミナルで起動したままにする
//   node マニュアル/作成ツール/capture-puppeteer.js        … 全部撮る（ルートの screenshots/manual/ へ出力）
//   node マニュアル/作成ツール/capture-puppeteer.js m03 m05 … 章を絞って撮る（撮影一覧 _manifest.json は既存分とマージ）
//   その後 node マニュアル/作成ツール/create-manual.js で .docx を作る
//
// ブラウザ: puppeteer があればそれを、無ければ playwright の Chromium を使う（Windows＝npm install 済みの puppeteer／
//   クラウド・Linux＝NODE_PATH=/opt/node-tools/node_modules で playwright）。どちらでも同じ手順で撮れるよう、
//   差のある API（画面サイズ・ダブルクリック・待ち）は下の薄い関数で吸収している。
// Linux で撮るときは日本語が中国語フォント（WenQuanYi）に落ちて字形が変わるので、IPAPゴシックを優先させる fonts.conf を
//   一時ファイルに書いて FONTCONFIG_FILE で渡す（Windows では何もしない）。
//
// 方針: 操作はなるべく実際の UI（ボタンのクリック・実マウスのドラッグ・ホバー）を通す。内部状態の直接書き換えは
//   初期データの用意だけ＝撮った画面がそのまま「本当にそう動く」ことの確認になる。
// 注釈（赤枠・番号・カーソルの絵・矢印）は撮影直前にページ最前面へ重ねる SVG で描き、撮ったら外す。
//   対象が見つからないときは例外で止める（UI が変わって注釈が黙ってずれるのを防ぐ）。

const path = require('path');
const fs = require('fs');
const os = require('os');

// マニュアル用の撮影対象。版を上げたらここも上げる（旧版はリネームで消えるため参照できなくなる）。
// serve.js はリポジトリのルートを配る＝本体は アプリケーション本体/ の下（日本語のフォルダ名は URL 用に符号化する）
const URL = 'http://localhost:8765/' + encodeURI('アプリケーション本体/diagram_v8.32.html');
// 撮った画面はリポジトリのルートの screenshots/manual/（.gitignore 対象）
const outDir = path.join(__dirname, '..', '..', 'screenshots', 'manual');
const VW = 1600, VH = 900, DSF = 2;   // メニューバーが ‹ › なしで全部見える幅（実測 1583px）・2 倍の解像度
fs.mkdirSync(outDir, { recursive: true });

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// ============================================================
//  ブラウザ起動（puppeteer／playwright の差を吸収）
// ============================================================
function setupLinuxFonts() {
  if (process.platform !== 'linux' || process.env.FONTCONFIG_FILE) return;
  const conf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <match target="pattern">
    <test name="lang" compare="contains"><string>ja</string></test>
    <edit name="family" mode="prepend" binding="strong"><string>IPAPGothic</string></edit>
  </match>
  <alias binding="strong"><family>sans-serif</family><prefer><family>DejaVu Sans</family><family>IPAPGothic</family><family>Noto Color Emoji</family></prefer></alias>
  <selectfont><rejectfont><glob>/usr/share/fonts/truetype/wqy/*</glob><glob>/usr/share/fonts/opentype/unifont/*</glob></rejectfont></selectfont>
</fontconfig>
`;
  const p = path.join(os.tmpdir(), 'bdm-manual-fonts.conf');
  fs.writeFileSync(p, conf);
  process.env.FONTCONFIG_FILE = p;
}

async function launch() {
  setupLinuxFonts();
  let pp = null;
  try { pp = require('puppeteer'); } catch (e) { }
  if (pp) {
    const browser = await pp.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: VW, height: VH, deviceScaleFactor: DSF });
    return {
      browser, page, kind: 'puppeteer',
      setSize: (w, h) => page.setViewport({ width: w, height: h, deviceScaleFactor: DSF }),
      dbl: (x, y) => page.mouse.click(x, y, { count: 2 }),
    };
  }
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  return {
    browser, page, kind: 'playwright',
    setSize: (w, h) => page.setViewportSize({ width: w, height: h }),
    dbl: (x, y) => page.mouse.dblclick(x, y),
  };
}

// ============================================================
//  ページ内ヘルパー（注釈・座標の解決）。goto のたびに入れ直す
// ============================================================
function pageHelpers() {
  const NSV = 'http://www.w3.org/2000/svg';
  const RED = '#dc2626';
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const nodeOf = (t) => {
    const all = S.nodes.filter(n => (n.text || '') === t || (n.sections && n.sections.some(s => s.text === t)));
    if (!all.length) throw new Error('注釈の対象ノードが見つかりません: ' + t);
    return all[0];
  };
  const d2c = (x, y) => {
    const svg = document.getElementById('diagram-svg');
    const m = svg.getScreenCTM();
    const p = svg.createSVGPoint(); p.x = x; p.y = y;
    const q = p.matrixTransform(m);
    return [q.x, q.y];
  };
  // 対象 → 画面上の矩形 {x,y,w,h}
  const box = (t) => {
    if (Array.isArray(t)) {   // 複数の対象の和集合
      const bs = t.map(box);
      const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
      const x1 = Math.max(...bs.map(b => b.x + b.w)), y1 = Math.max(...bs.map(b => b.y + b.h));
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    if (typeof t === 'string') t = { sel: t };
    let b;
    if (t.sel) {
      let els = [...document.querySelectorAll(t.sel)].filter(vis);
      if (t.text) els = els.filter(el => el.textContent.includes(t.text));
      if (t.i != null) els = els[t.i] ? [els[t.i]] : [];
      if (!els.length) throw new Error('注釈の対象が見つかりません: ' + t.sel + (t.text ? ' / ' + t.text : ''));
      const rs = els.map(el => el.getBoundingClientRect());
      const x0 = Math.min(...rs.map(r => r.left)), y0 = Math.min(...rs.map(r => r.top));
      const x1 = Math.max(...rs.map(r => r.right)), y1 = Math.max(...rs.map(r => r.bottom));
      b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    } else if (t.node) {
      const n = nodeOf(t.node);
      const [x0, y0] = d2c(n.x, n.y), [x1, y1] = d2c(n.x + n.w, n.y + n.h);
      b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    } else if (t.d) {   // 図の座標の矩形 [x,y,w,h]
      const [x0, y0] = d2c(t.d[0], t.d[1]), [x1, y1] = d2c(t.d[0] + t.d[2], t.d[1] + t.d[3]);
      b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    } else if (t.c) {   // 画面座標の矩形 [x,y,w,h]
      b = { x: t.c[0], y: t.c[1], w: t.c[2], h: t.c[3] };
    } else throw new Error('注釈の対象の指定が不正です: ' + JSON.stringify(t));
    const pad = t.pad || 0;
    return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  };
  // 点の解決: [x,y]＝画面座標／{d:[x,y]}＝図の座標／{...対象, at:'c|t|b|l|r|tl|tr|bl|br', dx, dy}
  const pt = (p) => {
    if (Array.isArray(p)) return p;
    if (typeof p === 'string') p = { sel: p };   // 文字列の .at は String.prototype.at と衝突する
    if (p.dp) return d2c(p.dp[0], p.dp[1]);
    const b = box(p), at = p.at || 'c';
    let x = b.x + b.w / 2, y = b.y + b.h / 2;
    if (at.includes('l')) x = b.x; if (at.includes('r')) x = b.x + b.w;
    if (at.includes('t')) y = b.y; if (at.includes('b')) y = b.y + b.h;
    return [x + (p.dx || 0), y + (p.dy || 0)];
  };
  const mk = (tag, attrs, parent) => {
    const el = document.createElementNS(NSV, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  };
  // 注釈を描く。戻り値＝描いたものの外接矩形（切り抜きに含めるため）
  const draw = (items) => {
    clear();
    const W = innerWidth, H = innerHeight;
    const host = document.createElement('div');
    host.id = '__mnl_anno';
    host.style.cssText = 'position:fixed;left:0;top:0;width:' + W + 'px;height:' + H + 'px;pointer-events:none;z-index:2147483647';
    const svg = mk('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    host.appendChild(svg);
    document.body.appendChild(host);
    const defs = mk('defs', {}, svg);
    const mar = mk('marker', { id: '__mnl_ah', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
    mk('path', { d: 'M0,0 L10,5 L0,10 z', fill: RED }, mar);
    const ext = [];
    const grow = (x0, y0, x1, y1) => ext.push([x0, y0, x1, y1]);
    const badge = (x, y, num, r) => {
      r = r || 13;
      mk('circle', { cx: x, cy: y, r: r + 1.5, fill: '#fff' }, svg);
      mk('circle', { cx: x, cy: y, r, fill: RED }, svg);
      const t = mk('text', { x, y: y + r * 0.38, 'text-anchor': 'middle', 'font-size': r * 1.15, 'font-weight': 700, fill: '#fff', 'font-family': 'Arial,sans-serif' }, svg);
      t.textContent = String(num);
      grow(x - r - 2, y - r - 2, x + r + 2, y + r + 2);
    };
    const label = (x, y, text, side, fs) => {   // side: 'r'＝(x,y) の右に／'l'＝左に／'b'＝下に／'t'＝上に
      fs = fs || 13;
      const t = mk('text', { 'font-size': fs, 'font-weight': 700, fill: '#991b1b', 'font-family': 'sans-serif' }, svg);
      t.textContent = text;
      const tw = t.getComputedTextLength(), ph = fs + 10, pw = tw + 16;
      let bx = x, by = y - ph / 2;
      if (side === 'l') bx = x - pw;
      if (side === 'b') { bx = x - pw / 2; by = y; }
      if (side === 't') { bx = x - pw / 2; by = y - ph; }
      bx = Math.max(2, Math.min(W - pw - 2, bx)); by = Math.max(2, Math.min(H - ph - 2, by));
      const r = mk('rect', { x: bx, y: by, width: pw, height: ph, rx: 5, fill: '#fff', stroke: RED, 'stroke-width': 1.8 }, svg);
      svg.insertBefore(r, t);
      t.setAttribute('x', bx + 8); t.setAttribute('y', by + ph / 2 + fs * 0.36);
      grow(bx, by, bx + pw, by + ph);
    };
    const cursor = (x, y, kind) => {   // 矢印カーソル（先端＝(x,y)）／手のひら
      const g = mk('g', { transform: `translate(${x},${y}) scale(1.35)` }, svg);
      if (kind === 'hand') {
        mk('path', { d: 'M-2,-1 l0,-9 a2,2 0 0 1 4,0 l0,7 l0,-9 a2,2 0 0 1 4,0 l0,9 l0,-7 a2,2 0 0 1 4,0 l0,8 l0,-5 a2,2 0 0 1 4,0 l0,10 c0,6 -3,10 -9,10 l-2,0 c-4,0 -6,-3 -8,-6 l-4,-7 a2,2 0 0 1 3,-2 z', fill: '#fff', stroke: '#111', 'stroke-width': 1.2, 'stroke-linejoin': 'round' }, g);
        grow(x - 18, y - 20, x + 26, y + 30);
      } else {
        mk('path', { d: 'M0,0 L0,17 L4.2,13 L7.3,20 L10,18.8 L7,12 L12.5,12 Z', fill: '#fff', stroke: '#111', 'stroke-width': 1.3, 'stroke-linejoin': 'round' }, g);
        grow(x - 2, y - 2, x + 19, y + 29);
      }
    };
    for (const it of items) {
      if (it.box) {
        const b = box(it.box);
        const p = it.pad != null ? it.pad : 4;
        const x = b.x - p, y = b.y - p, w = b.w + p * 2, h = b.h + p * 2;
        mk('rect', { x, y, width: w, height: h, rx: it.rx != null ? it.rx : 6, fill: it.fill || 'none', stroke: it.sw === 0 ? 'none' : RED, 'stroke-width': it.sw || 3, 'stroke-dasharray': it.dash ? '8,5' : 'none' }, svg);
        grow(x - 2, y - 2, x + w + 2, y + h + 2);
        if (it.n != null) {
          const at = it.at || 'tl', r = it.r || 13;
          let bx = x, by = y;
          if (at.includes('r')) bx = x + w; if (at.includes('b')) by = y + h;
          if (at === 't' || at === 'b') bx = x + w / 2;
          if (at === 'l' || at === 'r') by = y + h / 2;
          if (it.inset) { bx += at.includes('r') ? -r - 3 : (at.includes('l') || at === 'tl' || at === 'bl' ? r + 3 : 0); by += at.includes('b') ? -r - 3 : (at.includes('t') ? r + 3 : 0); }
          if (it.out) { bx += at.includes('r') ? r + 3 : (at.includes('l') ? -r - 3 : 0); by += at.includes('b') ? r + 3 : (at.includes('t') ? -r - 3 : 0); }
          bx += it.bdx || 0; by += it.bdy || 0;
          badge(bx, by, it.n, r);
          if (it.label) label(bx + (it.labelSide === 'l' ? -r - 4 : r + 4), by, it.label, it.labelSide || 'r', it.fs);
        } else if (it.label) {
          const side = it.labelSide || 'b';
          const lx = side === 'r' ? x + w + 6 : side === 'l' ? x - 6 : x + w / 2;
          const ly = side === 'b' ? y + h + 6 : side === 't' ? y - 6 : y + h / 2;
          label(lx, ly, it.label, side, it.fs);
        }
      }
      if (it.badge != null) { const [x, y] = pt(it.at); badge(x, y, it.badge, it.r); if (it.label) label(x + (it.r || 13) + 4, y, it.label, 'r', it.fs); }
      if (it.arrow) {
        const [x0, y0] = pt(it.arrow[0]), [x1, y1] = pt(it.arrow[1]);
        mk('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: RED, 'stroke-width': it.sw || 3, 'stroke-dasharray': it.solid ? 'none' : '7,5', 'marker-end': 'url(#__mnl_ah)' }, svg);
        grow(Math.min(x0, x1) - 6, Math.min(y0, y1) - 6, Math.max(x0, x1) + 6, Math.max(y0, y1) + 6);
      }
      if (it.cursor) { const [x, y] = pt(it.cursor); cursor(x, y, it.kind); }
      if (it.text) { const [x, y] = pt(it.at); label(x, y, it.text, it.side || 'r', it.fs); }
    }
    if (!ext.length) return null;
    const x0 = Math.min(...ext.map(e => e[0])), y0 = Math.min(...ext.map(e => e[1]));
    const x1 = Math.max(...ext.map(e => e[2])), y1 = Math.max(...ext.map(e => e[3]));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const clear = () => { document.getElementById('__mnl_anno')?.remove(); };
  window.__mnl = { box, pt, draw, clear, d2c, nodeOf };
}

// ============================================================
//  撮影の共通処理
// ============================================================
let B, page;          // B＝launch() の戻り値
const manifest = {};  // name → {w,h,kind}（CSS px）

async function installHelpers() { await page.evaluate(pageHelpers); }
const ev = (fn, arg) => page.evaluate(fn, arg);
const pt = (p) => page.evaluate((p) => window.__mnl.pt(p), p);
const box = (t) => page.evaluate((t) => window.__mnl.box(t), t);

// 新しいページで図種を選んだ状態から始める（各章の撮影は互いに影響しないよう毎回読み込み直す）
async function open(type, opts = {}) {
  if (opts.size) await B.setSize(opts.size[0], opts.size[1]);
  else await B.setSize(VW, VH);
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('#new-modal');
  await installHelpers();
  if (type) {
    await ev((t) => {
      // 選べない図種（BPMN 等）もエンジンはあるので直接切り替えられる
      doSelectDiagramType(t);
      markSaved();
    }, type);
    await wait(250);
  }
}
// 未保存フラグを落とす（撮影中に「保存しますか」が割り込むのを防ぐ）
const clean = () => ev(() => { try { markSaved(); } catch (e) { } });

// 図の座標 → 画面座標
const d2c = (x, y) => page.evaluate(([x, y]) => window.__mnl.d2c(x, y), [x, y]);

async function move(p, steps = 8) { const [x, y] = await pt(p); await page.mouse.move(x, y, { steps }); return [x, y]; }
async function click(p) { const [x, y] = await move(p); await page.mouse.down(); await page.mouse.up(); await wait(120); return [x, y]; }
async function dblclick(p) { const [x, y] = await move(p); await B.dbl(x, y); await wait(200); return [x, y]; }
async function drag(a, b, opts = {}) {
  const [x0, y0] = await move(a, 4);
  await page.mouse.down();
  const [x1, y1] = await pt(b);
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 6 });
  await page.mouse.move(x1, y1, { steps: 8 });
  if (!opts.hold) { await page.mouse.up(); await wait(150); }
  return [x1, y1];
}
async function clickSel(sel) { await page.click(sel); await wait(150); }

// 画面の撮影。opts:
//   clip   … 省略＝画面全体（JPEG）／対象（box と同じ指定）＝その範囲を切り抜き（PNG）
//   pad    … 切り抜きの余白（CSS px・既定 16）
//   anno   … 注釈の配列（pageHelpers の draw を参照）
//   noAnnoInClip … 注釈の外接矩形を切り抜きに含めない
//   within … 切り抜きをこの対象の範囲に収める（例 '#canvas-wrap'＝サイドバーの端を写さない）
//   fmt    … 'png'|'jpeg' を明示
async function shot(name, opts = {}) {
  let annoBox = null;
  if (opts.anno && opts.anno.length) annoBox = await page.evaluate((a) => window.__mnl.draw(a), opts.anno);
  await wait(60);
  const vw = page.viewportSize ? page.viewportSize().width : (page.viewport() || {}).width;
  const vh = page.viewportSize ? page.viewportSize().height : (page.viewport() || {}).height;
  let clip = null;
  if (opts.clip) {
    let b = await box(opts.clip);
    if (annoBox && !opts.noAnnoInClip) {
      const x0 = Math.min(b.x, annoBox.x), y0 = Math.min(b.y, annoBox.y);
      const x1 = Math.max(b.x + b.w, annoBox.x + annoBox.w), y1 = Math.max(b.y + b.h, annoBox.y + annoBox.h);
      b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    const p = opts.pad != null ? opts.pad : 16;
    let lim = { x: 0, y: 0, w: vw, h: vh };
    if (opts.within) lim = await box(opts.within);
    const x0 = Math.max(0, lim.x, Math.floor(b.x - p)), y0 = Math.max(0, lim.y, Math.floor(b.y - p));
    const x1 = Math.min(vw, lim.x + lim.w, Math.ceil(b.x + b.w + p)), y1 = Math.min(vh, lim.y + lim.h, Math.ceil(b.y + b.h + p));
    clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
  const fmt = opts.fmt || (clip ? 'png' : 'jpeg');
  const file = name + (fmt === 'png' ? '.png' : '.jpg');
  const so = { path: path.join(outDir, file), type: fmt };
  if (fmt === 'jpeg') so.quality = 88;
  if (clip) so.clip = clip;
  await page.screenshot(so);
  await page.evaluate(() => window.__mnl.clear());
  manifest[name] = { file, w: clip ? clip.width : vw, h: clip ? clip.height : vh, dsf: DSF };
  console.log('  ' + file + '  ' + manifest[name].w + '×' + manifest[name].h);
}

// ============================================================
//  作例データ
// ============================================================
// 承認フロー（スイムレーン・3レーン）。座標は図の座標（シェイプの中心）
async function sampleApproval() {
  await ev(() => {
    S.lanes.forEach((l, i) => { l.name = ['申請者', '上長', '総務部'][i] || l.name; });
    const lx = (i) => laneX(S.lanes[i].id) + S.lanes[i].w / 2;
    const h = headerSize();
    const a = addNode('terminal', lx(0), h + 60, { text: '開始' });
    const b = addNode('rect', lx(0), h + 140, { text: '申請書を作成' });
    const c = addNode('rect', lx(1), h + 220, { text: '内容を確認' });
    const d = addNode('diamond', lx(1), h + 320, { text: '承認する?' });
    const e = addNode('rect', lx(2), h + 420, { text: '受付・登録' });
    const f = addNode('terminal', lx(2), h + 500, { text: '終了' });
    addEdge(a.id, b.id); addEdge(b.id, c.id); addEdge(c.id, d.id);
    const ok = addEdge(d.id, e.id); addEdge(e.id, f.id);
    const ng = addEdge(d.id, b.id);
    S.edges.find(x => x.id === ok).label = 'はい';
    S.edges.find(x => x.id === ng).label = '差戻し';
    const nm = document.getElementById('diagram-name'); nm.value = '経費精算の承認フロー'; onDiagramNameInput(nm.value);
    S.sel = []; snap(); render(); lanePanel(); markSaved();
  });
}

// ============================================================
//  章ごとの撮影
// ============================================================
const sections = {};

// ---------- 表紙・第1章（記号の見本） ----------
sections.m01 = async () => {
  await open('swimlane');
  await sampleApproval();
  await page.mouse.move(VW - 5, VH - 5);
  await ev(() => hint(''));
  await shot('m00_cover');
  await open('flowchart');
  await ev(() => {
    addNode('rect', 200, 120, { text: 'シェイプA' });
    addNode('rect', 470, 120, { text: 'シェイプB' });
    S.sel = []; render(); markSaved();
  });
  await shot('m01_legend', {
    clip: [{ node: 'シェイプA', pad: 30 }, { node: 'シェイプB', pad: 30 }], pad: 24, within: '#canvas-wrap',
    // 番号は manual-content.js の 1.1 の説明表（①枠 ②カーソル ③矢印 ④札）と同じ順
    anno: [
      { box: { node: 'シェイプA' }, n: 1, at: 'tl', pad: 6 },
      { cursor: { node: 'シェイプA', at: 'c', dx: 20, dy: 4 } },
      { badge: 2, at: { node: 'シェイプA', at: 'c', dx: 30, dy: 48 } },
      { arrow: [{ node: 'シェイプA', at: 'r', dx: 12 }, { node: 'シェイプB', at: 'l', dx: -12 }] },
      { badge: 3, at: { node: 'シェイプB', at: 'l', dx: -70, dy: -24 } },
      { text: '補足の説明', at: { node: 'シェイプB', at: 'b', dy: 30 }, side: 'b' },
      { badge: 4, at: { node: 'シェイプB', at: 'b', dx: -64, dy: 42 } },
    ],
  });
};

// ---------- 第2章 新しい図の作成 ----------
sections.m02 = async () => {
  await open(null);
  await shot('m02_01_dialog', {
    clip: '#new-modal-box', pad: 12,
    anno: [
      { box: { sel: '.dtype-card', i: 0 }, n: 1, at: 'tl', pad: 3 },
      { cursor: { sel: '.dtype-card', i: 0, at: 'c', dx: 30, dy: 6 } },
    ],
  });
  await click({ sel: '.dtype-card', i: 0 });
  await clean();
  await page.mouse.move(VW - 5, VH - 5);
  await shot('m02_02_editor');
};

// ---------- 第4章 シェイプの基本操作 ----------
// 3 レーンの空のスイムレーン（レーン名つき）
async function lanes3(names = ['申請者', '上長', '総務部']) {
  await ev((nm) => { S.lanes.forEach((l, i) => { l.name = nm[i] || l.name; }); render(); lanePanel(); markSaved(); }, names);
}
// レーン i の中心 x と、見出し下からの y（図の座標）
const lanePt = (i, y) => page.evaluate(([i, y]) => [laneX(S.lanes[i].id) + S.lanes[i].w / 2, headerSize() + y], [i, y]);

sections.m04 = async () => {
  // ---- 4.1 配置（クリック）----
  await open('swimlane'); await lanes3();
  await click('#ps-rect');
  const [px, py] = await lanePt(0, 120);
  const cpt = await d2c(px, py);
  const palArea = [{ sel: '#ps-rect' }, { sel: '#ps-crosslane' }, { d: [px - 120, py - 120, 240, 200] }];
  await shot('m04_place_1', {
    clip: palArea, pad: 10,
    anno: [{ box: '#ps-rect', n: 1, at: 'r', out: true, pad: 3 }, { cursor: { sel: '#ps-rect', at: 'c', dx: 10, dy: 4 } }],
  });
  await page.mouse.move(cpt[0], cpt[1], { steps: 6 });
  await wait(200);
  await shot('m04_place_1b', {
    clip: palArea, pad: 10,
    anno: [{ cursor: cpt }],
  });
  await page.mouse.down(); await page.mouse.up(); await wait(250);
  await page.keyboard.press('Escape'); await wait(150);
  await shot('m04_place_2', {
    clip: palArea, pad: 10,
    anno: [{ box: { node: 'プロセス' }, n: 2, at: 'tr', out: true, pad: 4 }, { cursor: [cpt[0] + 20, cpt[1] + 8] }],
  });
  // ---- ドラッグ＆ドロップ ----
  const [qx, qy] = await lanePt(1, 260);
  const q = await d2c(qx, qy);
  const a0 = await pt({ sel: '#ps-diamond', at: 'c' });
  await drag(a0, q, { hold: true });
  await wait(250);
  await shot('m04_place_drag', {
    clip: [{ sel: '#ps-diamond' }, { d: [qx - 120, qy - 80, 200, 160] }], pad: 10,
    anno: [{ arrow: [[a0[0] + 40, a0[1]], [q[0] - 40, q[1]]] }, { cursor: q }],
  });
  await page.mouse.up(); await wait(250);
  // ---- 重ねて置き換え ----
  await ev(() => {
    const n = S.nodes.find(n => n.type === 'diamond'); n.text = '承認する?';
    const r = S.nodes.find(n => n.type === 'rect'); r.text = '内容を確認'; render(); markSaved();
  });
  const t0 = await pt({ sel: '#ps-note', at: 'c' });
  const t1 = await pt({ node: '内容を確認', at: 'c', dx: 30, dy: 8 });
  const rArea = { node: '内容を確認', pad: 60 };
  const rBox = await box(rArea);
  await drag(t0, t1, { hold: true });
  await wait(300);
  await shot('m04_replace_1', { clip: { c: [rBox.x, rBox.y, rBox.w, rBox.h] }, pad: 0, within: '#canvas-wrap', anno: [{ cursor: t1 }] });
  await page.mouse.up(); await wait(300);
  await page.mouse.move(VW - 5, VH - 5);
  await ev(() => { S.sel = []; render(); });
  await shot('m04_replace_2', { clip: { c: [rBox.x, rBox.y, rBox.w, rBox.h] }, pad: 0, within: '#canvas-wrap' });

  // ---- 4.2 範囲選択 ----
  await open('flowchart');
  await ev(() => {
    addNode('rect', 180, 140, { text: 'タスクA' });
    addNode('rect', 380, 140, { text: 'タスクB' });
    addNode('rect', 280, 280, { text: 'タスクC' });
    addNode('rect', 560, 300, { text: 'タスクD' });
    S.sel = []; render(); markSaved();
  });
  const m0 = await d2c(80, 80), m1 = await d2c(470, 340);
  await drag(m0, m1, { hold: true }); await wait(200);
  await shot('m04_marquee', {
    clip: { d: [40, 50, 640, 340] }, pad: 0,
    anno: [{ cursor: m1 }, { badge: 1, at: [m0[0] - 4, m0[1] - 4] }],
  });
  await page.mouse.up(); await wait(200);
  await page.mouse.move(VW - 5, VH - 5);
  await shot('m04_marquee_2', { clip: { d: [40, 50, 640, 340] }, pad: 0 });

  // ---- 4.3 移動とガイド（スイムレーン）----
  await open('swimlane'); await lanes3();
  await ev(() => {
    const lx = (i) => laneX(S.lanes[i].id) + S.lanes[i].w / 2, h = headerSize();
    const a = addNode('rect', lx(0), h + 120, { text: '申請書を作成' });
    const b = addNode('rect', lx(1), h + 220, { text: '内容を確認' });
    addEdge(a.id, b.id);
    S.sel = []; render(); markSaved();
  });
  {
    const st = await pt({ node: '内容を確認', at: 'c' });
    const L = await ev(() => [laneX(S.lanes[1].id), S.lanes[1].w]);
    const g = await d2c(L[0] + L[1] * 0.25, 0);
    await page.mouse.move(st[0], st[1], { steps: 3 }); await page.mouse.down();
    await page.mouse.move(st[0] - 20, st[1] + 30, { steps: 5 });
    await page.mouse.move(g[0] + 3, st[1] + 79, { steps: 8 });
    await wait(250);
    await shot('m04_move_guide', {
      clip: { d: [L[0] - 30, 44, L[1] + 60, 330] }, pad: 0,
      anno: [{ cursor: [g[0] + 3, st[1] + 79] }],
    });
    await page.mouse.up(); await wait(200);
  }
  // ---- 4.4 リサイズ ----
  await open('flowchart');
  await ev(() => { const n = addNode('rect', 260, 200, { text: '内容を確認' }); S.sel = [n.id]; render(); markSaved(); });
  {
    const br = await pt({ node: '内容を確認', at: 'br' });
    await shot('m04_resize_1', {
      clip: { node: '内容を確認', pad: 60 }, pad: 6,
      anno: [{ box: { node: '内容を確認', pad: 7 }, dash: true, sw: 2, label: '8つのハンドル', labelSide: 'b' }, { cursor: [br[0] + 1, br[1] + 1] }],
    });
    const ob = await box({ node: '内容を確認' });
    await page.mouse.move(br[0], br[1], { steps: 3 }); await page.mouse.down();
    await page.mouse.move(br[0] + 50, br[1] + 30, { steps: 8 }); await wait(200);
    await shot('m04_resize_2', {
      clip: { node: '内容を確認', pad: 60 }, pad: 6,
      anno: [{ box: { c: [ob.x, ob.y, ob.w, ob.h] }, pad: 0, dash: true, sw: 2, rx: 4 }, { cursor: [br[0] + 50, br[1] + 30] }],
    });
    await page.mouse.up(); await wait(200);
  }
  await open('flowchart');
  await ev(() => {
    addNode('rect', 150, 120, { text: '短い' });
    addNode('rect', 400, 120, { text: '申請内容を確認し、不備があれば申請者へ差し戻す' });
    S.sel = []; render(); markSaved();
  });
  await shot('m04_autofit', { clip: [{ node: '短い', pad: 30 }, { node: '申請内容を確認し、不備があれば申請者へ差し戻す', pad: 30 }], pad: 6 });

  // ---- 4.5 文字の編集 ----
  await open('swimlane'); await lanes3();
  await ev(() => {
    const lx = (i) => laneX(S.lanes[i].id) + S.lanes[i].w / 2, h = headerSize();
    addNode('rect', lx(0), h + 100, { text: '申請書を作成' });
    const n = addNode('note', lx(1), h + 100, { text: '内容を確認' });
    n.note = '金額と添付書類を確かめる'; render(); markSaved();
  });
  const eb = await box({ node: '申請書を作成', pad: 40 });
  const eArea = { c: [eb.x, eb.y, eb.w + 40, eb.h] };
  await dblclick({ node: '申請書を作成' });
  await page.keyboard.press('End');
  await page.keyboard.type('する', { delay: 30 });
  await wait(250);
  await shot('m04_edit_1', { clip: eArea, pad: 0, within: '#canvas-wrap' });
  await page.keyboard.press('Enter'); await wait(200);
  await page.mouse.move(VW - 5, VH - 5);
  await ev(() => { S.sel = []; render(); });
  await shot('m04_edit_2', { clip: eArea, pad: 0, within: '#canvas-wrap' });
  // 説明有（名称欄と説明欄）
  {
    const nb = await box({ node: '内容を確認' });
    await shot('m04_note_areas', {
      clip: { node: '内容を確認', pad: 40 }, pad: 6, within: '#canvas-wrap',
      anno: [
        { box: { c: [nb.x + 3, nb.y + 3, nb.w - 6, 30] }, n: 1, at: 'l', out: true, pad: 0, sw: 2 },
        { box: { c: [nb.x + 3, nb.y + 35, nb.w - 6, nb.h - 38] }, n: 2, at: 'l', out: true, pad: 0, sw: 2 },
      ],
    });
    await dblclick([nb.x + nb.w / 2, nb.y + nb.h - 12]);
    await wait(250);
    await shot('m04_note_edit', { clip: { node: '内容を確認', pad: 40 }, pad: 6, within: '#canvas-wrap' });
    await page.keyboard.press('Escape');
  }

  // ---- 4.6 重ね置き（書類・データ・補足情報）----
  await open('swimlane'); await lanes3();
  await ev(() => {
    const L = (i) => laneX(S.lanes[i].id), W = (i) => S.lanes[i].w, h = headerSize();
    const a = addNode('rect', L(0) + W(0) / 2, h + 100, { text: '申請書を作成' });
    const b = addNode('rect', L(1) + W(1) / 2, h + 240, { text: '内容を確認' });
    addEdge(a.id, b.id);
    addNode('doc', L(0) + W(0) / 2 + 82, h + 150, { text: '申請書' });
    addNode('parallelogram', L(1) + 2, h + 300, { text: '経費データ' });
    addNode('supplement', L(2) + W(2) / 2, h + 120, { text: '5万円以上は部長決裁' });
    S.sel = []; render(); markSaved();
  });
  await page.mouse.move(VW - 5, VH - 5);
  await shot('m04_overlay', {
    clip: { d: [0, 0, 680, 380] }, pad: 0,
    anno: [
      { box: { node: '申請書' }, n: 1, at: 'tr', out: true, pad: 4 },
      { box: { node: '経費データ' }, n: 2, at: 'br', out: true, pad: 4 },
      { box: { node: '5万円以上は部長決裁' }, n: 3, at: 'tr', out: true, pad: 4 },
    ],
  });
  // 書類どうしの芯そろえ・等間隔
  await open('flowchart');
  await ev(() => {
    addNode('doc', 160, 160, { text: '申請書' });
    addNode('doc', 160 + 64, 160, { text: '領収書' });
    addNode('doc', 360, 196, { text: '見積書' });
    S.sel = []; render(); markSaved();
  });
  {
    const st = await pt({ node: '見積書', at: 'c' });
    const L = await pt({ node: '領収書', at: 'c' });
    await page.mouse.move(st[0], st[1], { steps: 3 }); await page.mouse.down();
    await page.mouse.move(st[0] - 30, st[1] - 10, { steps: 5 });
    await page.mouse.move(L[0] + 66, L[1] + 3, { steps: 8 });
    await wait(250);
    await shot('m04_overlay_snap', {
      clip: [{ node: '申請書', pad: 40 }, { node: '見積書', pad: 40 }], pad: 6,
      anno: [{ cursor: [L[0] + 66, L[1] + 3] }],
    });
    await page.mouse.up(); await wait(200);
  }
  // 書類を接続線の上へ（線に吸い付くとピンクの帯）
  await open('flowchart');
  await ev(() => {
    S.gridOn = false; updateGridBtn();
    const a = addNode('rect', 160, 180, { text: '見積を作成' });
    const b = addNode('rect', 560, 180, { text: '見積を送付' });
    addEdge(a.id, b.id);
    addNode('doc', 360, 300, { text: '見積書' });
    S.sel = []; render(); markSaved();
  });
  {
    const st = await pt({ node: '見積書', at: 'c' });
    const ly = await ev(() => { const a = S.nodes.find(n => n.text === '見積を作成'); return a.y + a.h / 2; });
    const tgt = await d2c(360, ly + 5);
    await page.mouse.move(st[0], st[1], { steps: 3 }); await page.mouse.down();
    await page.mouse.move(st[0] + 10, st[1] - 40, { steps: 5 });
    await page.mouse.move(tgt[0], tgt[1], { steps: 8 });
    await wait(250);
    const ok = await ev(() => { const d = S.nodes.find(n => n.text === '見積書'), a = S.nodes.find(n => n.text === '見積を作成'); return Math.abs(d.y + overlayCoreDY(d) - (a.y + a.h / 2)) < 0.5; });
    if (!ok) throw new Error('書類が接続線に吸い付いていません');
    await shot('m04_overlay_line', {
      clip: [{ node: '見積を作成', pad: 30 }, { node: '見積を送付', pad: 30 }, { node: '見積書', pad: 30 }], pad: 6,
      anno: [{ cursor: tgt }],
    });
    await page.mouse.up(); await wait(200);
  }

  // ---- 4.7 ハンドツール ----
  await open('swimlane'); await sampleApproval();
  await clickSel('#btn-hand');
  await click({ node: '内容を確認' });
  {
    const c = await pt({ node: '内容を確認', at: 'c' });
    const hp = [c[0] + 330, c[1] + 40];
    await page.mouse.move(hp[0], hp[1], { steps: 3 });
    await shot('m04_hand', {
      anno: [
        { box: '#btn-hand', n: 1, at: 'r', out: true, pad: 3 },
        { box: { node: '内容を確認' }, n: 2, at: 'tr', out: true, pad: 8 },
        { cursor: hp, kind: 'hand' },
        { badge: 3, at: [hp[0] + 40, hp[1] - 10] },
      ],
    });
  }

  // ---- 4.8 複数レーンプロセス ----
  await open('swimlane'); await lanes3();
  await click('#ps-crosslane');
  {
    const [x, y] = await lanePt(0, 200);
    const c = await d2c(x, y);
    await page.mouse.move(c[0], c[1], { steps: 4 }); await page.mouse.down(); await page.mouse.up(); await wait(300);
    await ev(() => clearPal());
    await page.mouse.move(VW - 5, VH - 5);
    const n = await ev(() => S.nodes.find(n => n.type === 'crosslane').text);
    await click({ node: n });
    await page.mouse.move(VW - 5, VH - 5); await wait(150);
    await shot('m04_cross', {
      clip: { d: [0, 0, 680, 330] }, pad: 0,
      anno: [
        { badge: 1, at: { node: n, at: 'r', dx: 30 } },
        { badge: 2, at: { node: n, at: 'b', dy: 24 } },
      ],
    });
  }
};

// ---------- 第3章 画面構成 ----------
sections.m03 = async () => {
  await open('swimlane');
  await sampleApproval();
  // 3.0 全体図
  await shot('m03_01_overview', {
    anno: [
      { box: '#app-title-bar', pad: -2 },
      { badge: 1, at: { sel: '#diagram-name', at: 'r', dx: 40 }, label: '見出しバー' },
      { box: '#toolbar-scroll', pad: -2 },
      { badge: 2, at: { sel: '#toolbar-scroll', at: 'b', dy: -16, dx: -560 }, label: 'メニューバー' },
      { box: '#tb-bottombar', pad: -1 },
      { badge: 3, at: { sel: '#tb-bottombar', at: 'r', dx: -330 }, label: '下段バー' },
      { box: '#sidebar', n: 4, label: 'サイドバー', at: 'tr', inset: true, labelSide: 'l', pad: -3 },
      { box: '#canvas-wrap', n: 5, label: 'キャンバス（作図する場所）', at: 'tr', inset: true, labelSide: 'l', pad: -4 },
      { box: '#hint', n: 6, label: 'ヒント帯', at: 'l', labelSide: 'l', pad: 3 },
    ],
  });
  // 3.1 見出しバー（幅 1600 のままだと文書で小さくなりすぎるので、狭い画面で撮る）
  await B.setSize(1000, 700); await wait(300);
  await ev(() => { document.getElementById('btn-show-toolbar').style.display = ''; });   // 表示ボタンの位置を示すため一時的に出す
  await shot('m03_02_titlebar', {
    clip: { c: [0, 0, 1000, 36] }, pad: 0,
    anno: [
      { box: { c: [0, 36, 1000, 48] }, pad: 0, sw: 0, fill: '#fff', rx: 0 },   // 下のメニューバーを白で隠し、番号を読みやすく
      { box: '#app-title-text', n: 1, at: 'b', out: true, pad: 1 },
      { box: '#dtype-label', n: 2, at: 'b', out: true, pad: 2 },
      { box: '#diagram-name', n: 3, at: 'b', out: true, pad: 2 },
      { box: '#titlebar-showbtns', n: 4, at: 'b', out: true, pad: 2 },
    ],
  });
  await ev(() => { document.getElementById('btn-show-toolbar').style.display = 'none'; });
  await B.setSize(VW, VH); await wait(300);
  // 3.2 メニューバー全体（ジャンル番号）。1 枚だと文書で小さくなるので前半（ファイル〜書式）と後半に分ける
  const groups = await ev(() => [...document.querySelectorAll('#toolbar-scroll > .rgroup')].map((g, i) => ({ i, vis: g.getBoundingClientRect().width > 0, name: g.querySelector('.glabel')?.textContent })));
  const visGroups = groups.filter(g => g.vis);
  const ribAnno = (ks) => ks.map(k => ({ box: { sel: '#toolbar-scroll > .rgroup', i: k }, n: k + 1, at: 'br', inset: true, r: 11, pad: -2, rx: 4, sw: 2 }));
  const half = 5;
  await shot('m03_03_ribbon_a', { clip: [...Array(half).keys()].map(k => ({ sel: '#toolbar-scroll > .rgroup', i: k })), pad: 3, anno: ribAnno([...Array(half).keys()]) });
  const rest = [...Array(visGroups.length - half).keys()].map(k => k + half);
  await shot('m03_03_ribbon_b', { clip: rest.map(k => ({ sel: '#toolbar-scroll > .rgroup', i: k })), pad: 3, anno: ribAnno(rest) });
  // ボタンの実物画像（本文・付録Bの早見表で使う）
  const btns = [
    ['save', '#toolbar .bigbtn.save'], ['saveas', { sel: '#toolbar .tbtn', text: '名前をつけて保存' }], ['import', { sel: '#toolbar .tbtn', text: 'インポート' }],
    ['text2d', { sel: '#toolbar .tbtn', text: 'テキスト作図' }], ['paste', '#btn-paste'], ['copy', { sel: '#toolbar .tbtn', text: 'コピー' }],
    ['delete', { sel: '#toolbar .tbtn.red', text: '削除' }], ['undo', { sel: '#toolbar .tbtn', text: '元に戻す' }], ['redo', { sel: '#toolbar .tbtn', text: 'やり直す' }],
    ['select', '#btn-select'], ['connect', '#btn-connect'], ['hand', '#btn-hand'], ['color', { sel: '#toolbar .tbtn', text: '色' , i: 0 }],
    ['fontsize', '#fontsize-tools'], ['align', { sel: '#toolbar .rrow', text: '文字揃え' }], ['group', '#btn-group'], ['ungroup', '#btn-ungroup'],
    ['dashed', '#btn-dashed'], ['orient', '#btn-orient'], ['arrange', '#btn-arrange'],
    ['zoom', { sel: '#toolbar .rrow', text: '全体' }], ['search', { sel: '#toolbar .tbtn', text: '検索' }], ['print', { sel: '#toolbar .bigbtn', text: '印刷' }],
    ['png', { sel: '#toolbar .tbtn', text: 'PNG' }],
    ['pdfscale', { sel: '#toolbar .rrow', text: '倍率' }], ['paper', { sel: '#toolbar .rrow', text: '用紙' }], ['fitpages', { sel: '#toolbar .rrow', text: 'ページ数' }],
    ['pagebreak', '#btn-pagebreak'],
    ['hidemenu', '#btn-hide-toolbar'],
  ];
  for (const [nm, t] of btns) await shot('btn_' + nm, { clip: t, pad: 2 });
  // メニューバーの横スクロール（狭い画面）
  await B.setSize(1150, 760); await wait(300);
  await ev(() => { try { updateTbArrows(); } catch (e) { } });
  await wait(150);
  await shot('m03_05_ribbon_scroll', {
    clip: '#toolbar', pad: 2,
    anno: [{ box: '#tb-scroll-right', n: 1, at: 'l', pad: 2, labelSide: 'l', label: 'あふれた側に出る › ‹' }],
  });
  await B.setSize(VW, VH); await wait(300);
  // 3.3 サイドバー（縦に長いので画面を高くして全体を収める）
  await B.setSize(VW, 1110); await wait(300);
  await shot('m03_06_sidebar', {
    clip: '#sidebar', pad: 0,
    anno: [
      { box: '#palette', n: 1, at: 'tr', inset: true, pad: 0 },
      { box: '#gap-row', n: 2, at: 'tr', inset: true, pad: 1 },
      { box: '#design-settings', n: 3, at: 'tr', inset: true, pad: 1 },
      { box: '#lane-list', n: 4, at: 'tr', inset: true, pad: 1 },
      { box: { sel: '#sidebar .pane-foot' }, n: 5, at: 'tr', inset: true, pad: 0 },
    ],
  });
  await B.setSize(VW, VH); await wait(300);
  // 3.4 メニューバー・サイドバーを隠す
  await clickSel('#btn-hide-toolbar');
  await shot('m03_08_menu_hidden', {
    clip: { c: [760, 0, 840, 150] }, pad: 0,
    anno: [{ box: '#btn-show-toolbar', n: 1, at: 'l', labelSide: 'l', label: '押すとメニューバーが戻る', pad: 3 }],
  });
  await clickSel('#btn-show-toolbar');
  await ev(() => toggleSidebar()); await wait(250);
  await shot('m03_09_sidebar_hidden', {
    anno: [{ box: '#btn-show-sidebar', n: 1, at: 'b', label: '押すとサイドバーが戻る', labelSide: 'l', pad: 3 }],
  });
  await ev(() => toggleSidebar()); await wait(250);
  // 3.5 ヒント帯（シェイプを選ぶと、次にできる操作が出る）
  await click({ node: '内容を確認' });
  await wait(200);
  await shot('m03_10_hint', {
    clip: [{ node: '内容を確認' }, '#hint'], pad: 18,
    anno: [{ box: '#hint', n: 1, at: 'l', pad: 3 }, { box: { node: '内容を確認' }, n: 2, at: 'tl', pad: 6 }],
  });
};

// ---------- 第5章 接続 ----------
sections.m05 = async () => {
  // ---- 5.1 接続モード ----
  await open('swimlane'); await lanes3();
  await ev(() => {
    const lx = (i) => laneX(S.lanes[i].id) + S.lanes[i].w / 2, h = headerSize();
    addNode('rect', lx(0), h + 100, { text: '申請書を作成' });
    addNode('rect', lx(1), h + 260, { text: '内容を確認' });
    S.sel = []; snap(); render(); markSaved();
  });
  const A = { node: '申請書を作成' }, Bn = { node: '内容を確認' };
  const area = [{ node: '申請書を作成', pad: 40 }, { node: '内容を確認', pad: 40 }];
  await clickSel('#btn-connect');
  await click({ ...A, at: 'c', dx: 30 });
  const cm = await pt({ ...Bn, at: 'l', dx: 14 });
  await page.mouse.move(cm[0], cm[1], { steps: 8 }); await wait(250);
  await shot('m05_conn_1', { clip: area, pad: 20, within: '#canvas-wrap', anno: [{ box: A, n: 1, at: 'tl', out: true, pad: 6 }, { cursor: cm }] });
  await click(cm);
  await clickSel('#btn-select');
  await page.mouse.move(5, VH - 5);
  await shot('m05_conn_2', { clip: area, pad: 20, within: '#canvas-wrap', anno: [{ box: Bn, n: 2, at: 'tr', out: true, pad: 6 }] });

  // ---- 5.2 ○＋から接続（クイック接続）----
  await ev(() => { S.edges = []; snap(); render(); markSaved(); });
  // 手順1: 辺に近づける → ○＋が出る（アイコンの上に乗せるとツールチップが出て隠れるので、辺の近くの少し横に置く）
  await move({ ...A, at: 'b', dy: 10, dx: -45 });
  await wait(250);
  await shot('m05_qc_1', {
    clip: area, pad: 20, within: '#canvas-wrap',
    anno: [{ cursor: { ...A, at: 'b', dy: 10, dx: -45 } }, { box: { sel: '.qc-icon[opacity="1"]' }, n: 1, at: 'r', out: true, pad: 3, rx: 12 }],
  });
  // 手順2: ○＋を押す → 線がカーソルに付いてくる。接続先の○＋はカーソルにいちばん近い辺に出るので、線が入る側
  //   （ここでは左辺）に寄せて置く＝手順3でつながる辺と○＋の位置をそろえる（右寄りに置くと逆側に出る）
  const tgt = { ...Bn, at: 'l', dx: 12 };
  await click({ sel: '.qc-icon[opacity="1"]' });
  await move(tgt);
  await wait(250);
  await shot('m05_qc_2', { clip: area, pad: 20, within: '#canvas-wrap', anno: [{ cursor: tgt }] });
  // 手順3: 相手をクリック → つながる
  await click(tgt);
  await page.mouse.move(5, VH - 5);
  await ev(() => { S.sel = []; render(); });
  await wait(250);
  await shot('m05_qc_3', { clip: area, pad: 20, within: '#canvas-wrap' });

  // ---- 5.3 接続先の辺を ○＋ で指定 ----
  await ev(() => { S.edges = []; snap(); render(); markSaved(); });
  await move({ ...A, at: 'b', dy: 10, dx: -45 }); await wait(200);
  await click({ sel: '.qc-icon[opacity="1"]' });
  await move({ ...Bn, at: 't', dy: 6, dx: -40 }); await wait(200);
  const tq = await pt({ sel: '.qc-icon[opacity="1"]', at: 'c' });
  await page.mouse.move(tq[0], tq[1], { steps: 4 }); await wait(250);
  await shot('m05_tgt_1', { clip: area, pad: 20, within: '#canvas-wrap', anno: [{ cursor: [tq[0] + 3, tq[1] + 3] }] });
  await page.mouse.down(); await page.mouse.up(); await wait(250);
  await page.mouse.move(5, VH - 5);
  await ev(() => { S.sel = []; render(); });
  await shot('m05_tgt_2', { clip: area, pad: 20, within: '#canvas-wrap' });

  // ---- 5.4 ブリッジ・5.5 ラベル ----
  await open('flowchart');
  await ev(() => {
    S.gridOn = false; updateGridBtn();
    const a = addNode('rect', 120, 220, { text: '受付' });
    const b = addNode('rect', 520, 220, { text: '発送' });
    const c = addNode('rect', 320, 80, { text: '在庫確認' });
    const d = addNode('rect', 320, 360, { text: '補充' });
    addEdge(a.id, b.id); addEdge(c.id, d.id);
    S.sel = []; render(); markSaved();
  });
  await page.mouse.move(5, VH - 5);
  const X = await pt({ dp: [320, 220] });
  await shot('m05_bridge', { clip: { d: [40, 30, 560, 380] }, pad: 0, anno: [{ box: { c: [X[0] - 18, X[1] - 18, 36, 30] }, n: 1, at: 'r', out: true, pad: 0, rx: 8 }] });
  // ---- ラベル: 線にマウスを乗せると○が出る（交差のない線で撮る）----
  await open('flowchart');
  await ev(() => {
    S.gridOn = false; updateGridBtn();
    const a = addNode('rect', 140, 160, { text: '在庫確認' });
    const b = addNode('rect', 520, 160, { text: '発送' });
    addEdge(a.id, b.id);
    S.sel = []; render(); markSaved();
  });
  const eid = await ev(() => S.edges[0].id);
  const mid = await ev((id) => { const g = _edgeLabelGeom[id]; return g ? [g.mx, g.my] : null; }, eid);   // let 宣言＝window には載らないが名前で読める
  if (!mid) throw new Error('ラベル位置が取れません');
  const lp = await d2c(mid[0], mid[1]);
  const lb = { d: [60, 100, 560, 120] };
  await page.mouse.move(lp[0] + 60, lp[1], { steps: 4 });
  await page.mouse.move(lp[0] + 2, lp[1] + 1, { steps: 4 }); await wait(250);
  await shot('m05_label_1', { clip: lb, pad: 0, anno: [{ cursor: [lp[0] + 3, lp[1] + 3] }] });
  await B.dbl(lp[0], lp[1]); await wait(250);
  await page.keyboard.type('在庫あり', { delay: 30 });
  await wait(200);
  await shot('m05_label_2', { clip: lb, pad: 0 });
  await page.keyboard.press('Enter'); await wait(200);
  await page.mouse.move(5, VH - 5);
  await ev(() => { S.sel = []; render(); });
  await shot('m05_label_3', { clip: lb, pad: 0 });
  {
    // ラベルを掴んで、いったん線から離し、線の近く（10px 以内）へ戻す＝線の上に吸い付いてピンクの帯が出る
    const p2 = [lp[0] - 70, lp[1] + 6];
    await page.mouse.move(lp[0], lp[1], { steps: 3 }); await page.mouse.down();
    await page.mouse.move(lp[0] - 30, lp[1] - 40, { steps: 5 });
    await page.mouse.move(p2[0], p2[1], { steps: 8 }); await wait(250);
    if (!(await ev(() => !!document.getElementById('label-snap-guide')))) throw new Error('ラベルの吸着の帯が出ていません');
    await shot('m05_label_snap', { clip: lb, pad: 0, anno: [{ cursor: [p2[0] + 2, p2[1] + 2] }] });
    await page.mouse.up(); await wait(200);
  }

  // ---- 5.6 経路の編集（区間の四角・端点のオレンジ丸）----
  await open('flowchart');
  await ev(() => {
    S.gridOn = false; updateGridBtn();
    const a = addNode('rect', 140, 110, { text: '受付' });
    const b = addNode('rect', 470, 300, { text: '発送' });
    addEdge(a.id, b.id);
    S.sel = [S.edges[0].id]; render(); markSaved();
  });
  await wait(200);
  const RA = { d: [40, 40, 520, 360] };
  await shot('m05_route_1', {
    clip: RA, pad: 0,
    anno: [
      { box: { sel: '#g-edges rect[fill="white"]', i: 0 }, n: 1, at: 'l', out: true, pad: 3 },
      { box: { sel: '.edge-end-handle', i: 1 }, n: 2, at: 't', out: true, pad: 3, rx: 10 },
    ],
  });
  {
    const sq = await pt({ sel: '#g-edges rect[fill="white"]', i: 1, at: 'c' });
    await page.mouse.move(sq[0], sq[1], { steps: 3 }); await page.mouse.down();
    await page.mouse.move(sq[0], sq[1] + 70, { steps: 8 }); await wait(200);
    await shot('m05_route_2', { clip: RA, pad: 0, anno: [{ cursor: [sq[0], sq[1] + 70] }, { arrow: [[sq[0] - 40, sq[1] - 4], [sq[0] - 40, sq[1] + 66]] }] });
    await page.mouse.up(); await wait(200);
  }

  // ---- 5.8 グループ枠 ----
  await open('swimlane'); await sampleApproval();
  await click('#ps-group_box');
  const g0 = await pt({ node: '内容を確認', at: 'tl', dx: -40, dy: -50 });
  const g1 = await pt({ node: '承認する?', at: 'br', dx: 30, dy: 30 });
  await page.mouse.move(g0[0], g0[1], { steps: 4 }); await page.mouse.down(); await page.mouse.up(); await wait(150);
  await page.mouse.move(g1[0], g1[1], { steps: 8 }); await wait(250);
  const gArea = { c: [g0[0] - 60, g0[1] - 40, g1[0] - g0[0] + 140, g1[1] - g0[1] + 90] };
  await shot('m05_grp_1', { clip: gArea, pad: 0, anno: [{ badge: 1, at: [g0[0] - 16, g0[1] - 16] }, { cursor: g1 }] });
  await page.mouse.down(); await page.mouse.up(); await wait(250);
  await ev(() => clearPal());
  await page.mouse.move(5, VH - 5);
  await ev(() => { const g = S.nodes.find(n => n.type === 'group_box'); g.text = '承認'; render(); markSaved(); });
  await shot('m05_grp_2', { clip: gArea, pad: 0 });
  // 選んだところ（切り欠きの○・⧉）
  await ev(() => { const g = S.nodes.find(n => n.type === 'group_box'); S.sel = [g.id]; render(); });
  await wait(200);
  await shot('m05_grp_sel', {
    clip: gArea, pad: 0,
    anno: [
      { badge: 1, at: { node: '承認', at: 'br', dx: 30, dy: 26 } },
      { badge: 2, at: { node: '承認', at: 'b', dx: 22, dy: 26 } },
      { box: { sel: '#g-nodes text', text: '⧉' }, n: 3, at: 't', out: true, pad: 4 },
    ],
  });
  // ドラッグで囲んで置く（押したまま対角へ）
  await open('swimlane'); await sampleApproval();
  await click('#ps-group_box');
  {
    const d0 = await pt({ node: '内容を確認', at: 'tl', dx: -40, dy: -50 });
    const d1 = await pt({ node: '承認する?', at: 'br', dx: 30, dy: 30 });
    await page.mouse.move(d0[0], d0[1], { steps: 4 }); await page.mouse.down();
    await page.mouse.move(d1[0], d1[1], { steps: 10 }); await wait(250);
    const dArea = { c: [d0[0] - 60, d0[1] - 40, d1[0] - d0[0] + 140, d1[1] - d0[1] + 90] };
    await shot('m05_grp_drag', { clip: dArea, pad: 0, anno: [{ badge: 1, at: [d0[0] - 16, d0[1] - 16] }, { cursor: d1 }] });
    await page.mouse.up(); await wait(250);
    const n = await ev(() => S.nodes.filter(n => n.type === 'group_box').length);
    if (n !== 1) throw new Error('ドラッグでグループ枠が置かれていません');
    await ev(() => clearPal());
  }
};

// グループ枠の切り欠き（L 型・凹・凸・階段）を別々の枠で撮る
sections.m05g = async () => {
  const mkGroup = async () => {
    await open('flowchart');
    await ev(() => {
      S.gridOn = false; updateGridBtn();
      const g = { id: uid(), type: 'group_box', x: 80, y: 80, w: 360, h: 220, text: 'グループ', lid: VIRTUAL_LANE.id };
      S.nodes.push(g); S.sel = [g.id]; snap(); render(); markSaved();
    });
    await wait(150);
  };
  const G = { d: [40, 40, 460, 300] };
  const handleAt = (x, y) => d2c(x, y);
  // L 型（右下の角の○を内側へ）
  await mkGroup();
  {
    const h0 = await handleAt(80 + 360 + 10, 80 + 220 + 10), h1 = await handleAt(80 + 360 - 120, 80 + 220 - 80);
    await shot('m05_cut_L1', { clip: G, pad: 0, anno: [{ box: { c: [h0[0] - 8, h0[1] - 8, 16, 16] }, pad: 0, rx: 8 }, { arrow: [[h0[0] - 8, h0[1] - 8], [h1[0] + 6, h1[1] + 6]] }, { cursor: h0 }] });
    await drag(h0, h1); await wait(200);
    await page.mouse.move(5, VH - 5);
    await shot('m05_cut_L2', { clip: G, pad: 0 });
  }
  // 凹（下の辺の中央の○を内側へ）
  await mkGroup();
  {
    const h0 = await handleAt(80 + 180, 80 + 220 + 10), h1 = await handleAt(80 + 180, 80 + 220 - 70);
    await drag(h0, h1); await wait(200);
    await page.mouse.move(5, VH - 5);
    await shot('m05_cut_notch', { clip: G, pad: 0 });
  }
  // 凸（右の辺の中央の○を外側へ）
  await mkGroup();
  {
    const h0 = await handleAt(80 + 360 + 10, 80 + 110), h1 = await handleAt(80 + 360 + 60, 80 + 110);
    await drag(h0, h1); await wait(200);
    await page.mouse.move(5, VH - 5);
    await shot('m05_cut_convex', { clip: { d: [40, 40, 520, 300] }, pad: 0 });
  }
  // 階段（L 型のあと、点線の○＋を内側へ）
  await mkGroup();
  {
    const h0 = await handleAt(80 + 360 + 10, 80 + 220 + 10), h1 = await handleAt(80 + 360 - 80, 80 + 220 - 60);
    await drag(h0, h1); await wait(200);
    // 段の外側の角に出る点線の○＋（右下の角の段の、縦の壁と上辺の交点＝右の辺上）
    const plus = await ev(() => {
      const els = [...document.querySelectorAll('#g-nodes circle[stroke-dasharray]')];
      return els.map(c => { const r = c.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    });
    if (!plus.length) throw new Error('点線の○＋が見つかりません');
    // いちばん右上の○＋（右の辺の上）を選ぶ
    plus.sort((a, b) => (b[0] - a[0]) || (a[1] - b[1]));
    const p0 = plus[0];
    await shot('m05_cut_step1', { clip: G, pad: 0, anno: [{ box: { c: [p0[0] - 8, p0[1] - 8, 16, 16] }, pad: 0, rx: 8 }, { cursor: p0 }] });
    await drag(p0, [p0[0] - 50, p0[1] + 30]); await wait(200);
    await page.mouse.move(5, VH - 5);
    await shot('m05_cut_step2', { clip: G, pad: 0 });
  }
};

// ---------- 第6章 編集を効率化する機能 ----------
sections.m06 = async () => {
  // ---- 6.1 コピー＆貼り付け ----
  await open('swimlane'); await lanes3();
  await ev(() => {
    const lx = (i) => laneX(S.lanes[i].id) + S.lanes[i].w / 2, h = headerSize();
    const a = addNode('rect', lx(0), h + 80, { text: '申請書を作成' });
    const b = addNode('rect', lx(0), h + 180, { text: '上長へ提出' });
    addEdge(a.id, b.id);
    S.sel = [a.id, b.id]; render(); markSaved();
  });
  await page.mouse.move(400, 500);
  await page.keyboard.down('Control'); await page.keyboard.press('c'); await page.keyboard.press('v'); await page.keyboard.up('Control');
  await wait(300);
  const pp = await lanePt(1, 200);
  const pc = await d2c(pp[0], pp[1]);
  await page.mouse.move(pc[0], pc[1], { steps: 8 }); await wait(300);
  await shot('m06_paste', { clip: { d: [0, 0, 680, 330] }, pad: 0, anno: [{ cursor: pc }] });
  await page.keyboard.press('Escape');

  // ---- 6.2 Ctrl+ドラッグで複製 ----
  await ev(() => { S.sel = []; render(); });
  {
    const st = await pt({ node: '上長へ提出', at: 'c' });
    const L = await lanePt(1, 180);
    const en = await d2c(L[0], L[1]);
    await page.mouse.move(st[0], st[1], { steps: 3 });
    await page.keyboard.down('Control');
    await page.mouse.down();
    await page.mouse.move(st[0] + 30, st[1] + 4, { steps: 4 });
    await page.mouse.move(en[0], en[1], { steps: 8 }); await wait(250);
    await shot('m06_ctrldrag', { clip: { d: [0, 0, 680, 260] }, pad: 0, anno: [{ cursor: en }, { text: 'Ctrl を押したまま', at: [en[0] + 24, en[1] + 30], side: 'r' }] });
    await page.mouse.up(); await page.keyboard.up('Control'); await wait(200);
  }

  // ---- 6.3 色 ----
  await open('flowchart');
  await ev(() => { S.gridOn = false; updateGridBtn(); const n = addNode('rect', 200, 120, { text: '内容を確認' }); S.sel = [n.id]; render(); markSaved(); });
  await click({ sel: '#toolbar .tbtn', text: '色', i: 0 });
  await wait(250);
  await shot('m06_color', { clip: ['#lane-choice', { sel: '#toolbar .tbtn', text: '色', i: 0 }], pad: 8, anno: [{ box: { sel: '#toolbar .tbtn', text: '色', i: 0 }, n: 1, at: 'r', out: true, pad: 2 }] });
  await page.keyboard.press('Escape'); await ev(() => document.getElementById('lane-choice')?.remove());

  // ---- 6.4 整列（レーンを保つ）----
  await open('swimlane'); await lanes3();
  await ev(() => {
    const L = (i) => laneX(S.lanes[i].id), W = (i) => S.lanes[i].w, h = headerSize();
    const a = addNode('terminal', L(0) + 70, h + 50, { text: '開始' });
    const b = addNode('rect', L(0) + 150, h + 150, { text: '申請書を作成' });
    const c = addNode('rect', L(1) + 70, h + 210, { text: '内容を確認' });
    const d = addNode('diamond', L(1) + 140, h + 350, { text: '承認する?' });
    const e2 = addNode('rect', L(2) + 160, h + 300, { text: '受付・登録' });
    const f = addNode('terminal', L(2) + 60, h + 470, { text: '終了' });
    [[a, b], [b, c], [c, d], [d, e2], [e2, f]].forEach(([x, y]) => addEdge(x.id, y.id));
    S.sel = []; snap(); render(); markSaved();
  });
  await page.mouse.move(5, VH - 5);
  const AR = { d: [0, 0, 680, 600] };
  await shot('m06_arrange_1', { clip: AR, pad: 0 });
  await clickSel('#btn-arrange'); await wait(300);
  await page.mouse.move(5, VH - 5);
  await shot('m06_arrange_2', { clip: AR, pad: 0 });

  // ---- 6.8 方眼 ----
  await open('flowchart');
  await ev(() => { addNode('rect', 200, 120, { text: '受付' }); addNode('diamond', 200, 240, { text: '在庫あり?' }); S.sel = []; render(); markSaved(); });
  await shot('btn_grid', { clip: '#btn-grid', pad: 2 });
  await page.mouse.move(5, VH - 5);
  await shot('m06_grid', { clip: { d: [60, 60, 300, 240] }, pad: 0 });

  // ---- 6.9 文字揃え ----
  await open('flowchart');
  await ev(() => {
    S.gridOn = false; updateGridBtn();
    const t = '内容を確認\n不備があれば差し戻す';
    const ns = [addNode('rect', 140, 120, { text: t }), addNode('rect', 380, 120, { text: t }), addNode('rect', 620, 120, { text: t })];
    ns.forEach(n => { n.x += (n.w - 200) / 2; n.w = 200; n.manualW = 200; });
    S.sel = []; render(); markSaved();
  });
  for (const [i, al] of [[0, 'left'], [1, 'center'], [2, 'right']]) {
    await ev(([i, al]) => { const n = S.nodes[i]; S.sel = [n.id]; render(); setTextAlign(al); S.sel = []; render(); }, [i, al]);
  }
  await page.mouse.move(5, VH - 5);
  await shot('m06_align', { clip: { d: [20, 60, 720, 120] }, pad: 0 });

  // ---- 6.10 検索・置換 ----
  await open('flowchart');
  await ev(() => {
    addNode('rect', 150, 130, { text: '申請書作成' });
    addNode('rect', 360, 130, { text: '申請内容確認' });
    addNode('rect', 260, 280, { text: '申請却下' });
    S.sel = []; render(); markSaved();
  });
  await page.keyboard.down('Control'); await page.keyboard.press('f'); await page.keyboard.up('Control');
  await wait(200);
  await page.keyboard.type('申請', { delay: 30 }); await wait(300);
  await shot('m06_search', {
    clip: '#search-panel', pad: 26,
    anno: [
      { box: '#search-input', n: 1, at: 'l', out: true, pad: 2 },
      { box: [{ sel: '#search-count' }, { sel: '#search-body .tbtn', i: 1 }], n: 2, at: 't', out: true, pad: 2 },
      { box: '#replace-input', n: 3, at: 'l', out: true, pad: 2 },
      { box: [{ sel: '#search-body .tbtn', i: 2 }, { sel: '#search-body .tbtn', i: 3 }], n: 4, at: 'b', out: true, pad: 2 },
      { box: '#search-close', n: 5, at: 'r', out: true, pad: 2 },
    ],
  });
  await page.keyboard.press('Escape');

  // ---- 6.11 デザイン・6.12 ステップ図 ----
  await open('swimlane'); await sampleApproval();
  await click({ sel: '#design-settings .sbtn', i: 0 }); await wait(300);
  await shot('m06_design_menu', { clip: ['#lane-choice', { sel: '#design-settings .sbtn', i: 0 }], pad: 8 });
  await ev(() => document.getElementById('lane-choice')?.remove());
  await page.mouse.move(5, VH - 5);
  const DZ = { d: [0, 44, 680, 520] };
  await shot('m06_design_std', { clip: DZ, pad: 0 });
  await ev(() => { S.style = 'pill'; render(); });
  await shot('m06_design_pill', { clip: DZ, pad: 0 });
  await open('flowchart');
  await ev(() => { S.gridOn = false; updateGridBtn(); render(); });
  await click({ sel: '#design-settings .sbtn', i: 1 }); await wait(300);
  await shot('m06_step_menu', { clip: ['#lane-choice', { sel: '#design-settings .sbtn', i: 1 }], pad: 8 });
  await click({ sel: '#lane-choice div', text: '矢羽' }); await wait(300);
  await page.mouse.move(5, VH - 5);
  await ev(() => { S.sel = []; render(); });
  const sb = await ev(() => { const ns = S.nodes; const x0 = Math.min(...ns.map(n => n.x)), y0 = Math.min(...ns.map(n => n.y)), x1 = Math.max(...ns.map(n => n.x + n.w)), y1 = Math.max(...ns.map(n => n.y + n.h)); return [x0, y0, x1 - x0, y1 - y0]; });
  await shot('m06_step_chevron', { clip: { d: [sb[0] - 30, sb[1] - 30, sb[2] + 100, sb[3] + 70] }, pad: 0 });

  // ---- 6.13 文字サイズ ----
  await open('flowchart');
  await ev(() => { S.gridOn = false; updateGridBtn(); const n = addNode('rect', 200, 120, { text: '内容を確認' }); S.sel = [n.id]; render(); markSaved(); });
  await shot('m06_fontsize_tools', {
    clip: '#fontsize-tools', pad: 30,
    anno: [
      { box: '#font-size-input', n: 1, at: 'b', out: true, pad: 2, r: 10 },
      { box: '#fontsize-tools .fsarrow', n: 2, at: 't', out: true, pad: 2, r: 10 },
      { box: { sel: '#fontsize-tools .fsstep', i: 0 }, n: 3, at: 'b', out: true, pad: 2, r: 10 },
      { box: { sel: '#fontsize-tools .fsstep', i: 1 }, n: 4, at: 't', out: true, pad: 2, r: 10 },
    ],
  });
  await open('flowchart');
  await ev(() => {
    S.gridOn = false; updateGridBtn();
    const a = addNode('note', 160, 120, { text: '内容を確認' }); a.note = '金額と添付書類を確かめる';
    const b = addNode('note', 420, 130, { text: '内容を確認' }); b.note = '金額と添付書類を確かめる';
    S.sel = [b.id]; render(); stepFontSize(1); stepFontSize(1); S.sel = []; render(); markSaved();
  });
  await page.mouse.move(5, VH - 5);
  await shot('m06_fontsize_note', { clip: { d: [40, 60, 520, 150] }, pad: 0 });

  // ---- 6.14 点線 ----
  await open('swimlane'); await lanes3();
  await ev(() => {
    const lx = (i) => laneX(S.lanes[i].id) + S.lanes[i].w / 2, h = headerSize();
    const a = addNode('rect', lx(0), h + 70, { text: '見積書を作成' });
    const b = addNode('rect', lx(1), h + 170, { text: '値引きを承認' });
    const c = addNode('rect', lx(0), h + 270, { text: '契約書を作成' });
    const e1 = addEdge(a.id, b.id), e2 = addEdge(b.id, c.id); addEdge(a.id, c.id);
    b.dashed = true; S.edges.find(x => x.id === e1).dashed = true; S.edges.find(x => x.id === e2).dashed = true;
    S.sel = []; render(); markSaved();
  });
  await page.mouse.move(5, VH - 5);
  await shot('m06_dashed', { clip: { d: [0, 44, 460, 320] }, pad: 0 });

  // ---- 6.15 スペース挿入・6.16 スペース調整 ----
  await open('swimlane'); await lanes3();
  await ev(() => {
    const lx = (i) => laneX(S.lanes[i].id) + S.lanes[i].w / 2, h = headerSize();
    const a = addNode('rect', lx(0), h + 60, { text: '申請書を作成' });
    const b = addNode('rect', lx(1), h + 160, { text: '内容を確認' });
    const c = addNode('rect', lx(2), h + 260, { text: '受付・登録' });
    addEdge(a.id, b.id); addEdge(b.id, c.id);
    S.sel = []; snap(); render(); markSaved();
  });
  const GZ = { d: [0, 0, 680, 470] };
  await click('#btn-gap-main');
  const gy = await ev(() => { const a = S.nodes.find(n => n.text === '内容を確認'); return a.y - 24; });
  const gp = await d2c(560, gy);
  await page.mouse.move(gp[0], gp[1], { steps: 6 }); await wait(250);
  await shot('m06_gapins_1', { clip: GZ, pad: 0, noAnnoInClip: true, anno: [{ cursor: gp }] });
  await page.mouse.down();
  await page.mouse.move(gp[0], gp[1] + 60, { steps: 8 }); await wait(250);
  await shot('m06_gapins_2', { clip: GZ, pad: 0, anno: [{ cursor: [gp[0], gp[1] + 60] }] });
  await page.mouse.up(); await wait(250);
  await page.keyboard.press('Escape');
  await page.mouse.move(5, VH - 5);
  await shot('m06_gapins_3', { clip: GZ, pad: 0 });
  // 調整: 広げた間を既定の間隔へ戻す
  await click('#btn-gap-adjust');
  const ay = await ev(() => { const a = S.nodes.find(n => n.text === '申請書を作成'), b = S.nodes.find(n => n.text === '内容を確認'); return (a.y + a.h + b.y) / 2; });
  const ap = await d2c(560, ay);
  await page.mouse.move(ap[0], ap[1], { steps: 6 }); await wait(250);
  await shot('m06_gapadj_1', { clip: GZ, pad: 0, anno: [{ cursor: ap }] });
  await page.mouse.down(); await page.mouse.up(); await wait(250);
  await page.keyboard.press('Escape');
  await page.mouse.move(5, VH - 5);
  await shot('m06_gapadj_2', { clip: GZ, pad: 0 });
  await shot('btn_gaprow', { clip: '#gap-row', pad: 3 });
};

// ---------- 第7章 レーン・第8章 縦横・第9章 図種の切替 ----------
sections.m07 = async () => {
  await open('swimlane'); await sampleApproval();
  // 7.1 追加
  await clickSel('#add-lane-btn'); await wait(250);   // サイドバーの下＝画面外のことがあるので要素クリック（自動でスクロール）
  await ev(() => { S.lanes[3].name = '経理部'; render(); lanePanel(); markSaved(); });
  await page.mouse.move(5, VH - 5);
  await B.setSize(VW, 1110); await wait(300);
  await shot('m07_lanes', {
    clip: [{ sel: '#lane-list' }, { sel: '#add-lane-btn' }], pad: 8,
    anno: [
      { box: { sel: '#lane-list .lhandle', i: 0 }, n: 1, at: 'b', out: true, pad: 1, r: 10 },
      { box: { sel: '#lane-list .lane-color-dot', i: 0 }, n: 2, at: 't', out: true, pad: 2, r: 10 },
      { box: { sel: '#lane-list .lname', i: 0 }, n: 3, at: 't', out: true, pad: 1, r: 10 },
      { box: { sel: '#lane-list .ldel', i: 1 }, n: 4, at: 'r', out: true, pad: 1, r: 10 },
      { box: { sel: '#lane-list .lw', i: 0 }, n: 5, at: 'l', out: true, pad: 1, r: 10 },
      { box: '#add-lane-btn', n: 6, at: 'r', out: true, pad: 2, r: 10 },
    ],
  });
  await B.setSize(VW, VH); await wait(300);
  // 7.2 キャンバスの見出しをダブルクリックで改名
  const hd = await pt({ sel: '#gstick-lane text', text: '上長', at: 'c' }).catch(() => null);
  if (!hd) throw new Error('レーン見出しが見つかりません');
  await B.dbl(hd[0], hd[1]); await wait(300);
  await page.keyboard.press('End'); await page.keyboard.type('（課長）', { delay: 30 }); await wait(200);
  {
    const lx = await ev(() => laneX(S.lanes[1].id));
    await shot('m07_rename', { clip: { d: [lx - 20, 0, 260, 64] }, pad: 0 });
  }
  await page.keyboard.press('Enter'); await wait(200);
  // 7.5 境界のドラッグで幅を変える
  const bx = await ev(() => laneX(S.lanes[1].id) + S.lanes[1].w);
  const b0 = await d2c(bx, 200), b1 = await d2c(bx + 60, 200);
  await page.mouse.move(b0[0], b0[1], { steps: 3 }); await page.mouse.down();
  await page.mouse.move(b1[0], b1[1], { steps: 8 }); await wait(250);
  await shot('m07_width_drag', { clip: { d: [200, 0, 520, 330] }, pad: 0, anno: [{ cursor: b1 }, { arrow: [[b0[0], b0[1] + 50], [b1[0], b1[1] + 50]] }] });
  await page.mouse.up(); await wait(200);
  // 7.6 色
  await click({ sel: '#lane-list .lane-color-dot', i: 1 }); await wait(250);
  await shot('m07_color', { clip: ['#lane-choice', { sel: '#lane-list .lr', i: 1 }], pad: 8 });
  await ev(() => document.getElementById('lane-choice')?.remove());
  // 7.3 レーンの削除＝後ろのレーンのシェイプが削除したレーンの幅だけ寄る
  await open('swimlane'); await lanes3(['申請者', '確認', '総務部']);
  await ev(() => {
    const lx = (i) => laneX(S.lanes[i].id) + S.lanes[i].w / 2, h = headerSize();
    const a = addNode('rect', lx(0), h + 80, { text: '申請書を作成' });
    addNode('rect', lx(1), h + 80, { text: '書式を確認' });
    const c = addNode('rect', lx(2), h + 180, { text: '受付・登録' });
    const d = addNode('rect', lx(2), h + 280, { text: '台帳に記録' });
    addEdge(a.id, c.id); addEdge(c.id, d.id);
    S.sel = []; snap(); render(); lanePanel(); markSaved();
  });
  await page.mouse.move(5, VH - 5);
  const DL = { d: [0, 0, 680, 400] };
  await shot('m07_delete_1', { clip: DL, pad: 0 });
  await ev(() => { document.querySelectorAll('#lane-list .ldel')[1].id = '__mnl_ldel'; });
  await clickSel('#__mnl_ldel'); await wait(300);   // 「確認」のレーンの ✕（サイドバーの下＝画面外のことがあるので要素クリック）
  await page.mouse.move(5, VH - 5);
  if ((await ev(() => S.lanes.length)) !== 2) throw new Error('レーンが削除されていません');
  await shot('m07_delete_2', { clip: DL, pad: 0 });
};

sections.m08 = async () => {
  await open('swimlane'); await sampleApproval();
  await page.mouse.move(5, VH - 5);
  await shot('m08_vertical', { clip: { d: [0, 0, 680, 600] }, pad: 0 });
  await clickSel('#btn-orient'); await wait(400);
  await page.mouse.move(5, VH - 5);
  const hb = await ev(() => { const ns = S.nodes; return [Math.max(...ns.map(n => n.x + n.w)) + 40, Math.max(...ns.map(n => n.y + n.h)) + 30]; });
  await shot('m08_horizontal', { clip: { d: [0, 0, hb[0], hb[1]] }, pad: 0, within: '#canvas-wrap' });
};

sections.m09 = async () => {
  await open('swimlane'); await sampleApproval();
  await click('#dtype-label'); await wait(300);
  await shot('m09_menu', { clip: ['#dtype-menu', '#dtype-label'], pad: 10, anno: [{ box: '#dtype-label', n: 1, at: 'l', out: true, pad: 2 }, { box: '#dtype-menu', n: 2, at: 'r', out: true, pad: 2 }] });
  await page.keyboard.press('Escape');
};

// ---------- 第10章 各図種（スイムレーン・フローチャートのシェイプ）----------
sections.m10s = async () => {
  // シェイプの実物画像（フローチャートに並べて 1 つずつ切り抜く）
  await open('flowchart');
  const types = ['rect', 'note', 'sys_input', 'sys_input_desc', 'diamond', 'diamond_desc', 'terminal', 'parallelogram', 'doc', 'supplement', 'crosslane', 'crosslane_sys_input'];
  await ev((types) => {
    S.gridOn = false; updateGridBtn();
    // 間を広く取る（複数レーン系は横に長いので 1 行に 1 つ）
    types.forEach((t, i) => { if (t.startsWith('crosslane')) addNode(t, 300, 560 + (t === 'crosslane' ? 0 : 110)); else addNode(t, 140 + (i % 4) * 300, 110 + Math.floor(i / 4) * 170); });
    const g = { id: uid(), type: 'group_box', x: 40, y: 800, w: 200, h: 110, text: 'グループ', lid: VIRTUAL_LANE.id };
    S.nodes.push(g);
    S.sel = []; render(); markSaved();
  }, types);
  await page.mouse.move(5, VH - 5);
  const ids = await ev(() => S.nodes.map(n => [n.type, n.id]));
  for (const [t, id] of ids) {
    const b = await ev((id) => { const n = S.nodes.find(x => x.id === id); return [n.x, n.y, n.w, n.h]; }, id);
    await page.evaluate((b) => { const w = document.getElementById('canvas-wrap'); w.scrollTop = Math.max(0, b[1] - 200); }, b);
    await shot('shape_' + t, { clip: { d: b }, pad: 8 });
  }
  // スイムレーンの複数レーンプロセス（2 レーンにまたがる）
  await open('swimlane'); await lanes3();
  for (const t of ['crosslane', 'crosslane_sys_input']) {
    await ev((t) => { S.nodes = []; S.edges = []; render(); }, t);
    await click('#ps-' + t);
    const [x, y] = await lanePt(0, 100);
    const c = await d2c(x, y);
    await page.mouse.move(c[0], c[1], { steps: 3 }); await page.mouse.down(); await page.mouse.up(); await wait(250);
    await ev(() => clearPal());
    await page.mouse.move(5, VH - 5);
    const nb = await ev((t) => { const n = S.nodes.find(x => x.type === t); return [n.x, n.y, n.w, n.h]; }, t);
    await shot('shape_lane_' + t, { clip: { d: [0, nb[1] - 24, 460, nb[3] + 48] }, pad: 0 });
  }
  // フローチャートの作例
  await open('flowchart');
  await ev(() => {
    const a = addNode('terminal', 300, 60, { text: '開始' });
    const b = addNode('parallelogram', 300, 150, { text: '注文を受け付ける' });
    const c = addNode('diamond', 300, 260, { text: '在庫あり?' });
    const d = addNode('rect', 520, 260, { text: '仕入先へ発注' });
    const e2 = addNode('rect', 300, 380, { text: '出荷' });
    const f = addNode('terminal', 300, 470, { text: '終了' });
    addEdge(a.id, b.id); addEdge(b.id, c.id);
    const y = addEdge(c.id, e2.id), n = addEdge(c.id, d.id);
    addEdge(d.id, e2.id); addEdge(e2.id, f.id);
    S.edges.find(x => x.id === y).label = 'はい'; S.edges.find(x => x.id === n).label = 'いいえ';
    S.sel = []; render(); markSaved();
  });
  await page.mouse.move(5, VH - 5);
  await shot('m10_flowchart', { clip: { d: [140, 20, 520, 490] }, pad: 0 });
};

// ---------- 第10章 樹状図 ----------
sections.m10o = async () => {
  await open('orgchart');
  await ev(() => {
    const set = (n, role, name) => { n.sections = [{ text: role, style: 'header' }, { style: 'table', cols: 1, rows: [[name]] }]; n.text = ''; };
    placeShape('org_node', 360, 90); placeShape('org_node', 160, 260); placeShape('org_node', 360, 260); placeShape('org_node', 560, 260);
    const [ceo, a, b, c] = S.nodes;
    set(ceo, '代表取締役', '山田 太郎'); set(a, '営業部長', '佐藤 花子'); set(b, '開発部長', '鈴木 一郎'); set(c, '管理部長', '田中 美咲');
    addEdge(ceo.id, a.id); addEdge(ceo.id, b.id); addEdge(ceo.id, c.id);
    autoLayout(); S.sel = []; render(); markSaved();
  });
  await page.mouse.move(5, VH - 5);
  const ob = await ev(() => { const ns = S.nodes; const x0 = Math.min(...ns.map(n => n.x)), y0 = Math.min(...ns.map(n => n.y)), x1 = Math.max(...ns.map(n => n.x + n.w)), y1 = Math.max(...ns.map(n => n.y + n.h)); return [x0 - 40, y0 - 30, x1 - x0 + 80, y1 - y0 + 90]; });
  await shot('m10_org', { clip: { d: ob }, pad: 0, within: '#canvas-wrap' });   // 左端が図の座標で負になる＝サイドバーを写さない
  // 選んだところ（＋部下追加など）
  await click({ node: '開発部長' }); await wait(250);
  await page.mouse.move(5, VH - 5);
  await shot('m10_org_sel', {
    clip: { d: ob }, pad: 0, within: '#canvas-wrap',
    anno: [
      { box: { sel: '#g-dividers g.ui-only', i: 0 }, n: 1, at: 'b', out: true, pad: 2, rx: 12, r: 11 },
      { box: { sel: '#g-dividers g.ui-only', i: 1 }, n: 2, at: 'b', out: true, pad: 2, rx: 12, r: 11 },
    ],
  });
  // 編集ダイアログ
  await dblclick({ node: '開発部長' }); await wait(400);
  await shot('m10_org_edit', { clip: '#org-modal-box', pad: 10 }).catch(async () => { await shot('m10_org_edit', { clip: '#org-modal', pad: 0 }); });
  await page.keyboard.press('Escape');
};

// ---------- 第10章 ガントチャート ----------
async function ganttSample(opts = {}) {
  await ev((o) => {
    S.nodes = []; S.edges = [];
    const g = S.gantt;
    g.startDate = '2026-05-01'; g.endDate = o.end || '2026-05-29'; g.scale = 'day'; g.colWidth = 26;
    g.header.show = !!o.header; g.legend.show = !!o.header;
    if (o.header) {
      g.header.title = '○○ビル新築工事';
      g.header.rows = [{ label: '工事場所', value: '東京都千代田区○○' }, { label: '発注者', value: '株式会社○○' }, { label: '工期', value: '2026/05/01〜2026/08/31' }, { label: '担当', value: '山田 太郎' }];
      g.header.showDate = true;
      g.header.approval = { show: true, slots: [{ role: '承認', name: '部長' }, { role: '確認', name: '課長' }, { role: '作成', name: '山田' }] };
      g.legend = { show: true, auto: true, overrides: {}, extra: [] };
      const nm = document.getElementById('diagram-name'); nm.value = '○○ビル新築工事'; onDiagramNameInput(nm.value);
    }
    const add = (x) => { const n = Object.assign({ id: uid(), progress: 0, desc: '', assignee: '' }, x); S.nodes.push(n); return n; };
    const p1 = add({ type: 'gantt_summary', row: 0, text: '基礎工事', color: '#0e7490' });
    const t1 = add({ type: 'gantt_task', row: 1, text: '掘削', desc: '根切り・山留め', assignee: '佐藤', startDate: '2026-05-04', endDate: '2026-05-09', progress: 100, phaseId: p1.id });
    const t2 = add({ type: 'gantt_task', row: 2, text: '配筋', desc: '基礎の鉄筋', assignee: '鈴木', startDate: '2026-05-11', endDate: '2026-05-16', progress: 60, phaseId: p1.id });
    const m1 = add({ type: 'gantt_milestone', row: 3, text: '基礎検査', date: '2026-05-16', phaseId: p1.id });
    const p2 = add({ type: 'gantt_summary', row: 4, text: '躯体工事', color: '#1e3a8a' });
    const t3 = add({ type: 'gantt_task', row: 5, text: '型枠', assignee: '田中', startDate: '2026-05-18', endDate: '2026-05-23', progress: 0, phaseId: p2.id });
    const t4 = add({ type: 'gantt_task', row: 6, text: 'コンクリート打設', assignee: '田中', startDate: '2026-05-25', endDate: '2026-05-28', progress: 0, phaseId: p2.id });
    ganttSyncPhaseTaskColors(p1); ganttSyncPhaseTaskColors(p2);
    addEdge(t1.id, t2.id, { depType: 'FS' }); addEdge(t3.id, t4.id, { depType: 'FS' });
    S.sel = []; render(); markSaved();
  }, opts);
  await wait(250);
}
sections.m10g = async () => {
  await open('gantt');
  await ganttSample();
  await page.mouse.move(5, VH - 5);
  await shot('m10_gantt', {
    anno: [
      { box: '#gantt-tools', n: 1, at: 'b', out: true, pad: -1 },
      { box: '#gantt-settings', n: 2, at: 'tr', inset: true, pad: -2 },
      { box: '#gantt-list-sec', n: 3, at: 'tr', inset: true, pad: -2 },
    ],
  });
  // バーを選んだところ（ハンドル）
  await click({ node: '配筋' }); await wait(250);
  await page.mouse.move(5, VH - 5);
  {
    const b = await box({ node: '配筋' });
    await shot('m10_gantt_bar', {
      clip: { c: [b.x - 120, b.y - 50, b.w + 240, b.h + 100] }, pad: 0,
      anno: [
        { badge: 1, at: [b.x + b.w / 2, b.y - 16] },
        { badge: 2, at: [b.x - 16, b.y + b.h / 2] },
        { badge: 3, at: [b.x + b.w * 0.6 + 4, b.y + b.h + 18] },
      ],
    });
  }
  // 詳細編集（ダブルクリック）
  await dblclick({ node: '配筋' }); await wait(400);
  await shot('m10_gantt_modal', { clip: '#gantt-modal-box', pad: 8 });
  await page.keyboard.press('Escape'); await ev(() => { try { closeGanttModal(); } catch (e) { } });
  // 依存関係の種類
  await ev(() => { S.sel = []; render(); });
  // 見出し欄（表題部・承認欄・凡例）: 全幅を収めるため画面を広げる
  await B.setSize(2000, 950); await wait(300);
  await ganttSample({ header: true });
  await page.mouse.move(5, 940);
  const right = await ev(() => { const r = document.getElementById('diagram-svg').getBoundingClientRect(); return Math.min(r.right, 1990); });
  await shot('m10_gantt_header', { clip: { c: [220, 140, right - 220, 600] }, pad: 0, within: '#canvas-wrap' });
  await B.setSize(VW, VH); await wait(300);
  await shot('m10_gantt_headpanel', { clip: ['#gantt-head-ph', '#gantt-head-body'], pad: 4 });
  await ev(() => openGanttHeadEditor()); await wait(400);
  await shot('m10_gantt_headmodal', { clip: '#gantt-head-modal .ghm-box', pad: 6 });
  await ev(() => closeGanttHeadEditor());
  // 見出しを畳む
  await ev(() => { ganttToggleHead(); }); await wait(300);
  await page.mouse.move(5, VH - 5);
  const cw = await box('#canvas-wrap');
  await shot('m10_gantt_collapsed', { clip: [{ c: [cw.x, cw.y, 700, 200] }, '#btn-gh-show'], pad: 8, within: '#canvas-wrap', anno: [{ box: '#btn-gh-show', n: 1, at: 'b', out: true, pad: 3 }] });
  // 休日のグレーアウト
  await ganttSample();
  await page.mouse.move(5, VH - 5);
  await shot('m10_gantt_holiday', { clip: { c: [cw.x, cw.y, 1000, 360] }, pad: 0 });
  // 折り返し（週ごと）
  await ev(() => { ganttSetWrap('week'); hint(''); }); await wait(400);   // 直前の「見出しを畳みました」の案内が図に重ならないように消す
  await page.mouse.move(5, VH - 5);
  await shot('m10_gantt_wrap', { clip: '#diagram-svg', pad: 0, within: '#canvas-wrap' });   // 段の幅＝図の幅で切る（右の空白を入れない）
  await ev(() => { ganttSetWrap('off'); });
  // 時（1 時間ごと）
  await ev(() => {
    S.nodes = []; S.edges = [];
    const g = S.gantt; g.startDate = '2026-05-11'; g.endDate = '2026-05-12'; g.colWidth = 26; g.header.show = false; g.legend.show = false;
    ganttSetScale('hour');
    const add = (o) => { S.nodes.push(Object.assign({ id: uid(), progress: 0, desc: '', assignee: '' }, o)); };
    add({ type: 'gantt_task', row: 0, text: '搬入', assignee: '佐藤', startDate: '2026-05-11T08:00', endDate: '2026-05-11T10:00', progress: 100 });
    add({ type: 'gantt_task', row: 1, text: '据付', assignee: '鈴木', startDate: '2026-05-11T10:00', endDate: '2026-05-11T15:00', progress: 60 });
    add({ type: 'gantt_task', row: 2, text: '試運転', assignee: '田中', startDate: '2026-05-11T15:00', endDate: '2026-05-11T18:00', progress: 0 });
    S.sel = []; render(); markSaved();
  });
  await wait(300);
  await page.mouse.move(5, VH - 5);
  await shot('m10_gantt_hour', { clip: { c: [cw.x, cw.y, 1060, 250] }, pad: 0 });
  // 工程表ツールのボタン実物
  await ev(() => { ganttSetScale('day'); });
  await shot('btn_gantt_dates', { clip: { sel: '#gantt-tools .rrow', i: 0 }, pad: 2 });
  await shot('btn_gantt_wrap', { clip: { sel: '#gantt-tools .rrow', i: 1 }, pad: 2 });
  await shot('btn_excel_on', { clip: '#btn-excel', pad: 2 });
};

// ---------- 第10章 マインドマップ ----------
sections.m10m = async () => {
  await open('mindmap');
  await ev(() => {
    const root = S.nodes.find(n => n.type === 'mind_root'); root.text = '受付業務の見直し';
    const addT = (pid, text, type, attrs) => {
      const d = SD[type];
      const n = Object.assign({ id: uid(), type, text, x: 0, y: 0, w: d.w, h: d.h }, attrs || {});
      S.nodes.push(n);
      S.edges.push({ id: uid(), from: pid, to: n.id, label: '', fromLabel: '', toLabel: '', fromLid: null, toLid: null });
      return n.id;
    };
    const a = addT(root.id, '受付に時間がかかる', 'mind_topic', { status: 'open', importance: 'high' });
    addT(a, '受付票を電子化する', 'mind_action', { status: 'agreed', effort: 'mid' });
    addT(a, '繁忙期は窓口が2倍', 'mind_note', {});
    const b = addT(root.id, '記入漏れが多い', 'mind_topic', { status: 'objection', importance: 'mid' });
    addT(b, '必須欄に色を付ける', 'mind_action', { status: 'agreed', confidence: 'high' });
    const c = addT(root.id, '案内が分かりにくい', 'mind_topic', {});
    addT(c, '案内板を作り直す', 'mind_action', {});
    mindLayout(); S.sel = []; render(); markSaved();
  });
  await wait(300);
  await ev(() => { fitView(); });   // 放射状は上下に広がるので、全体が入る倍率にする
  await wait(300);
  await page.mouse.move(5, VH - 5);
  await shot('m10_mind', {
    anno: [
      { box: '#mind-tools', n: 1, at: 'b', out: true, pad: -1 },
      { box: '#mind-settings', n: 2, at: 'tr', inset: true, pad: -2 },
      { box: '#right-sidebar', n: 3, at: 'tl', inset: true, pad: -2 },
    ],
  });
  const mb = await ev(() => { const ns = S.nodes; const x0 = Math.min(...ns.map(n => n.x)), y0 = Math.min(...ns.map(n => n.y)), x1 = Math.max(...ns.map(n => n.x + n.w)), y1 = Math.max(...ns.map(n => n.y + n.h)); return [x0 - 30, y0 - 30, x1 - x0 + 60, y1 - y0 + 60]; });
  await shot('m10_mind_map', { clip: { d: mb }, pad: 0, within: '#canvas-wrap' });
  await ev(() => { zoomLevel = 1; applyZoom(); });
  await shot('m10_mind_tools', { clip: '#mind-tools', pad: 3 });
  // 凡例（編集領域の左上）
  await page.evaluate(() => { const w = document.getElementById('canvas-wrap'); w.scrollLeft = 0; w.scrollTop = 0; });
  await wait(200);
  {
    const r = await box('#canvas-wrap');
    await shot('m10_mind_legend', { clip: { c: [r.x, r.y, 340, 200] }, pad: 0 });
  }
  // サイドパネル（属性）
  await ev(() => { S.sel = [S.nodes.find(n => n.status === 'open').id]; render(); });
  await B.setSize(VW, 1300); await wait(300);
  await shot('m10_mind_panel', { clip: '#mind-settings', pad: 4 });
  await B.setSize(VW, VH); await wait(300);
  // リザーブ
  await ev(() => {
    S.mindReserve = [
      { id: uid(), text: '窓口の待ち時間を計測したい', type: 'mind_topic' },
      { id: uid(), text: '整理券機を試験導入する', type: 'mind_action' },
      { id: uid(), text: '他市の事例を調べる', type: 'mind_note' },
    ];
    renderMindReserve(); markSaved();
  });
  await wait(200);
  {
    const rs = await box('#right-sidebar');
    await shot('m10_mind_reserve', { clip: { c: [rs.x, rs.y, rs.w, 300] }, pad: 0 });
  }
  // ツリー配置
  await ev(() => { mindSetLayout('tree'); S.sel = []; render(); });
  await wait(300);
  const tb = await ev(() => { const ns = S.nodes; const x0 = Math.min(...ns.map(n => n.x)), y0 = Math.min(...ns.map(n => n.y)), x1 = Math.max(...ns.map(n => n.x + n.w)), y1 = Math.max(...ns.map(n => n.y + n.h)); return [x0 - 30, y0 - 30, x1 - x0 + 60, y1 - y0 + 60]; });
  await page.evaluate((b) => { const w = document.getElementById('canvas-wrap'); w.scrollLeft = Math.max(0, b[0] - 40); w.scrollTop = Math.max(0, b[1] - 40); }, tb);
  await wait(200);
  await shot('m10_mind_tree', { clip: { d: tb }, pad: 0, within: '#canvas-wrap' });
  await shot('btn_mindtext_on', { clip: '#btn-mindtext', pad: 2 });
};

// ---------- 第11章 保存とエクスポート ----------
sections.m11 = async () => {
  // 11.1 上書き保存の流れ（このアプリのフローチャートで作図）
  await open('flowchart');
  await ev(() => {
    S.gridOn = false; updateGridBtn();
    const st = addNode('terminal', 300, 60, { text: 'Ctrl+S（上書き保存）' });
    const d1 = addNode('diamond', 300, 190, { text: '上書き先が\n決まっている?' });
    const a1 = addNode('rect', 640, 190, { text: '上書き先のファイルに\n書き込む' });
    const a3 = addNode('rect', 300, 330, { text: '保存先を選ぶ画面を出す\n（名前の候補＝図の名称）' });
    const a4 = addNode('rect', 300, 450, { text: '選んだファイルに書き込み\n以後の上書き先にする' });
    const en = addNode('terminal', 640, 450, { text: '保存完了' });
    const E = (f, t, l) => { const id = addEdge(f.id, t.id); if (l) S.edges.find(x => x.id === id).label = l; };
    E(st, d1); E(d1, a1, 'はい'); E(d1, a3, 'いいえ'); E(a1, en); E(a3, a4); E(a4, en);
    S.sel = []; render(); markSaved();
  });
  await page.mouse.move(5, VH - 5);
  {
    const b = await ev(() => { const ns = S.nodes; const x0 = Math.min(...ns.map(n => n.x)), y0 = Math.min(...ns.map(n => n.y)), x1 = Math.max(...ns.map(n => n.x + n.w)), y1 = Math.max(...ns.map(n => n.y + n.h)); return [x0 - 24, y0 - 20, x1 - x0 + 48, y1 - y0 + 40]; });
    await shot('m11_save_flow', { clip: { d: b }, pad: 0 });
  }
  // 保存したファイルを開いた直後の「上書き先」のダイアログ（2 通り）
  await open('swimlane'); await sampleApproval();
  for (const [name, known] of [['m11_bind_known', true], ['m11_bind_pick', false]]) {
    const shown = await ev(async (known) => {
      if (!FSA_OK) return false;
      const orig = fhLoad;
      window.fhLoad = async () => (known ? { name: '経費精算の承認フロー.html' } : null);
      fileHandle = null; fileHandleTried = false;
      try { await askBindSaveTarget(); } finally { window.fhLoad = orig; }
      return document.getElementById('bind-modal').style.display === 'flex';
    }, known);
    if (!shown) throw new Error('上書き先のダイアログが出ません');
    await wait(200);
    await shot(name, { clip: '#bind-box', pad: 8 });
    await ev(() => hideBind());
  }
  // 11.5 出力のジャンル
  await open('swimlane'); await sampleApproval();
  const outG = { sel: '#toolbar-scroll > .rgroup', text: '出力' };
  await shot('m11_output', {
    clip: outG, pad: 26,
    anno: [
      { box: { sel: '#toolbar .bigbtn', text: '印刷' }, n: 1, at: 'b', out: true, pad: 1, r: 11 },
      { box: { sel: '#toolbar .tbtn', text: 'PNG' }, n: 2, at: 't', out: true, pad: 1, r: 11 },
      { box: { sel: '#toolbar .rrow', text: '倍率' }, n: 3, at: 't', out: true, pad: 1, r: 11 },
      { box: { sel: '#toolbar .rrow', text: '用紙' }, n: 4, at: 'r', out: true, pad: 1, r: 11 },
      { box: [{ sel: '#print-fit-tall' }, { sel: '#print-fit-wide' }], n: 5, at: 'b', out: true, pad: 2, r: 11 },
      { box: '#btn-pagebreak', n: 6, at: 'b', out: true, pad: 1, r: 11 },
    ],
  });
  // 改ページ位置の表示（ページ数 縦 2）
  await ev(() => {
    // 図を縦に伸ばして 2 ページ分の長さにする
    const h = headerSize(), lx = (i) => laneX(S.lanes[i].id) + S.lanes[i].w / 2;
    const end = S.nodes.find(n => n.text === '終了');
    const steps = [[2, '経理へ回付'], [1, '支払いを承認'], [2, '振込を予約'], [2, '振込を実行'], [0, '入金を確認'], [0, '精算書を保管'], [2, '帳簿に記帳']];
    let prev = S.nodes.find(n => n.text === '受付・登録');
    S.edges = S.edges.filter(e => e.to !== end.id);
    S.nodes = S.nodes.filter(n => n !== end);
    steps.forEach(([li, t], i) => { const n = addNode('rect', lx(li), h + 620 + i * 130, { text: t }); addEdge(prev.id, n.id); prev = n; });
    const fin = addNode('terminal', lx(2), h + 620 + steps.length * 130, { text: '完了' }); addEdge(prev.id, fin.id);
    S.sel = []; render(); markSaved();
  });
  await click('#print-fit-tall'); await page.keyboard.type('2'); await wait(200);
  await click('#print-fit-wide'); await page.keyboard.type('1'); await wait(300);   // 縦 2 × 横 1（横を空けると、縦 2 ページに合わせて拡大し横にも分かれる）
  await clickSel('#btn-pagebreak'); await wait(400);
  const pb = await ev(() => { const l = document.querySelector('#g-pagebreak line'); if (!l) return null; return [+l.getAttribute('y1')]; });
  if (!pb) throw new Error('改ページ位置の線がありません');
  await page.evaluate((y) => { const w = document.getElementById('canvas-wrap'); w.scrollTop = Math.max(0, y - 330); }, pb[0]);
  await wait(300);
  await page.mouse.move(5, VH - 5);
  {
    const c = await d2c(0, pb[0]);
    await shot('m11_pagebreak', { clip: { c: [c[0], c[1] - 200, 700, 330] }, pad: 0, within: '#canvas-wrap', anno: [{ badge: 1, at: [c[0] + 640, c[1] - 16] }] });
  }
  await shot('m11_fit_readout', { clip: { sel: '#toolbar .rrow', text: '倍率' }, pad: 4, anno: [{ box: '#pdf-scale-eff', pad: 2, sw: 2 }] });
  // 書き出し（凡例つき）の見た目
  await open('swimlane'); await sampleApproval();
  await ev(() => {
    const lx = (i) => laneX(S.lanes[i].id) + S.lanes[i].w / 2, h = headerSize();
    addNode('doc', lx(0) + 80, h + 175, { text: '申請書' });
    addNode('supplement', lx(1), h + 420, { text: '5万円以上は部長' });
    render(); markSaved();
    const r = buildExportSvg();
    const host = document.createElement('div'); host.id = '__mnl_exp';
    host.style.cssText = 'position:fixed;left:0;top:0;background:#fff;z-index:2147483646;padding:0';
    r.svg.style.display = 'block';
    host.appendChild(r.svg); document.body.appendChild(host);
  });
  await wait(300);
  {
    const eb = await box('#__mnl_exp svg');
    await shot('m11_export_legend', { clip: { c: [eb.x, eb.y, eb.w, Math.min(eb.h, 760)] }, pad: 0 });
  }
  await ev(() => document.getElementById('__mnl_exp')?.remove());

  // 11.2 名前をつけて保存（アプリのダイアログ）
  await open('swimlane'); await sampleApproval();
  await click({ sel: '#toolbar .tbtn', text: '名前をつけて保存' }); await wait(300);
  await shot('m11_saveas', { clip: '#save-modal-box', pad: 8 });
  await ev(() => closeSaveDialog());
  // 11.6 未保存の確認（4 択）
  await open('flowchart');
  await ev(() => { addNode('rect', 200, 160, { text: '未保存の変更' }); S.sel = []; render(); });
  await ev(() => selectDiagramType('mindmap')); await wait(400);
  await shot('m11_save4', { clip: '#save4-box', pad: 8 });
  await ev(() => { const m = document.getElementById('save4-modal'); if (m) m.style.display = 'none'; markSaved(); });
  // 11.7 保存結果の表示
  await open('flowchart');
  await ev(() => { toast('上書き保存しました', '', '経費精算の承認フロー.html', 60000); });
  await wait(400);
  await shot('m11_toast_ok', { clip: '#toast', pad: 10 });
  await ev(() => { toast('上書き保存に失敗しました', 'ng', 'ファイルが他のアプリで開かれているため書き込めません', 60000); });
  await wait(400);
  await shot('m11_toast_ng', { clip: '#toast', pad: 10 });
  await ev(() => toastHide());
};

// ---------- 第12章 テキストから作図 ----------
sections.m12 = async () => {
  await open('flowchart');
  await ev(() => openText2Diagram()); await wait(300);
  const sel12 = '#t2d-modal > div:nth-child(2)';
  await shot('m12_t2d_1', {
    clip: sel12, pad: 24,
    anno: [
      { box: '#t2d-format', n: 1, at: 'b', out: true, pad: 2 },
      { box: { sel: '#t2d-modal .tbtn', text: '例を挿入' }, n: 2, at: 't', out: true, pad: 2 },
      { box: '#t2d-input', n: 3, at: 'l', out: true, pad: 2 },
      { box: '#t2d-modal .btn-primary', n: 4, at: 'b', out: true, pad: 2 },
    ],
  });
  await ev(() => {
    const ta = document.getElementById('t2d-input');
    ta.value = 'flowchart TD\n  A[受付] --> B{在庫あり?}\n  B -->|はい| C[出荷]\n  B -->|いいえ| D[発注]\n  D --> C';
    ta.dispatchEvent(new Event('input'));
  });
  await wait(200);
  await shot('m12_t2d_2', { clip: sel12, pad: 4 });
  await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
  await wait(600);
  await ev(() => { try { closeText2Diagram(); } catch (e) { } });
  await clean();
  await page.mouse.move(5, VH - 5);
  const b = await ev(() => { const ns = S.nodes; if (!ns.length) return null; const x0 = Math.min(...ns.map(n => n.x)), y0 = Math.min(...ns.map(n => n.y)), x1 = Math.max(...ns.map(n => n.x + n.w)), y1 = Math.max(...ns.map(n => n.y + n.h)); return [x0 - 30, y0 - 30, x1 - x0 + 60, y1 - y0 + 60]; });
  if (!b) throw new Error('テキスト作図の結果がありません');
  await shot('m12_t2d_3', { clip: { d: b }, pad: 0, within: '#canvas-wrap' });
};

// ---------- 付録 B（ほかの図種のシェイプの実物）----------
sections.mB = async () => {
  await open('orgchart');
  await ev(() => {
    placeShape('org_node', 160, 120); placeShape('org_node_plain', 420, 120);
    const g = { id: uid(), type: 'org_group', x: 620, y: 70, w: 200, h: 110, text: 'グループ', lid: VIRTUAL_LANE.id };
    S.nodes.push(g); S.sel = []; render(); markSaved();
  });
  await page.mouse.move(5, VH - 5);
  // 「ノード」（org_node_plain）は置くと 1 段だけの org_node になる＝並び順で引く
  for (const [t, i] of [['org_node', 0], ['org_node_plain', 1], ['org_group', 2]]) {
    const bb = await ev((i) => { const n = S.nodes[i]; return [n.x, n.y, n.w, n.h]; }, i);
    await shot('shape_' + t, { clip: { d: bb }, pad: 8 });
  }
  await open('gantt');
  await ganttSample();
  await page.mouse.move(5, VH - 5);
  // ガントのシェイプは時間軸の上に描かれる＝パレットの見本（絵と名前）を切り抜く
  for (const t of ['gantt_task', 'gantt_milestone', 'gantt_summary']) await shot('shape_' + t, { clip: '#ps-' + t, pad: 2 });
  await open('mindmap');
  await ev(() => {
    const root = S.nodes.find(n => n.type === 'mind_root'); root.text = 'テーマ';
    ['mind_topic', 'mind_action', 'mind_note'].forEach((t, i) => {
      const d = SD[t];
      const n = { id: uid(), type: t, text: ['問題', '対策', '補足情報'][i], x: 0, y: 0, w: d.w, h: d.h };
      S.nodes.push(n); S.edges.push({ id: uid(), from: root.id, to: n.id, label: '', fromLabel: '', toLabel: '', fromLid: null, toLid: null });
    });
    mindLayout(); S.sel = []; render(); markSaved();
  });
  await wait(300);
  for (const [t, nm] of [['mind_topic', '問題'], ['mind_action', '対策'], ['mind_note', '補足情報']]) {
    const bb = await ev((nm) => { const n = S.nodes.find(x => x.text === nm); return [n.x, n.y, n.w, n.h]; }, nm);
    await page.evaluate((b) => { const w = document.getElementById('canvas-wrap'); w.scrollLeft = Math.max(0, b[0] - 300); w.scrollTop = Math.max(0, b[1] - 300); }, bb);
    await wait(150);
    await shot('shape_' + t, { clip: { d: bb }, pad: 10 });
  }
};

// ============================================================
//  実行
// ============================================================
(async () => {
  B = await launch();
  page = B.page;
  page.on('dialog', d => d.accept().catch(() => { }));
  page.on('pageerror', e => console.log('  [pageerror] ' + e.message));
  const only = process.argv.slice(2);
  const names = Object.keys(sections).filter(k => !only.length || only.includes(k));
  console.log('browser: ' + B.kind + ' / sections: ' + names.join(' '));
  let failed = false;
  for (const k of names) {
    console.log('[' + k + ']');
    try { await sections[k](); } catch (e) { failed = true; console.error('  ✗ ' + k + ': ' + e.message); }
  }
  const mf = path.join(outDir, '_manifest.json');
  let prev = {};   // 章を絞って撮ったときだけ既存の一覧に足す（全部撮ったときは作り直す＝消えた画像を一覧に残さない）
  if (only.length) { try { prev = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { } }
  fs.writeFileSync(mf, JSON.stringify(Object.assign(prev, manifest), null, 1));
  await B.browser.close();
  if (failed) { console.error('一部の撮影に失敗しました'); process.exit(1); }
  console.log('All screenshots captured successfully.');
})();
