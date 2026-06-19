const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');
const PORT = 18788;
const SKU = '1A_001';

function writeFile(filePath, content = 'test') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function request(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const parsed = data ? JSON.parse(data) : {};
        if (res.statusCode >= 400) reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
        else resolve(parsed);
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForServer(child) {
  const deadline = Date.now() + 10000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early with code ${child.exitCode}`);
    try {
      await request('GET', '/health');
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  throw lastError || new Error('Server did not start');
}

function createFixture(tmpRoot) {
  const listingRoot = path.join(tmpRoot, '上架');
  fs.mkdirSync(listingRoot, { recursive: true });

  const rows = [{
    'SKU ID': SKU,
    Title: 'Watercolor Floral Seamless Pattern',
    Description: 'Printable seamless pattern for digital craft projects.',
    Tags: 'floral, seamless, watercolor',
    Price: '2.99',
    Quantity: '999'
  }];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'SEO');
  XLSX.writeFile(workbook, path.join(listingRoot, 'sample_SEO.xlsx'));

  writeFile(path.join(listingRoot, '上架主图', `${SKU}_main.jpg`));
  writeFile(path.join(listingRoot, '上架Listing', SKU, `${SKU}_01.jpg`));
  writeFile(path.join(listingRoot, '上架Listing', SKU, `${SKU}_video.mp4`));
  writeFile(path.join(listingRoot, '上架文件', SKU, `${SKU}_seamless.jpg`));

  return listingRoot;
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'etsy-helper-smoke-'));
  const configPath = path.join(tmpRoot, 'config.json');
  const listingRoot = createFixture(tmpRoot);
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT,
    listingRoot: '',
    excelPath: '',
    defaultPrice: '2,99',
    defaultQuantity: '999',
    maxListingImages: 20,
    maxDownloadFiles: 5,
    requireVideo: true,
    token: ''
  }, null, 2));

  const server = childProcess.spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      ESH_CONFIG_PATH: configPath,
      ESH_HOST: '127.0.0.1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  server.stderr.on('data', chunk => { stderr += chunk; });

  try {
    await waitForServer(server);
    await request('POST', '/api/config', {
      port: PORT,
      listingRoot,
      excelPath: '',
      defaultPrice: '2,99',
      defaultQuantity: '999',
      maxListingImages: 20,
      maxDownloadFiles: 5,
      requireVideo: true
    });

    const product = await request('GET', `/api/product/${encodeURIComponent(SKU)}`);
    if (!product.ready) throw new Error(`Expected ${SKU} to be ready, missing: ${(product.missing || []).join(', ')}`);
    if (product.files.listingImages.length !== 1) throw new Error('Expected one listing image');
    if (product.files.downloadFiles.length !== 1) throw new Error('Expected one download file');

    console.log('Smoke test passed');
  } finally {
    server.kill();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (server.exitCode && stderr) process.stderr.write(stderr);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
