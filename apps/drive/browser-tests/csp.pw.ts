import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { driveContentSecurityPolicy } from "../lib/security/csp";
let server: Server, origin: string, events = 0;
const main = `const violations=[];
window.addEventListener('securitypolicyviolation',e=>{violations.push(e.violatedDirective+':'+e.blockedURI);document.querySelector('#violations').textContent=JSON.stringify(violations)});
document.querySelector('#nonce').textContent='Nonce executed';
try{new Function('return 1')();document.querySelector('#eval').textContent='FAIL'}catch{document.querySelector('#eval').textContent='Eval blocked'}
setTimeout(()=>{document.querySelector('#inline').textContent=window.injected?'FAIL':'Injection blocked';document.querySelector('#attributes').textContent=window.attributeRan?'FAIL':'Attributes blocked'},100);
posthog.init('phc_synthetic_csp_fixture',{api_host:location.origin,capture_pageview:false,capture_pageleave:false,autocapture:false,disable_session_recording:true,disable_external_dependency_loading:true,advanced_disable_flags:true,request_batching:false,persistence:'memory',opt_out_useragent_filter:true});
document.querySelector('#analytics').onclick=()=>{posthog.capture('phc_synthetic_csp_fixture',{marker:'synthetic'});setTimeout(async()=>document.querySelector('#sdk').textContent='Events: '+(await(await fetch('/status')).json()).events,800)};
document.querySelector('#frame').onclick=()=>{const frame=document.createElement('iframe');frame.src='https://checkout.razorpay.com/fixture';document.body.appendChild(frame)};
document.querySelector('#payment').onclick=()=>{const s=document.createElement('script');s.src='https://checkout.razorpay.com/v1/checkout.js';s.onload=()=>{document.querySelector('#payment-status').textContent='SDK loaded';try{new Razorpay({key:'rzp_test_invalid_csp_probe',amount:100,currency:'INR',name:'CSP compatibility probe',modal:{ondismiss:()=>{}}}).open()}catch(e){document.querySelector('#payment-status').textContent=e.message}};document.head.appendChild(s)};`;
test.beforeAll(async () => {
  server = createServer((req,res) => {
    if(req.url === '/posthog.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(readFileSync('../../node_modules/posthog-js/dist/array.no-external.js'));}
    if(req.url === '/status'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({events}));}
    if(req.url?.startsWith('/i/') || req.url?.startsWith('/e/')){events++;res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"status":1}');}
    if(req.url === '/attack.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end('window.injected=1');}
    if(req.url === '/missing-image'){res.writeHead(404);return res.end();}
    const nonce=randomBytes(32).toString('base64');
    res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':driveContentSecurityPolicy(nonce, req.url !== '/plain'),'Cache-Control':'private, no-store'});
    res.end(`<!doctype html><title>CSP probe</title><p id="nonce">Waiting</p><p id="eval">Waiting</p><p id="inline">Waiting</p><p id="attributes">Waiting</p><button id="analytics">Check PostHog SDK</button><p id="sdk">Waiting</p><button id="frame">Check payment frame</button><button id="payment">Open invalid-key SDK probe</button><p id="payment-status">Waiting</p><pre id="violations">[]</pre><script nonce="${nonce}" src="/posthog.js"></script><script nonce="${nonce}">${main}</script><script>window.injected=1</script><script src="/attack.js"></script><img src="/missing-image" onerror="window.attributeRan=1">`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address=server.address(); if(!address || typeof address === 'string') throw new Error('No fixture port');
  origin=`http://127.0.0.1:${address.port}`;
  Object.assign(process.env,{NODE_ENV:'production',ACCOUNTS_ORIGIN:'http://localhost:3001',DRIVE_ORIGIN:origin,NEXT_PUBLIC_DRIVE_ORIGIN:origin,NEXT_PUBLIC_REALTIME_ORIGIN:origin,NEXT_PUBLIC_POSTHOG_KEY:'phc_synthetic_csp_fixture',NEXT_PUBLIC_POSTHOG_HOST:origin});
});
test.afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
test('nonces execute while parser injections, attributes and JS eval are blocked',async({page})=>{
  const response=await page.goto(origin);
  await expect(page.locator('#nonce')).toHaveText('Nonce executed');
  await expect(page.locator('#eval')).toHaveText('Eval blocked');
  await expect(page.locator('#inline')).toHaveText('Injection blocked');
  await expect(page.locator('#attributes')).toHaveText('Attributes blocked');
  expect(response?.headers()['cache-control']).toContain('no-store');
  const first=response?.headers()['content-security-policy'];const second=await page.reload();
  expect(second?.headers()['content-security-policy']).not.toBe(first);
});
test('the real bundled PostHog SDK can send a synthetic event to a local receiver',async({page})=>{
  events=0;await page.goto(origin);await page.getByRole('button',{name:'Check PostHog SDK'}).click();
  await expect(page.locator('#sdk')).toHaveText(/Events: [1-9]/);
});
test('payment frame access is limited to checkout pages',async({page})=>{
  await page.route('https://checkout.razorpay.com/fixture',route=>route.fulfill({contentType:'text/html',body:'<p>Payment frame fixture</p>'}));
  await page.goto(origin);await page.getByRole('button',{name:'Check payment frame'}).click();
  await expect(page.frameLocator('iframe').getByText('Payment frame fixture')).toBeVisible();
  await page.goto(origin+'/plain');await page.getByRole('button',{name:'Check payment frame'}).click();
  await expect(page.locator('#violations')).toContainText('frame-src:https://checkout.razorpay.com');
});
test('real Razorpay SDK load and invalid-key frame probe @provider',async({page})=>{
  test.skip(process.env.CSP_PROVIDER_SMOKE !== '1','Opt in to external SDK connectivity; no valid key or payment is used');
  await page.goto(origin);await page.getByRole('button',{name:'Open invalid-key SDK probe'}).click();
  await expect(page.locator('#payment-status')).toHaveText('SDK loaded');
  await expect(page.locator('iframe')).toHaveCount(1);
  expect(await page.locator('#violations').textContent()).not.toMatch(/connect-src.*razorpay|frame-src.*razorpay/);
});

test('production Next pages hydrate with matching nonces @app',async({page})=>{
  test.skip(!process.env.DRIVE_CSP_SMOKE_URL,'Requires a local production Drive build with a disposable database');
  const errors:string[]=[];page.on('console',message=>{if(message.type()==='error'&&message.text().includes('Content Security Policy'))errors.push(message.text())});
  await page.setViewportSize({width:375,height:800});
  const response=await page.goto(process.env.DRIVE_CSP_SMOKE_URL+'/privacy');
  expect(response?.headers()['content-security-policy']).toContain("'strict-dynamic'");
  await expect(page.getByRole('heading',{name:'Privacy Policy',exact:true})).toBeVisible();
  const nonces=await page.locator('script').evaluateAll(scripts=>scripts.filter(script=>script.hasAttribute('src')||script.textContent?.includes('self.__next')).map(script=>(script as HTMLScriptElement).nonce));
  expect(nonces.length).toBeGreaterThan(0);expect(nonces.every(nonce=>!!nonce && nonce.length>20)).toBeTruthy();
  await page.getByRole('button',{name:'Toggle menu'}).click();
  await expect(page.locator('nav .absolute.top-full')).toBeVisible();
  expect(errors).toEqual([]);
});
