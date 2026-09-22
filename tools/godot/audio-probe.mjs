// Does the browser build actually make a sound?
//
//   node tools/godot/audio-probe.mjs [URL] [SECONDS]
//
// Serve a bundle first, e.g.
//   npx http-server -p 8099 build/pages   # with the page shim
//   npx http-server -p 8098 build/web     # the raw export, no shim
//
// Two "no sound" reports were answered with guesses -- stale caching, then the
// frame rate -- and both were wrong. This makes the audio graph observable
// instead: every AudioContext the page creates, every state it lands in, every
// worklet module it loads and every buffer source it starts.
//
// Everything is reported through console.log rather than polled with
// page.evaluate. Godot saturates the JS main thread on a software WebGL2
// rasteriser, so an evaluate simply never returns, while console messages
// queue and flush when the loop yields each frame. Chromium is launched
// WITHOUT --autoplay-policy=no-user-gesture-required on purpose: that flag
// starts the context running and hides the entire behaviour being measured.

import { createRequire } from 'node:module';
import fs from 'node:fs';

// Playwright may be installed globally rather than in the repository, and the
// browser may be pinned outside its own cache by PLAYWRIGHT_BROWSERS_PATH.
// Both are looked up rather than assumed so this runs on a plain checkout.
const require = createRequire(import.meta.url);
let chromium;
for (const spec of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try {
    const mod = await import(require.resolve(spec));
    // Playwright is CommonJS, so depending on how it is reached its exports
    // land either as named exports or only under `default`.
    chromium = mod.chromium || (mod.default && mod.default.chromium);
    if (chromium) break;
  } catch (e) { /* try the next location */ }
}
if (!chromium) {
  console.error('playwright is not installed; npm i -g playwright');
  process.exit(2);
}

function findChrome() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '';
  if (!root || !fs.existsSync(root)) return undefined;
  const dir = fs.readdirSync(root).find(d => d.startsWith('chromium-'));
  if (!dir) return undefined;
  const exe = `${root}/${dir}/chrome-linux/chrome`;
  return fs.existsSync(exe) ? exe : undefined;
}

const URL = process.argv[2] || 'http://127.0.0.1:8099/index.html';
const SECONDS = Number(process.argv[3] || 120);
const SHOT = process.argv[4] || '/tmp/audiotest.png';

const probe = `
(function () {
  var log = function (m) { try { console.log('PROBE ' + m); } catch (e) {} };
  var NativeCtx = window.AudioContext || window.webkitAudioContext;
  if (!NativeCtx) { log('no AudioContext at all'); return; }
  var starts = 0, lastReport = 0;
  var RealStart = (window.AudioBufferSourceNode || {}).prototype
    ? window.AudioBufferSourceNode.prototype.start : null;
  if (RealStart) {
    window.AudioBufferSourceNode.prototype.start = function () {
      starts++;
      if (starts <= 5 || starts % 10 === 0) log('buffer-source start #' + starts);
      return RealStart.apply(this, arguments);
    };
  } else {
    log('AudioBufferSourceNode not patchable');
  }
  function install(ctx) {
    log('AudioContext created, state=' + ctx.state + ' rate=' + ctx.sampleRate);
    ctx.addEventListener('statechange', function () {
      log('AudioContext state -> ' + ctx.state);
    });
    var realAdd = ctx.audioWorklet && ctx.audioWorklet.addModule
      ? ctx.audioWorklet.addModule.bind(ctx.audioWorklet) : null;
    if (realAdd) {
      ctx.audioWorklet.addModule = function (u) {
        log('addModule ' + u);
        return realAdd(u).then(
          function (r) { log('addModule ok ' + u); return r; },
          function (e) { log('addModule FAILED ' + u + ': ' + e); throw e; });
      };
    } else {
      log('no audioWorklet on this context');
    }
    var realConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dest) {
      if (dest === ctx.destination) log('node connected to destination: ' + this.constructor.name);
      return realConnect.apply(this, arguments);
    };
  }
  function Patched() {
    var ctx = new NativeCtx(arguments[0]);
    install(ctx);
    return ctx;
  }
  Patched.prototype = NativeCtx.prototype;
  window.AudioContext = Patched;
  window.webkitAudioContext = Patched;
  window.__probe = function () { return starts; };
})();
`;

const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
await page.addInitScript(probe);
page.on('console', m => console.log(`[${Math.round(process.uptime())}s]`, m.text().slice(0, 240)));
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 240)));
page.on('requestfailed', r => console.log('[reqfail]', r.url().slice(0, 120), r.failure()?.errorText));

page.goto(URL, { waitUntil: 'commit', timeout: 60000 }).catch(e => console.log('[goto]', String(e).slice(0, 160)));

// Clicks and a held trigger, driven from the CDP side so a busy main thread
// does not stall the harness.
const t0 = Date.now();
let down = false;
while ((Date.now() - t0) / 1000 < SECONDS) {
  const t = (Date.now() - t0) / 1000;
  try {
    if (t > 12 && t < 16) await page.mouse.click(400, 225, { timeout: 4000 });
    if (t > 20 && !down) { await page.mouse.down({ timeout: 4000 }); down = true; console.log('[harness] trigger down'); }
  } catch (e) { /* main thread busy; try again */ }
  await new Promise(r => setTimeout(r, 2000));
}
console.log('DONE');
await browser.close();
