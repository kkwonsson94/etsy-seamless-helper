const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const childProcess = require('child_process');
const XLSX = require('xlsx');

const ROOT = __dirname;
const CONFIG_PATH = process.env.ESH_CONFIG_PATH || path.join(ROOT, 'config.json');
const EXAMPLE_CONFIG_PATH = process.env.ESH_EXAMPLE_CONFIG_PATH || path.join(ROOT, 'config.example.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
const HOST = process.env.ESH_HOST || '127.0.0.1';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm']);
const DOWNLOAD_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.zip', '.pdf']);
const DEFAULT_CONFIG = {
  port: 8788,
  listingRoot: '',
  excelPath: '',
  defaultShopSection: '',
  defaultPrice: '2,99',
  defaultQuantity: '999',
  maxListingImages: 20,
  maxDownloadFiles: 5,
  requireVideo: true,
  token: ''
};
const FOLDER_NAMES = {
  mainImageFolder: '上架主图',
  listingFolder: '上架Listing',
  downloadFolder: '上架文件'
};

function loadConfig() {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    try {
      config = JSON.parse(fs.readFileSync(EXAMPLE_CONFIG_PATH, 'utf8'));
    } catch {
      config = {};
    }
  }
  config = normalizeConfig(config);
  saveConfig(config);
  return config;
}

function normalizeConfig(input = {}) {
  const next = { ...DEFAULT_CONFIG, ...input };
  next.port = clampNumber(next.port, 1, 65535, DEFAULT_CONFIG.port);
  next.listingRoot = String(next.listingRoot || '').trim();
  next.excelPath = String(next.excelPath || '').trim();
  next.defaultShopSection = String(next.defaultShopSection || '').trim();
  next.defaultPrice = String(next.defaultPrice || DEFAULT_CONFIG.defaultPrice).trim();
  next.defaultQuantity = String(next.defaultQuantity || DEFAULT_CONFIG.defaultQuantity).trim();
  next.maxListingImages = clampNumber(next.maxListingImages, 1, 20, DEFAULT_CONFIG.maxListingImages);
  next.maxDownloadFiles = clampNumber(next.maxDownloadFiles, 1, 5, DEFAULT_CONFIG.maxDownloadFiles);
  next.requireVideo = Boolean(next.requireVideo);
  if (!next.token) next.token = crypto.randomBytes(18).toString('hex');
  return next;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function saveConfig(nextConfig) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(nextConfig, null, 2), 'utf8');
}

let config = loadConfig();

function log(message) {
  console.log(`[${new Date().toLocaleString()}] ${message}`);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Local-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...headers
  });
  res.end(body);
}

function sendJson(res, data, status = 200) {
  send(res, status, JSON.stringify(data, null, 2), { 'Content-Type': 'application/json; charset=utf-8' });
}

