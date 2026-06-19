const fields = [
  'listingRoot',
  'excelPath',
  'defaultShopSection',
  'defaultPrice',
  'defaultQuantity',
  'maxListingImages',
  'maxDownloadFiles'
];

let config = null;

const $ = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function showReportError(error) {
  $('report').innerHTML = `<span class="bad">${escapeHtml(error.message || String(error))}</span>`;
}

async function loadConfig() {
  config = await api('/api/config');
  fields.forEach(id => {
    if ($(id)) $(id).value = config[id] ?? '';
  });
  $('requireVideo').checked = !!config.requireVideo;
  $('status').textContent = `运行中：http://127.0.0.1:${config.port}`;
  $('resolvedPaths').textContent = JSON.stringify(config.resolved || {}, null, 2);
}

async function saveConfig() {
  const body = {};
  fields.forEach(id => {
    body[id] = $(id).value.trim();
  });
  body.maxListingImages = clampNumber(body.maxListingImages, 1, 20, 20);
  body.maxDownloadFiles = clampNumber(body.maxDownloadFiles, 1, 5, 5);
  body.requireVideo = $('requireVideo').checked;
  config = await api('/api/config', { method: 'POST', body: JSON.stringify(body) });
  fields.forEach(id => {
    if ($(id)) $(id).value = config[id] ?? '';
  });
  $('resolvedPaths').textContent = JSON.stringify(config.resolved || {}, null, 2);
  $('report').innerHTML = '<span class="ok">配置已保存</span>';
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

async function pickPath(event) {
  const button = event.currentTarget;
  const data = await api('/api/pick', {
    method: 'POST',
    body: JSON.stringify({ type: button.dataset.type })
  });
  if (data.path) $(button.dataset.target).value = data.path;
}

function fileList(files) {
  if (!files || !files.length) return '<span class="bad">无</span>';
  return `<ul class="file-list">${files.map(file => `<li>${escapeHtml(file.name)} <span class="muted">${formatSize(file.size)}</span></li>`).join('')}</ul>`;
}

function renderProduct(product) {
  const missing = product.missing?.length ? product.missing.join('、') : '无';
  return `
    <h3>${product.ready ? '<span class="ok">可以上架</span>' : '<span class="bad">不能上架</span>'} ${escapeHtml(product.sku)}</h3>
    <p>标题：${escapeHtml(product.title)}</p>
    <p>Tags：${product.tags?.length || 0}/13，缺失：${escapeHtml(missing)}</p>
    <div class="cards">
      <div>
        <b>主图</b>
        <div>${product.files?.main ? `${escapeHtml(product.files.main.name)} ${formatSize(product.files.main.size)}` : '<span class="bad">无</span>'}</div>
      </div>
      <div>
        <b>视频</b>
        <div>${product.files?.video ? `${escapeHtml(product.files.video.name)} ${formatSize(product.files.video.size)}` : '<span class="bad">无</span>'}</div>
      </div>
      <div>
        <b>Listing 图片 ${product.files?.listingImages?.length || 0}</b>
        ${fileList(product.files?.listingImages)}
      </div>
      <div>
        <b>下载文件 ${product.files?.downloadFiles?.length || 0}</b>
        ${fileList(product.files?.downloadFiles)}
      </div>
    </div>
  `;
}

async function checkSku() {
  const sku = $('skuInput').value.trim();
  if (!sku) {
    $('report').innerHTML = '<span class="bad">先输入 SKU</span>';
    return;
  }
  const product = await api(`/api/product/${encodeURIComponent(sku)}`);
  $('report').innerHTML = renderProduct(product);
}

async function loadProducts() {
  const products = await api('/api/products?check=1');
  const readyCount = products.filter(product => product.ready).length;
  $('report').innerHTML = `
    <h3><span class="ok">${readyCount}</span> / ${products.length} 个 SKU 可以上架</h3>
    <table>
      <thead><tr><th>SKU</th><th>状态</th><th>图</th><th>视频</th><th>下载</th><th>缺失</th></tr></thead>
      <tbody>
        ${products.map(product => `
          <tr>
            <td>${escapeHtml(product.sku)}</td>
            <td>${product.ready ? '<span class="ok">可上架</span>' : '<span class="bad">缺文件</span>'}</td>
            <td>${product.images}</td>
            <td>${product.hasVideo ? '✓' : '×'}</td>
            <td>${product.downloads}</td>
            <td>${escapeHtml((product.missing || []).join('、'))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function copyToken() {
  await navigator.clipboard.writeText(config?.token || '');
  $('report').innerHTML = '<span class="ok">Token 已复制</span>';
}

function wire() {
  $('saveBtn').addEventListener('click', () => saveConfig().catch(showReportError));
  $('reloadBtn').addEventListener('click', () => loadConfig().catch(showReportError));
  $('checkSkuBtn').addEventListener('click', () => checkSku().catch(showReportError));
  $('loadProductsBtn').addEventListener('click', () => loadProducts().catch(showReportError));
  $('copyTokenBtn').addEventListener('click', () => copyToken().catch(showReportError));
  document.querySelectorAll('.pick-btn').forEach(button => button.addEventListener('click', event => {
    pickPath(event).catch(showReportError);
  }));
}

wire();
loadConfig().catch(error => {
  $('status').textContent = '启动异常';
  $('report').textContent = error.message;
});
