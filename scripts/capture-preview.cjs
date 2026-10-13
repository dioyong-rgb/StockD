const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.STOCKD_PLAYWRIGHT_MODULE || 'playwright');

// 감독자가 실제 시안의 데스크톱과 모바일 가독성을 확인합니다.
(async () => {
  const outputDirectory = path.resolve('preview/screenshots');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.STOCKD_BROWSER_PATH
  });
  try {
    for (const [name, width, height] of [['root-desktop', 1440, 1000], ['root-mobile', 360, 800]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle' });
      await page.screenshot({ path: path.join(outputDirectory, `${name}.png`), fullPage: true });
      console.log(name, await page.title());
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
