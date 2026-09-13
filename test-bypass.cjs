const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
  
  // Set localStorage directly
  await page.evaluate(() => {
    // We just need to fake enough so that Supabase might think we have a session, 
    // or we can just run a script to see what's happening.
  });
  
  await browser.close();
})();