function sendError(res, error, status = 500) {
  sendJson(res, { ok: false, error: error.message || String(error) }, status);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function hasToken(req) {
  return req.headers['x-local-token'] === config.token;
}

function normalizeSku(sku) {
  return String(sku || '').trim();
}

function skuKey(sku) {
  return normalizeSku(sku).toLowerCase();
}

function existsFile(filePath) {
  return !!filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function existsDir(dirPath) {
  return !!dirPath && fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
}

function listFiles(dirPath) {
  if (!existsDir(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .map(name => path.join(dirPath, name))
    .filter(filePath => fs.statSync(filePath).isFile());
}

function naturalSort(files) {
  return [...files].sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' }));
}

function baseName(filePath) {
  return filePath ? path.basename(filePath) : '';
}

function resolveRoot() {
  return String(config.listingRoot || '').trim();
}

function resolveExcelPath() {
  if (existsFile(config.excelPath)) return config.excelPath;
  const root = resolveRoot();
  if (!existsDir(root)) return '';
  const matches = listFiles(root).filter(filePath => /_SEO\.xlsx$/i.test(path.basename(filePath)));
  return naturalSort(matches)[0] || '';
}

function resolvedFolders() {
  const root = resolveRoot();
  return {
    root,
    excel: resolveExcelPath(),
    mainImageFolder: root ? path.join(root, FOLDER_NAMES.mainImageFolder) : '',
    listingFolder: root ? path.join(root, FOLDER_NAMES.listingFolder) : '',
    downloadFolder: root ? path.join(root, FOLDER_NAMES.downloadFolder) : ''
  };
}

function pickField(row, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name) && String(row[name]).trim() !== '') return row[name];
  }
  return '';
}

function parseTags(value) {
  return String(value || '')
    .split(/[,，;\n\r]+/)
    .map(tag => tag.trim())
    .filter(Boolean)
    .slice(0, 13);
}

function readProductsFromExcel() {
  const folders = resolvedFolders();
  if (!folders.root && !config.excelPath) throw new Error('请先配置上架根目录或 Excel 文件');
  if (!existsFile(folders.excel)) throw new Error(`找不到 Excel 文件：${folders.excel || config.excelPath || '(empty)'}`);

  const workbook = XLSX.readFile(folders.excel);
  if (!workbook.SheetNames.length) throw new Error(`Excel 没有可读取的工作表：${folders.excel}`);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  return rows.map((row, index) => {
    const listingText = String(pickField(row, ['ETSY Listing', 'Etsy Listing', 'Listing']) || '');
    const parsedListing = parseListingText(listingText);
    const sku = normalizeSku(pickField(row, ['SKU ID', 'SKU', 'sku', 'Sku']));
    const title = String(pickField(row, ['Title', 'title', '标题', '标题（公式）']) || parsedListing.title || '').trim();
    const description = String(pickField(row, ['Description', 'description', '描述', '描述（公式）']) || parsedListing.description || '').trim();
    const tagsRaw = String(pickField(row, ['Tags', 'tags', '关键词', '标签', '标签（公式）']) || parsedListing.tags || '').trim();

    return {
      rowNumber: index + 2,
      productId: pickField(row, ['产品ID', 'Product ID', 'ID']),
      theme: pickField(row, ['产品主题', 'Theme', 'theme']),
      sku,
      title,
      description,
      tagsRaw,
      tags: parseTags(tagsRaw),
      shopSection: pickField(row, ['Shop Section', 'shop section', 'Section', '分区']) || config.defaultShopSection || '',
      price: pickField(row, ['价格', 'Price', 'price']) || config.defaultPrice || '2,99',
      quantity: pickField(row, ['库存', 'Quantity', 'quantity', '数量']) || config.defaultQuantity || '999'
    };
  }).filter(product => product.sku);
}

function parseListingText(text) {
  return {
    title: ((text.match(/SEO\s*TITLE\s*:\s*([\s\S]*?)(?:\n\s*\n|TAGS\s*:|DESCRIPTION\s*:|$)/i) || [])[1] || '').trim(),
    tags: ((text.match(/TAGS\s*:\s*([\s\S]*?)(?:\n\s*\n|DESCRIPTION\s*:|$)/i) || [])[1] || '').trim(),
    description: ((text.match(/DESCRIPTION\s*:\s*([\s\S]*)$/i) || [])[1] || '').trim()
  };
}

function findProduct(sku) {
  const target = skuKey(sku);
  return readProductsFromExcel().find(product => skuKey(product.sku) === target);
}

function matchSkuFile(filePath, sku) {
  return path.basename(filePath).toLowerCase().includes(skuKey(sku));
}

function fileInfo(filePath) {
  if (!filePath) return null;
  const stat = fs.statSync(filePath);
  return {
    name: path.basename(filePath),
    path: filePath,
    size: stat.size,
    ext: path.extname(filePath).toLowerCase()
  };
}

function matchFiles(sku) {
  const folders = resolvedFolders();
  const mainFiles = listFiles(folders.mainImageFolder).filter(file => IMAGE_EXTS.has(path.extname(file).toLowerCase()) && matchSkuFile(file, sku));
  const mainPreferred = mainFiles.find(file => /_main\./i.test(path.basename(file))) || naturalSort(mainFiles)[0] || null;

  const listingDir = path.join(folders.listingFolder, sku);
  const listingFiles = listFiles(listingDir).filter(file => matchSkuFile(file, sku));
  const listingImages = naturalSort(listingFiles.filter(file => IMAGE_EXTS.has(path.extname(file).toLowerCase())))
    .slice(0, Number(config.maxListingImages || 20));
  const videos = naturalSort(listingFiles.filter(file => VIDEO_EXTS.has(path.extname(file).toLowerCase())));

  const downloadDir = path.join(folders.downloadFolder, sku);
  const downloadFiles = naturalSort(listFiles(downloadDir).filter(file => DOWNLOAD_EXTS.has(path.extname(file).toLowerCase())))
    .slice(0, Number(config.maxDownloadFiles || 5));

  return {
    main: mainPreferred,
    listingImages,
    video: videos[0] || null,
    downloadFiles,
    folders: {
      mainImageFolder: folders.mainImageFolder,
      listingDir,
      downloadDir
    }
  };
}

function buildProduct(sku) {
  const product = findProduct(sku);
  if (!product) return null;

  const files = matchFiles(product.sku);
  const missing = [];
  if (!product.title) missing.push('标题');
  if (!product.description) missing.push('描述');
  if (!product.tags.length) missing.push('Tags');
  if (!files.main) missing.push('主图');
  if (!files.listingImages.length) missing.push('Listing 图片');
  if (config.requireVideo && !files.video) missing.push('视频');
  if (!files.downloadFiles.length) missing.push('下载文件');

  return {
    ...product,
    ready: missing.length === 0,
    missing,
    files: {
      main: fileInfo(files.main),
      listingImages: files.listingImages.map(fileInfo),
      video: fileInfo(files.video),
      downloadFiles: files.downloadFiles.map(fileInfo)
    },
    urls: {
      main: `/file/${encodeURIComponent(product.sku)}/main`,
      listingImages: files.listingImages.map((_, index) => `/file/${encodeURIComponent(product.sku)}/listing-image-${index + 1}`),
      video: `/file/${encodeURIComponent(product.sku)}/video`,
      downloadFiles: files.downloadFiles.map((_, index) => `/file/${encodeURIComponent(product.sku)}/download-${index + 1}`)
    }
  };
}

function fileForKind(sku, kind) {
  const files = matchFiles(sku);
  if (kind === 'main') return files.main;
  if (kind === 'video') return files.video;
  if (kind.startsWith('listing-image-')) {
    const index = Number(kind.replace('listing-image-', '')) - 1;
    return files.listingImages[index];
  }
  if (kind.startsWith('download-')) {
    const index = Number(kind.replace('download-', '')) - 1;
    return files.downloadFiles[index];
  }
  return null;
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.zip') return 'application/zip';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

function uploadDialogFiles(sku, kind) {
  const files = matchFiles(sku);
  let paths = [];
  if (kind === 'main-image' || kind === 'media-main-image') paths = [files.main].filter(Boolean);
  else if (kind === 'listing-media') paths = [files.main, ...files.listingImages, files.video].filter(Boolean);
  else if (kind === 'listing-video' || kind === 'media-video') paths = [files.video].filter(Boolean);
  else if (kind === 'listing-images' || kind === 'media-images') paths = files.listingImages;
  else if (/^media-image-\d+$/.test(kind)) {
    const index = Number(kind.replace('media-image-', '')) - 1;
    paths = [files.listingImages[index]].filter(Boolean);
  }
  else if (kind === 'download-files') paths = files.downloadFiles;
  else throw new Error(`Unknown upload dialog kind: ${kind}`);
  if (!paths.length) throw new Error(`No files matched for ${sku}/${kind}`);
  return paths;
}

function psQuote(value) {
  return String(value).replace(/'/g, "''");
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    childProcess.execFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: false,
      timeout: 60000
    }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || stdout || error.message));
      else resolve(stdout.trim());
    });
  });
}

