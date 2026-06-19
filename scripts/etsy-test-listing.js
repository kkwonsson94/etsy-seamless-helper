const http = require('http');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const SKU = process.argv[2] || '1A_003';
const MODE = process.argv[3] || 'inspect';
const WEBDRIVER_URL = process.env.WEBDRIVER_URL || 'http://127.0.0.1:4445';
const HELPER_URL = process.env.HELPER_URL || 'http://127.0.0.1:8788';

function requestJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (res.statusCode >= 400 || data.ok === false) reject(new Error(data.error || `HTTP ${res.statusCode}`));
          else resolve(data);
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

class WebDriver {
  constructor(sessionId) {
    this.sessionId = sessionId;
  }

  static async create() {
    const res = await fetch(`${WEBDRIVER_URL}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilities: { alwaysMatch: { acceptInsecureCerts: true } } })
    });
    const data = await res.json();
    if (data.value?.error) throw new Error(JSON.stringify(data.value));
    return new WebDriver(data.value.sessionId);
  }

  async command(method, endpoint, body) {
    const res = await fetch(`${WEBDRIVER_URL}/session/${this.sessionId}${endpoint}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json();
    if (data.value?.error) throw new Error(JSON.stringify(data.value));
    return data.value;
  }

  async execute(script, args = []) {
    return this.command('POST', '/execute/sync', { script, args });
  }

  async find(css) {
    return this.command('POST', '/element', { using: 'css selector', value: css });
  }

  async findAll(css) {
    return this.command('POST', '/elements', { using: 'css selector', value: css });
  }

  async typeElement(element, text, value = Array.from(text)) {
    return this.command('POST', `/element/${element['element-6066-11e4-a52e-4f735466cecf']}/value`, {
      text,
      value
    });
  }

  async closeSession() {
    await this.command('DELETE', '', null).catch(() => {});
  }
}

function productPaths(product) {
  const media = [
    product.files?.main?.path,
    ...(product.files?.listingImages || []).map(file => file.path),
    product.files?.video?.path
  ].filter(Boolean);
  const downloads = (product.files?.downloadFiles || []).map(file => file.path).filter(Boolean);
  return { media, downloads };
}

function stageUploadFiles(sku, files, prefix) {
  const dir = path.join(__dirname, '..', '.tmp-upload', sku);
  fs.mkdirSync(dir, { recursive: true });
  return files.map(file => {
    const target = path.join(dir, path.basename(file));
    fs.copyFileSync(file, target);
    return target;
  });
}

function psQuote(value) {
  return String(value).replace(/'/g, "''");
}

function pasteFilesToDialog(files) {
  const joined = files.map(file => `"${file}"`).join(' ');
  const script = `
Add-Type -AssemblyName System.Windows.Forms
for ($i = 0; $i -lt 10; $i++) {
  try {
    [System.Windows.Forms.Clipboard]::SetDataObject('${psQuote(joined)}', $true, 10, 200)
    break
  } catch {
    Start-Sleep -Milliseconds 200
    if ($i -eq 9) { throw }
  }
}
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
`;
  childProcess.execFileSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'inherit',
    windowsHide: false
  });
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function selectCreateWindow(driver) {
  const handles = await driver.command('GET', '/window/handles');
  for (const handle of handles) {
    await driver.command('POST', '/window', { handle });
    const url = await driver.command('GET', '/url');
    if (url.includes('/listing-editor/create')) return handle;
  }
  await driver.command('POST', '/window/new', { type: 'tab' });
  await driver.command('POST', '/url', { url: 'https://www.etsy.com/your/shops/me/listing-editor/create#media' });
  await sleep(3000);
  return driver.command('GET', '/window');
}

async function inspect(driver) {
  return driver.execute(`
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    return {
      url: location.href,
      title: document.title,
      fileInputs: Array.from(document.querySelectorAll('input[type=file]')).map(input => ({
        id: input.id,
        name: input.name,
        accept: input.accept,
        multiple: input.multiple
      })),
      whenMadeOptions: Array.from(document.querySelectorAll('#when-made-select option')).map(option => ({
        value: option.value,
        text: clean(option.textContent)
      })),
      shopSections: Array.from(document.querySelectorAll('#shop-section-select option')).map(option => ({
        value: option.value,
        text: clean(option.textContent)
      })),
      checkedRadios: Array.from(document.querySelectorAll('input[type=radio]:checked')).map(input => ({
        name: input.name,
        value: input.value,
        label: clean((input.closest('label') || input.parentElement)?.innerText)
      })),
      buttons: Array.from(document.querySelectorAll('button,a[role=button]')).map(el => clean(el.innerText || el.getAttribute('aria-label'))).filter(Boolean).slice(0, 120),
      text: document.body.innerText.slice(0, 6000)
    };
  `);
}

async function setFieldValues(driver, product) {
  await driver.execute(`
    const product = arguments[0];
    const setValue = (selector, value) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter ? setter.call(el, value) : (el.value = value);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const click = el => {
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    };
    const clickRadio = (name, value) => click(document.querySelector(\`input[type=radio][name="\${name}"][value="\${value}"]\`));
    const selectByText = (selector, pattern) => {
      const select = document.querySelector(selector);
      if (!select) return false;
      const option = Array.from(select.options).find(item => pattern.test(item.textContent));
      if (!option) return false;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };

    const category = document.querySelector('#category-6343');
    if (category && !category.checked) click(category);
    clickRadio('listing_type_options_group', 'download');
    selectByText('#when-made-select', /2020|2026/i);
    setValue('#listing-title-input', product.title || '');
    setValue('#listing-description-textarea', product.description || '');
    setValue('#listing-price-input', String(product.price || '5.00').replace(',', '.'));
    setValue('#listing-quantity-input', String(product.quantity || '999'));

    const addSku = Array.from(document.querySelectorAll('button')).find(button => /Add SKU/i.test(button.innerText || ''));
    if (addSku) click(addSku);
    setValue('#listing-sku-input', product.sku || '');

    selectByText('#shop-section-select', /Flower_and_Waterpaint/i);
    clickRadio('whoMade', 'on');
    const supplyRadios = Array.from(document.querySelectorAll('input[type=radio][name="isSupply"]'));
    if (supplyRadios[1]) click(supplyRadios[1]);
    clickRadio('whatContent', 'ai_gen');

    return {
      categoryChecked: Boolean(document.querySelector('#category-6343')?.checked),
      digitalChecked: Boolean(document.querySelector('input[type=radio][name="listing_type_options_group"][value="download"]')?.checked),
      title: document.querySelector('#listing-title-input')?.value || '',
      price: document.querySelector('#listing-price-input')?.value || '',
      quantity: document.querySelector('#listing-quantity-input')?.value || '',
      sku: document.querySelector('#listing-sku-input')?.value || ''
    };
  `, [product]);
}

async function addTags(driver, tags) {
  const normalized = tags.map(normalizeTag).filter(Boolean).slice(0, 13);
  const missing = [];
  for (const tag of normalized) {
    const exists = await driver.execute('return document.body.innerText.includes(arguments[0]);', [tag]);
    if (!exists) missing.push(tag);
  }
  if (!missing.length) return;

  const input = await driver.find('#listing-tags-input');
  await driver.typeElement(input, missing.join(', '));
  await sleep(300);
  await driver.typeElement(input, '\uE007');
  await sleep(1000);
}

function normalizeTag(tag) {
  const replacements = new Map([
    ['Watercolor Floral Pattern', 'Watercolor Floral'],
    ['Wildflower Fabric Pattern', 'Wildflower Fabric'],
    ['Soft Watercolor Design', 'Soft Watercolor'],
    ['Handmade Craft Pattern', 'Handmade Craft'],
    ['Greenery Floral Print', 'Greenery Floral']
  ]);
  const next = replacements.get(tag) || tag;
  return next.length <= 20 ? next : next.slice(0, 20).trim();
}

async function uploadFiles(driver, selector, files, index = 0) {
  if (!files.length) return;
  const inputs = await driver.findAll(selector);
  const input = inputs[index];
  if (!input) throw new Error(`File input not found at index ${index}: ${selector}`);
  await driver.typeElement(input, files.join('\n'), files);
  await sleep(5000);
}

async function uploadFilesBestEffort(driver, selector, buttonPattern, files, index = 0) {
  if (!files.length) return;
  try {
    await uploadFiles(driver, selector, files, index);
    return 'input';
  } catch (error) {
    console.log(`Direct file input upload failed, falling back to dialog: ${error.message}`);
  }
  await uploadWithDialog(driver, buttonPattern, files);
  return 'dialog';
}

async function clickButtonByText(driver, pattern) {
  const clicked = await driver.execute(`
    const pattern = new RegExp(arguments[0], 'i');
    const candidates = Array.from(document.querySelectorAll('button,a[role="button"],label'));
    const el = candidates.find(item => pattern.test((item.innerText || item.textContent || item.getAttribute('aria-label') || '').trim()));
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  `, [pattern.source]);
  if (!clicked) throw new Error(`Button not found: ${pattern}`);
  await sleep(1000);
}

async function uploadWithDialog(driver, buttonPattern, files) {
  if (!files.length) return;
  await clickButtonByText(driver, buttonPattern);
  await sleep(800);
  pasteFilesToDialog(files);
  await sleep(8000);
}

async function selectCraftTypes(driver) {
  const craftTypes = [
    'Drawing & drafting',
    'Painting',
    'Paper stamping',
    'Party & gifting',
    'Printing & printmaking'
  ];
  const result = await driver.execute(`
    const wanted = arguments[0];
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const click = el => {
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    };
    const already = wanted.filter(name => document.body.innerText.includes(name));
    const inputs = Array.from(document.querySelectorAll('input[placeholder="Type to search…"]'));
    const craftInput = inputs.find(input => {
      const top = input.getBoundingClientRect().top + scrollY;
      const labelText = document.body.innerText;
      return top > 2500 && labelText.includes('Craft type');
    }) || inputs[0];
    if (!craftInput) return { opened: false, already };
    click(craftInput);
    return { opened: true, already };
  `, [craftTypes]);
  await sleep(800);

  for (const craftType of craftTypes) {
    const selected = await driver.execute('return document.body.innerText.includes(arguments[0]);', [craftType]);
    if (selected) continue;
    const clicked = await driver.execute(`
      const target = arguments[0];
      const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
      const option = Array.from(document.querySelectorAll('label, [role="option"], button, div'))
        .find(el => clean(el.innerText || el.textContent) === target);
      if (!option) return false;
      option.scrollIntoView({ block: 'center' });
      option.click();
      return true;
    `, [craftType]);
    await sleep(300);
    if (!clicked) console.log(`Craft type option not found yet: ${craftType}`);
  }
  await driver.execute('document.body.click();');
  await sleep(500);
  return result;
}

async function main() {
  const product = await requestJson(`${HELPER_URL}/api/product/${encodeURIComponent(SKU)}`);
  if (!product.ready) throw new Error(`Product ${SKU} is not ready: ${(product.missing || []).join(', ')}`);

  const driver = await WebDriver.create();
  try {
    await selectCreateWindow(driver);
    if (MODE === 'inspect') {
      console.log(JSON.stringify(await inspect(driver), null, 2));
      return;
    }

    const paths = productPaths(product);
    const stagedMedia = stageUploadFiles(product.sku, paths.media, 'media');
    const stagedDownloads = stageUploadFiles(product.sku, paths.downloads, 'download');
    console.log(`Filling ${product.sku}`);
    console.log(`Media files: ${paths.media.length}`);
    console.log(`Download files: ${paths.downloads.length}`);

    if (MODE === 'fill' || MODE === 'repair') {
      const method = await uploadFilesBestEffort(driver, 'input[type=file][multiple]', /^Upload$/, stagedMedia, 0);
      console.log(`Media upload submitted via ${method}`);
    }

    if (MODE === 'fill') {
      await setFieldValues(driver, product);
      await sleep(1500);
      console.log('Basic fields submitted');
    }

    await addTags(driver, product.tags || []);
    console.log('Tags submitted');

    await selectCraftTypes(driver);
    console.log('Craft types submitted');

    if (MODE === 'fill') {
      const method = await uploadFilesBestEffort(driver, 'input[type=file][multiple]', /^Add file$/, stagedDownloads, 1);
      console.log(`Download file upload submitted via ${method}`);
    }

    const after = await inspect(driver);
    console.log(JSON.stringify({
      url: after.url,
      title: after.title,
      textPreview: after.text.slice(0, 1200)
    }, null, 2));
  } finally {
    await driver.closeSession();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
