const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.stack || error.message));

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
  
  // Login directly with a known credential if possible? Or create one.
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const toggle = btns.find(b => b.textContent.includes('Ainda não tem conta'));
    if (toggle) toggle.click();
  });
  
  await page.waitForSelector('input[placeholder="Seu nome"]');
  await page.type('input[placeholder="Seu nome"]', 'Tester User');
  
  const email = 'tester2_' + Date.now() + '@example.com';
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', 'password123');
  
  await page.click('button[type="submit"]');
  
  await new Promise(r => setTimeout(r, 2000));
  
  // Assuming it stays on the page or logs in automatically? The current code:
  // After signup, we get a success message, then we have to toggle back to login.
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const toggle = btns.find(b => b.textContent.includes('Já possui conta'));
    if (toggle) toggle.click();
  });
  
  await page.waitForSelector('input[type="email"]');
  // clear input and type
  await page.evaluate(() => document.querySelector('input[type="email"]').value = '');
  await page.type('input[type="email"]', email);
  await page.evaluate(() => document.querySelector('input[type="password"]').value = '');
  await page.type('input[type="password"]', 'password123');
  
  await page.click('button[type="submit"]');
  
  console.log('Clicked login, waiting for crash...');
  await new Promise(r => setTimeout(r, 5000));
  
  const bodyHtml = await page.evaluate(() => document.body.innerHTML);
  console.log('BODY:', bodyHtml.substring(0, 1500));
  
  await browser.close();
})();
