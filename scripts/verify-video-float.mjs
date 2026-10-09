// Live check of the video-float tool against bilibili.com (Document PiP path).
// Rebuild first: pnpm build (or use `pnpm verify:float` which builds).
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT_DIR = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'chrome-mv3'));
const VIDEO_URL =
  process.env.FLOAT_VERIFY_URL || 'https://www.bilibili.com/video/BV1taHC6dENS/';
const SWITCH_NAME = '视频悬浮窗';
const BUTTON = '[data-testid="bobox-video-float"]';
const PLACEHOLDER = '[data-bobox-pip-placeholder]';

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
function check(name, ok, detail = '') {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

let context;
let userDataDir;
// Headed: doc-PiP requestWindow needs a real window manager behind it.
async function launch() {
  userDataDir = mkdtempSync(join(tmpdir(), 'bobox-float-verify-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });
  return context;
}

async function findExtensionId() {
  let extId = unpackedExtensionId(EXT_DIR);
  try {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extId}/popup.html`, { timeout: 8000 });
    await p.waitForSelector('[role="switch"]', { timeout: 5000 });
    await p.close();
    return extId;
  } catch {}
  // Maybe the computed id is wrong; read it from the profile Preferences.
  const prefs = JSON.parse(readFileSync(join(userDataDir, 'Default', 'Preferences'), 'utf8'));
  const ids = Object.keys(prefs?.extensions?.settings ?? {}).filter((k) => k.length === 32);
  if (ids.length !== 1) throw new Error('cannot determine extension id');
  extId = ids[0];
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extId}/popup.html`, { timeout: 8000 });
  await p.waitForSelector('[role="switch"]', { timeout: 5000 });
  await p.close();
  return extId;
}

async function openPopup() {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForSelector('[role="switch"]', { timeout: 8000 });
  return popup;
}

async function setSwitch(popup, name, on) {
  const sw = popup.getByRole('switch', { name });
  await sw.waitFor({ timeout: 8000 });
  await until(
    async () => (await sw.getAttribute('aria-checked')) !== null,
    5000,
    `switch "${name}" to finish initial load`,
  );
  if (((await sw.getAttribute('aria-checked')) === 'true') !== on) await sw.click();
  await until(
    async () => (await sw.getAttribute('aria-checked')) === String(on),
    5000,
    `switch "${name}" -> ${on}`,
  );
}

// Largest qualifying <video> rect in the page; bilibili creates several.
async function videoRect(page) {
  return page.evaluate(() => {
    let best = null;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      if (r.width < 240 || r.height < 135) continue;
      if (!best || r.width * r.height > best.width * best.height) {
        best = { x: r.x, y: r.y, width: r.width, height: r.height };
      }
    }
    return best;
  });
}

async function dismissOverlays(page) {
  for (const sel of [
    '.bili-mini-close-icon',
    '.bili-mini-login-right-wp .bili-mini-close-icon',
    '.login-panel-popover .bili-mini-close-icon',
    '.v-popover-wrap .bili-mini-close-icon',
  ]) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 800 })) await el.click({ timeout: 1500 });
    } catch {}
  }
}

async function openVideoPage() {
  const page = await context.newPage();
  await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded' });
  await until(() => videoRect(page), 45000, 'a >=240x135 <video> rect');
  await sleep(1500);
  await dismissOverlays(page);
  return page;
}

async function hoverVideo(page) {
  const r = await videoRect(page);
  if (!r) throw new Error('video rect disappeared');
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 10 });
  return r;
}

let extId;
async function main() {
  await launch();
  extId = await findExtensionId();
  console.log(`extension id: ${extId}`);

  // --- Scenario 1: enabled — hover shows button, click opens doc-pip ---
  console.log('\n[1] enabled: hover button -> doc-pip window with controls');
  {
    const popup = await openPopup();
    await setSwitch(popup, SWITCH_NAME, true);
    check('popup switch turns on', true);

    const page = await openVideoPage();
    await hoverVideo(page);
    await until(
      async () => await page.locator(BUTTON).isVisible(),
      15000,
      'hover button to appear',
    );
    check('hover button visible', true);

    await page.locator(BUTTON).click();
    await until(
      () => page.evaluate(() => !!window.documentPictureInPicture?.window),
      10000,
      'documentPictureInPicture.window',
    );
    check('doc-pip window open', true);
    check(
      'placeholder replaces the video',
      await page.evaluate(() => !!document.querySelector('[data-bobox-pip-placeholder]')),
    );
    check(
      'video moved into pip document',
      await page.evaluate(
        () => !!window.documentPictureInPicture.window.document.querySelector('video'),
      ),
    );

    // Controls drive the moved video. Try to get playback running first so
    // the pause assertion actually proves the button controls the video;
    // bilibili may refuse play() for a logged-out tab — then we only prove
    // the wiring, not the effect.
    const toggleResult = await page.evaluate(async () => {
      const pipDoc = window.documentPictureInPicture.window.document;
      const v = pipDoc.querySelector('video');
      const btn = pipDoc.querySelector('[data-bobox-ctrl="toggle"]');
      if (!v || !btn) return { missing: true };
      if (v.paused) {
        try { await v.play(); } catch {}
      }
      const playing = !v.paused;
      btn.click();
      return { playing, after: v.paused };
    });
    if (toggleResult?.missing) {
      check('pip control bar exists', false, 'toggle button not found');
    } else if (toggleResult.playing) {
      check('pip pause button pauses a playing video', toggleResult.after === true);
    } else {
      console.log('  INFO video would not play in pip; toggle effect unverifiable');
      check('pip toggle button present', true);
    }
    check(
      'rate select present',
      await page.evaluate(() => {
        const sel = window.documentPictureInPicture.window.document.querySelector(
          '[data-bobox-ctrl="rate"]',
        );
        return sel && sel.options.length >= 6;
      }),
    );

    await page.evaluate(() => window.documentPictureInPicture.window.close());
    await until(
      () => page.evaluate(() => !window.documentPictureInPicture?.window),
      10000,
      'pip window to close',
    );
    check('pip window closed', true);
    check(
      'video restored into the page',
      await page.evaluate(() => {
        const v = document.querySelector('video');
        return !!v && v.isConnected && !document.querySelector('[data-bobox-pip-placeholder]');
      }),
    );
    await page.close();
    await popup.close();
  }

  // --- Scenario 2: disabled — hovering shows nothing ---
  console.log('\n[2] disabled: no hover button');
  {
    const popup = await openPopup();
    await setSwitch(popup, SWITCH_NAME, false);
    check('popup switch turns off', true);
    await popup.close();

    const page = await openVideoPage();
    await hoverVideo(page);
    await sleep(1500);
    check('no hover button when disabled', (await page.locator(BUTTON).count()) === 0);
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

if (failures.length) {
  console.error(`\nFAILED:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('\nall checks passed');