async function pickLocalPath(type) {
  const script = type === 'folder'
    ? `
Add-Type -AssemblyName System.Windows.Forms
$selected = ''
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = 'CenterScreen'
$owner.Width = 1
$owner.Height = 1
$owner.Show()
$owner.Activate()
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '选择上架根目录'
$dialog.Filter = 'Folders|*.this_is_a_folder_picker'
$dialog.CheckFileExists = $false
$dialog.CheckPathExists = $true
$dialog.ValidateNames = $false
$dialog.FileName = '选择这个文件夹'
if ($dialog.ShowDialog($owner) -eq 'OK') {
  $selected = [System.IO.Path]::GetDirectoryName($dialog.FileName)
}
$owner.Close()
if ($selected) {
  [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($selected))
}
`
    : `
Add-Type -AssemblyName System.Windows.Forms
$selected = ''
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = 'CenterScreen'
$owner.Width = 1
$owner.Height = 1
$owner.Show()
$owner.Activate()
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Filter = 'Excel Files|*.xlsx;*.xls|All Files|*.*'
$dialog.Title = '选择 Excel 文件'
if ($dialog.ShowDialog($owner) -eq 'OK') { $selected = $dialog.FileName }
$owner.Close()
if ($selected) {
  [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($selected))
}
`;
  const encoded = await runPowerShell(script);
  return encoded ? Buffer.from(encoded, 'base64').toString('utf16le') : '';
}

