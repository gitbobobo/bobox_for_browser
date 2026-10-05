// Live check of the x.com autoplay blocker against real x.com (logged-out).
// Rebuild first: pnpm build (or use `pnpm verify:x` which builds).
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT_DIR = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'chrome-mv3'));
const POST_URL = process.env.X_VERIFY_URL || 'https://x.com/NASA/status/2091994900094959986';
// X GIFs are direct mp4s (tweet_video), a different code path from HLS.
const GIF_URL = process.env.X_VERIFY_GIF_URL || 'https://x.com/GIPHY/status/1214012216137125890';

// Chromium derives the id of an unpacked extension from sha256 of its path:
// first 32 hex chars, each mapped 0-f -> a-p.
function unpackedExtensionId(dir) {
  const hex = createHash('sha256').update(dir).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(250);
  }
}

const failures = [];
const results = [];
function check(name, ok, detail = '') {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

let context;
let userDataDir;
// Always headed: x.com serves an error response to HeadlessChrome.
async function launch() {
  userDataDir = mkdtempSync(join(tmpdir(), 'bobox-verify-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });
  return context;
}

async function disableCache(page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  // X unloads/pauses videos in inactive tabs. Keep the fixture active even
  // when the popup is rendered in another tab or Edge is being inspected.
  // A real action popup also leaves its underlying page visible.
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
}

function trackVideoRequests(page, bucket) {
  page.on('requestfinished', async (req) => {
    const url = req.url();
    if (!url.includes('video.twimg.com')) return;
    let size = 0;
    try {
      const sizes = await req.sizes();
      size = sizes.responseBodySize || 0;
    } catch {}
    bucket.push({ url, size });
  });
}
const m4s = (b) => b.filter((r) => r.url.includes('.m4s'));
const kb = (b) => Math.round(b.reduce((s, r) => s + r.size, 0) / 1024);

async function videoState(page) {
  return page.evaluate(() => {
    const v = document.querySelector('video');
    if (!v) return null;
    return { src: v.getAttribute('src'), paused: v.paused, time: v.currentTime };
  });
}

async function waitBlockedPost(page, secs, url = POST_URL) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await until(() => page.evaluate(() => !!document.querySelector('video')), 30000, 'a <video> element');
  await sleep(secs * 1000);
}

async function main() {
  let extId = unpackedExtensionId(EXT_DIR);
  await launch();
  let popupOk = false;
  try {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extId}/popup.html`, { timeout: 8000 });
    await p.waitForSelector('[role="switch"]', { timeout: 5000 });
    popupOk = true;
    await p.close();
  } catch {}
  if (!popupOk) {
    // Maybe the computed id is wrong; read it from the profile Preferences.
    try {
      const prefs = JSON.parse(readFileSync(join(userDataDir, 'Default', 'Preferences'), 'utf8'));
      const ids = Object.keys(prefs?.extensions?.settings ?? {}).filter((k) => k.length === 32);
      if (ids.length === 1) {
        extId = ids[0];
        const p = await context.newPage();
        await p.goto(`chrome-extension://${extId}/popup.html`, { timeout: 8000 });
        await p.waitForSelector('[role="switch"]', { timeout: 5000 });
        popupOk = true;
        await p.close();
      }
    } catch {}
  }
  if (!popupOk) throw new Error('extension popup is not reachable; is dist/chrome-mv3 built?');
  console.log(`extension id: ${extId}`);

  // --- Scenario 1: enabled (default) — video must not load until clicked ---
  console.log('\n[1] enabled: block until click');
  {
    const page = await context.newPage();
    await disableCache(page);
    const req = [];
    trackVideoRequests(page, req);
    await waitBlockedPost(page, 15);
    const st = await videoState(page);
    check('video element exists', !!st);
    check('video src attribute is empty', st && st.src === null, `src=${st?.src}`);
    check('video paused', st && st.paused === true);
    check('click-to-play overlay visible', await page.getByTestId('bobox-play-video').first().isVisible());
    check('<=4 .m4s requests', m4s(req).length <= 4, `${m4s(req).length} requests`);
    check('<512 KB downloaded', kb(req) < 512, `${kb(req)} KB`);
    results.push(['enabled: blocked', m4s(req).length, kb(req)]);

    const before = req.length;
    await page.getByTestId('bobox-play-video').first().click();
    await until(
      async () => (await videoState(page))?.src?.startsWith('blob:'),
      10000,
      'video src to become blob: after click',
    );
    check('click attaches blob: src', true);
    check('click removes overlay', await page.getByTestId('bobox-play-video').count() === 0);
    await until(() => m4s(req.slice(before)).length >= 3, 10000, '>=3 new .m4s after click');
    check('segments download after click', true, `${m4s(req.slice(before)).length} new .m4s`);
    const canPlay = await page.evaluate(() =>
      window.MediaSource?.isTypeSupported('video/mp4; codecs="avc1.64001f"'),
    );
    if (canPlay) {
      await until(
        async () => {
          const s = await videoState(page);
          return s && !s.paused && s.time > 1;
        },
        15000,
        'playback past 1s',
      );
      check('video plays after click', true);
    } else {
      console.log('  INFO codecs unsupported here; playback not checked');
    }
    results.push(['enabled: after click', m4s(req).length, kb(req)]);
    await page.close();
  }

  // --- Scenario 1b: GIF post still blocked (direct mp4, not HLS) ---
  console.log('\n[1b] enabled: GIF (tweet_video mp4) blocked until click');
  {
    const page = await context.newPage();
    await disableCache(page);
    const req = [];
    trackVideoRequests(page, req);
    const gifReq = () => req.filter((r) => r.url.includes('tweet_video/'));
    await waitBlockedPost(page, 8, GIF_URL);
    const st = await videoState(page);
    check('gif video element exists', !!st);
    check('gif src attribute is empty', st && st.src === null, `src=${st?.src}`);
    check('zero tweet_video requests', gifReq().length === 0, `${gifReq().length} requests`);

    check('gif click-to-play overlay visible', await page.getByTestId('bobox-play-video').first().isVisible());
    await page.getByTestId('bobox-play-video').first().click();
    await until(
      async () => (await videoState(page))?.src?.includes('.mp4'),
      10000,
      'gif src to become the mp4 after click',
    );
    check('click attaches mp4 src', true);
    await until(() => gifReq().length >= 1, 10000, 'tweet_video request after click');
    check('gif mp4 downloads after click', true, `${gifReq().length} requests`);
    const canPlay = await page.evaluate(() =>
      document.createElement('video').canPlayType('video/mp4; codecs="avc1.64001f"') !== '',
    );
    if (canPlay) {
      await until(
        async () => (await videoState(page))?.paused === false,
        15000,
        'gif playing',
      );
      check('gif plays after click', true);
    } else {
      console.log('  INFO codecs unsupported here; playback not checked');
    }
    results.push(['gif: blocked->click', gifReq().length, kb(gifReq())]);
    await page.close();
  }

  // --- Scenario 2: live toggle off via the popup ---
  console.log('\n[2] toggle off while post is open');
  {
    const page = await context.newPage();
    await disableCache(page);
    const req = [];
    trackVideoRequests(page, req);
    await waitBlockedPost(page, 3);
    // A video element alone does not mean hls.js has assigned its source yet.
    await page.getByTestId('bobox-play-video').first().waitFor({ state: 'visible', timeout: 30000 });
    const st = await videoState(page);
    check('fresh post still blocked', st && st.src === null, `src=${st?.src}`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    const sw = popup.locator('[role="switch"]').first();
    await sw.waitFor({ timeout: 8000 });
    await until(async () => (await sw.getAttribute('aria-checked')) === 'true', 5000, 'switch on');
    check('switch starts on', true);
    await sw.click();
    await until(async () => (await sw.getAttribute('aria-checked')) === 'false', 5000, 'switch off');
    check('switch flips off', true);

    await until(
      async () => (await videoState(page))?.src?.startsWith('blob:'),
      5000,
      'video src to become blob: after toggle off',
    );
    const before = req.length;
    await until(() => m4s(req.slice(before)).length >= 1, 10000, 'segments after toggle off');
    check('toggle off flushes src and loads', true, `${m4s(req.slice(before)).length} new .m4s`);
    check('toggle off removes overlay', await page.getByTestId('bobox-play-video').count() === 0);
    results.push(['toggled off live', m4s(req).length, kb(req)]);
    await popup.close();
    await page.close();
  }

  // --- Scenario 3: disabled — X behaves normally again ---
  console.log('\n[3] disabled: X default behaviour restored');
  {
    const page = await context.newPage();
    await disableCache(page);
    const req = [];
    trackVideoRequests(page, req);
    await waitBlockedPost(page, 0);
    await until(
      async () => (await videoState(page))?.src?.startsWith('blob:'),
      30000,
      'default player to attach its video source',
    );
    // X adapts the bitrate to network conditions; wait for the original
    // traffic thresholds rather than assuming 15 seconds always exceeds 2 MB.
    await until(
      () => m4s(req).length >= 10 && kb(req) > 2048,
      45000,
      'default autoplay to download >=10 segments and >2 MB',
    );
    check('>=10 .m4s requests', m4s(req).length >= 10, `${m4s(req).length} requests`);
    check('>2 MB downloaded', kb(req) > 2048, `${kb(req)} KB`);
    const canPlay = await page.evaluate(() =>
      window.MediaSource?.isTypeSupported('video/mp4; codecs="avc1.64001f"'),
    );
    if (canPlay) {
      const st = await videoState(page);
      check('plays without click', st && st.paused === false, `paused=${st?.paused}`);
    } else {
      console.log('  INFO codecs unsupported here; playback not checked');
    }
    results.push(['disabled', m4s(req).length, kb(req)]);
    await page.close();
  }
}

try {
  await main();
} catch (e) {
  failures.push(`fatal: ${e.message}`);
} finally {
  if (context) await context.close().catch(() => {});
  if (userDataDir && existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true });
}

console.log('\nscenario                .m4s req    KB');
for (const [name, n, k] of results) {
  console.log(`${name.padEnd(22)} ${String(n).padStart(8)} ${String(k).padStart(7)}`);
}
if (failures.length) {
  console.error(`\nFAILED:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('\nall checks passed');
