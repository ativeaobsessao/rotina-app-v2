const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
  
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const toggle = btns.find(b => b.textContent.includes('Ainda não tem conta'));
    if (toggle) toggle.click();
  });
  
  await page.waitForSelector('input[placeholder="Seu nome"]');
  await page.type('input[placeholder="Seu nome"]', 'Tester User');
  
  const email = 'tester_' + Date.now() + '@example.com';
  console.log('Signing up with', email);
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', 'password123');
  
  await page.click('button[type="submit"]');
  
  await new Promise(r => setTimeout(r, 3000));
  
  // Try logging in now
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const toggle = btns.find(b => b.textContent.includes('Já possui conta'));
    if (toggle) toggle.click();
  });
  
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  
  console.log('Clicked login');
  await new Promise(r => setTimeout(r, 6000));
  
  const bodyHtml = await page.evaluate(() => document.body.innerHTML);
  console.log('BODY:', bodyHtml.substring(0, 500));
  
  await browser.close();
})();
