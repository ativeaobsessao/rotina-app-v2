const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.stack || error.message));

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
  
  console.log('Waiting for potential crash...');
  await new Promise(r => setTimeout(r, 5000));
  
  const bodyHtml = await page.evaluate(() => document.body.innerHTML);
  console.log('BODY:', bodyHtml.substring(0, 1500));
  
  await browser.close();
})();