async function pasteFilesToDialog(paths) {
  const joined = paths.map(file => `"${file}"`).join(' ');
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::SetText('${psQuote(joined)}')
[System.Windows.Forms.SendKeys]::SendWait('^v')
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
`;
  await runPowerShell(script);
}

async function nativeClick(x, y) {
  const safeX = Math.round(Number(x));
  const safeY = Math.round(Number(y));
  if (!Number.isFinite(safeX) || !Number.isFinite(safeY)) throw new Error('Invalid native click coordinates');
  const script = `
$sig = @'
[DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
[DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
'@
$u = Add-Type -MemberDefinition $sig -Name NativeClick -Namespace Win32 -PassThru
$u::SetCursorPos(${safeX}, ${safeY}) | Out-Null
Start-Sleep -Milliseconds 120
$u::mouse_event(0x02,0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
$u::mouse_event(0x04,0,0,0,[UIntPtr]::Zero)
`;
  await runPowerShell(script);
  return { x: safeX, y: safeY };
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, '');

  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname || '/');

  try {
    if (pathname === '/') return serveStatic(res, path.join(PUBLIC_DIR, 'index.html'));
    if (pathname.startsWith('/public/')) return serveStatic(res, path.join(PUBLIC_DIR, pathname.replace(/^\/public\//, '')));

    if (pathname === '/health') return sendJson(res, { ok: true, app: 'EtsySeamlessHelper', port: config.port });

    if (pathname === '/api/config' && req.method === 'GET') {
      return sendJson(res, { ...config, resolved: resolvedFolders() });
    }

    if (pathname === '/api/config' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      config = normalizeConfig({ ...config, ...body });
      saveConfig(config);
      return sendJson(res, { ...config, resolved: resolvedFolders() });
    }

    if (pathname === '/api/pick' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      return sendJson(res, { path: await pickLocalPath(body.type === 'file' ? 'file' : 'folder') });
    }

    if (pathname === '/api/products' && req.method === 'GET') {
      const products = readProductsFromExcel();
      if (!parsed.query.check) return sendJson(res, products.map(product => ({ sku: product.sku, title: product.title, rowNumber: product.rowNumber })));
      return sendJson(res, products.map(product => {
        const checked = buildProduct(product.sku);
        return {
          sku: product.sku,
          title: product.title,
          rowNumber: product.rowNumber,
          ready: checked.ready,
          missing: checked.missing,
          images: checked.files.listingImages.length + (checked.files.main ? 1 : 0),
          hasVideo: !!checked.files.video,
          downloads: checked.files.downloadFiles.length
        };
      }));
    }

    const productMatch = pathname.match(/^\/api\/product\/(.+)$/);
    if (productMatch && req.method === 'GET') {
      const product = buildProduct(productMatch[1]);
      if (!product) return sendError(res, new Error('Product not found'), 404);
      return sendJson(res, product);
    }

    if (pathname === '/api/upload-dialog' && req.method === 'POST') {
      if (!hasToken(req)) return sendError(res, new Error('Unauthorized'), 401);
      const body = JSON.parse(await readBody(req) || '{}');
      const paths = uploadDialogFiles(normalizeSku(body.sku), String(body.kind || ''));
      await pasteFilesToDialog(paths);
      log(`文件选择框上传 ${body.sku}/${body.kind}: ${paths.map(baseName).join(', ')}`);
      return sendJson(res, { ok: true, files: paths.map(fileInfo) });
    }

    if (pathname === '/api/native-click' && req.method === 'POST') {
      if (!hasToken(req)) return sendError(res, new Error('Unauthorized'), 401);
      const body = JSON.parse(await readBody(req) || '{}');
      const clicked = await nativeClick(body.x, body.y);
      log(`Native click: ${clicked.x}, ${clicked.y}`);
      return sendJson(res, { ok: true, ...clicked });
    }

    const fileMatch = pathname.match(/^\/file\/([^/]+)\/([^/]+)$/);
    if (fileMatch && req.method === 'GET') {
      const sku = normalizeSku(fileMatch[1]);
      const kind = fileMatch[2];
      const filePath = fileForKind(sku, kind);
      if (!existsFile(filePath)) return sendError(res, new Error('File not found'), 404);
      res.writeHead(200, {
        'Content-Type': mimeType(filePath),
        'Content-Disposition': `inline; filename="${encodeURIComponent(path.basename(filePath))}"`
      });
      return fs.createReadStream(filePath).pipe(res);
    }

    return sendError(res, new Error('Not found'), 404);
  } catch (error) {
    return sendError(res, error);
  }
}

function serveStatic(res, filePath) {
  if (!existsFile(filePath)) return sendError(res, new Error('Not found'), 404);
  const ext = path.extname(filePath).toLowerCase();
  const type = ext === '.html' ? 'text/html; charset=utf-8'
    : ext === '.css' ? 'text/css; charset=utf-8'
      : ext === '.js' ? 'application/javascript; charset=utf-8'
        : mimeType(filePath);
  send(res, 200, fs.readFileSync(filePath), { 'Content-Type': type });
}

http.createServer(handle).listen(config.port, HOST, () => {
  log(`Etsy Seamless Helper 3.0 started: http://${HOST}:${config.port}`);
});
