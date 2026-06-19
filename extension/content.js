(function () {
  const HELPER_URL = 'http://127.0.0.1:8788';
  const CRAFT_TYPES = [
    'Drawing & drafting',
    'Painting',
    'Paper stamping',
    'Party & gifting',
    'Printing & printmaking'
  ];
  const TAG_REPLACEMENTS = new Map([
    ['Watercolor Floral Pattern', 'Watercolor Floral'],
    ['Wildflower Fabric Pattern', 'Wildflower Fabric'],
    ['Soft Watercolor Design', 'Soft Watercolor'],
    ['Handmade Craft Pattern', 'Handmade Craft'],
    ['Greenery Floral Print', 'Greenery Floral']
  ]);

  let stopRequested = false;
  let queueRunning = false;
  let panelState = {
    config: null,
    products: [],
    selected: new Set(),
    search: '',
    token: '',
    saveDraftAndContinue: false
  };

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

  setTimeout(() => {
    openPanel().catch(error => console.error('[Etsy Seamless Helper]', error));
  }, 1200);

  function log(message) {
    const logEl = document.getElementById('esh-log');
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    console.log(`[Etsy Seamless Helper] ${message}`);
    if (!logEl) return;
    logEl.textContent = logEl.textContent === '等待操作...' ? line : `${logEl.textContent}\n${line}`;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function helperMessage(message, token = panelState.token) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        target: 'helper',
        baseUrl: HELPER_URL,
        token,
        ...message
      }, response => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else if (!response?.ok) reject(new Error(response?.error || 'Helper request failed'));
        else resolve(response.data);
      });
    });
  }

  function helperGet(path) {
    return helperMessage({ action: 'json', path }, '');
  }

  function helperPost(path, body) {
    return helperMessage({ action: 'json', path, method: 'POST', body });
  }

  async function loadConfig() {
    panelState.config = await helperGet('/api/config');
    panelState.token = panelState.config.token || panelState.token || '';
    const tokenInput = document.getElementById('esh-token');
    if (tokenInput) tokenInput.value = panelState.token;
    return panelState.config;
  }

  async function loadProduct(sku) {
    if (!panelState.config) await loadConfig();
    const product = await helperGet(`/api/product/${encodeURIComponent(sku)}`);
    if (!product.ready) throw new Error(`${sku} 缺少：${(product.missing || []).join('、')}`);
    return product;
  }

  async function refreshProducts() {
    await loadConfig();
    const data = await helperGet('/api/products?check=1');
    panelState.products = Array.isArray(data) ? data : (data.products || []);
    renderProducts();
    log(`已刷新 ${panelState.products.length} 个 SKU`);
  }

  async function openPanel() {
    if (document.getElementById('esh-panel')) return;
    injectStyles();
    const panel = document.createElement('div');
    panel.id = 'esh-panel';
    panel.innerHTML = panelHtml();
    document.documentElement.appendChild(panel);
    bindPanel(panel);
    await loadConfig().catch(error => log(`连接 helper 失败：${error.message}`));
    refreshProducts().catch(error => log(`刷新失败：${error.message}`));
    resumePendingQueue().catch(error => log(`恢复队列失败：${error.message}`));
  }

  function injectStyles() {
    if (document.getElementById('esh-style')) return;
    const style = document.createElement('style');
    style.id = 'esh-style';
    style.textContent = `
      #esh-panel {
        position: fixed;
        top: 72px;
        right: 18px;
        z-index: 2147483647;
        width: 360px;
        max-height: calc(100vh - 120px);
        background: #f7f8fc;
        color: #172033;
        border: 1px solid #d6deec;
        border-radius: 8px;
        box-shadow: 0 18px 48px rgba(18, 28, 48, .22);
        font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif;
        overflow: hidden;
      }
      #esh-panel * { box-sizing: border-box; }
      #esh-panel .esh-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        background: #fff;
        border-bottom: 1px solid #e2e7f1;
      }
      #esh-panel h2 { font-size: 15px; margin: 0; }
      #esh-panel .esh-body { padding: 8px; overflow: auto; max-height: calc(100vh - 168px); }
      #esh-panel label { display: grid; gap: 4px; font-size: 12px; color: #4a566e; margin-bottom: 7px; }
      #esh-panel input[type="text"], #esh-panel input[type="password"] {
        width: 100%;
        border: 1px solid #cbd4e4;
        border-radius: 6px;
        padding: 5px 6px;
        font-size: 12px;
      }
      #esh-panel button {
        border: 0;
        border-radius: 6px;
        padding: 6px 8px;
        background: #2458d3;
        color: #fff;
        font-weight: 700;
        cursor: pointer;
        font-size: 12px;
      }
      #esh-panel button.ghost { background: #eef2fa; color: #26334d; border: 1px solid #d4ddeb; }
      #esh-panel .esh-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
      #esh-panel .esh-row input[type="text"] { flex: 1; }
      #esh-panel .esh-checks label { display: flex; align-items: center; gap: 7px; margin: 4px 0; }
      #esh-panel .esh-table {
        max-height: 150px;
        overflow: auto;
        background: #fff;
        border: 1px solid #e2e7f1;
        border-radius: 6px;
        margin: 8px 0;
      }
      #esh-panel table { width: 100%; border-collapse: collapse; font-size: 11px; }
      #esh-panel th, #esh-panel td { padding: 4px 4px; border-bottom: 1px solid #edf0f6; text-align: left; }
      #esh-panel th { position: sticky; top: 0; background: #f9fbff; }
      #esh-panel .esh-title { display: block; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #69758c; }
      #esh-panel .ok { color: #138246; font-weight: 700; }
      #esh-panel .bad { color: #ba2b20; font-weight: 700; }
      #esh-panel pre {
        min-height: 70px;
        max-height: 110px;
        overflow: auto;
        background: #101827;
        color: #dbe7ff;
        border-radius: 7px;
        padding: 9px;
        font-size: 11px;
        white-space: pre-wrap;
        margin: 8px 0 0;
      }
    `;
    document.head.appendChild(style);
  }

  function panelHtml() {
    return `
      <div class="esh-head">
        <h2>Etsy Seamless Helper</h2>
        <button class="ghost" id="esh-close">关闭</button>
      </div>
      <div class="esh-body">
        <label>本地 helper
          <input type="text" value="${HELPER_URL}" readonly>
        </label>
        <label>Token
          <input id="esh-token" type="password" value="">
        </label>
        <div class="esh-row">
          <button id="esh-test" class="ghost">测试连接</button>
          <button id="esh-refresh">刷新列表</button>
        </div>
        <div class="esh-row">
          <input id="esh-search" type="text" placeholder="搜索 SKU / 标题">
          <button id="esh-select-ready" class="ghost">全选可上架</button>
        </div>
        <div class="esh-table">
          <table>
            <thead><tr><th><input id="esh-all" type="checkbox"></th><th>SKU</th><th>状态</th><th>图</th><th>视频</th><th>文件</th></tr></thead>
            <tbody id="esh-products"><tr><td colspan="6">正在读取...</td></tr></tbody>
          </table>
        </div>
        <div class="esh-checks">
          <label><input id="esh-save-draft" type="checkbox"> 填完后保存草稿并继续下一个</label>
        </div>
        <div class="esh-row">
          <button id="esh-run-current">只跑当前页第一个</button>
          <button id="esh-run-selected">开始选中队列</button>
          <button id="esh-stop" class="ghost">停止</button>
        </div>
        <div class="esh-row">
          <button id="esh-fix-craft" class="ghost">补 Craft type</button>
        </div>
        <pre id="esh-log">等待操作...</pre>
      </div>
    `;
  }

  function bindPanel(panel) {
    panel.querySelector('#esh-close').addEventListener('click', () => panel.remove());
    panel.querySelector('#esh-test').addEventListener('click', () => loadConfig().then(() => log('helper 连接正常')).catch(error => log(error.message)));
    panel.querySelector('#esh-refresh').addEventListener('click', () => refreshProducts().catch(error => log(error.message)));
    panel.querySelector('#esh-search').addEventListener('input', event => {
      panelState.search = event.target.value;
      renderProducts();
    });
    panel.querySelector('#esh-all').addEventListener('change', event => {
      filteredProducts().forEach(product => {
        if (event.target.checked && product.ready) panelState.selected.add(product.sku);
        else panelState.selected.delete(product.sku);
      });
      renderProducts();
    });
    panel.querySelector('#esh-select-ready').addEventListener('click', () => {
      filteredProducts().forEach(product => {
        if (product.ready) panelState.selected.add(product.sku);
      });
      renderProducts();
    });
    panel.querySelector('#esh-save-draft').addEventListener('change', event => {
      panelState.saveDraftAndContinue = event.target.checked;
    });
    panel.querySelector('#esh-run-current').addEventListener('click', () => runSelected(true).catch(error => log(`错误：${error.message}`)));
    panel.querySelector('#esh-run-selected').addEventListener('click', () => runSelected(false).catch(error => log(`错误：${error.message}`)));
    panel.querySelector('#esh-stop').addEventListener('click', () => {
      stopRequested = true;
      log('已请求停止');
    });
    panel.querySelector('#esh-fix-craft').addEventListener('click', () => selectCraftTypes().catch(error => log(`Craft type 错误：${error.message}`)));
  }

  function filteredProducts() {
    const keyword = clean(panelState.search).toLowerCase();
    if (!keyword) return panelState.products;
    return panelState.products.filter(product => {
      return `${product.sku} ${product.title || ''}`.toLowerCase().includes(keyword);
    });
  }

  function renderProducts() {
    const body = document.getElementById('esh-products');
    if (!body) return;
    const products = filteredProducts();
    if (!products.length) {
      body.innerHTML = '<tr><td colspan="6">没有匹配的 SKU</td></tr>';
      return;
    }
    body.innerHTML = products.map(product => {
      const checked = panelState.selected.has(product.sku) ? 'checked' : '';
      const status = product.ready ? '<span class="ok">可上架</span>' : `<span class="bad">${escapeHtml((product.missing || []).join('、') || '缺少')}</span>`;
      const imageCount = product.images ?? product.imageCount ?? 0;
      const downloadCount = product.downloads ?? product.downloadFiles ?? 0;
      return `
        <tr>
          <td><input class="esh-row-check" type="checkbox" data-sku="${escapeAttr(product.sku)}" ${checked} ${product.ready ? '' : 'disabled'}></td>
          <td><b>${escapeHtml(product.sku)}</b><span class="esh-title">${escapeHtml(product.title || '')}</span></td>
          <td>${status}</td>
          <td>${imageCount}</td>
          <td>${product.hasVideo ? '是' : '否'}</td>
          <td>${downloadCount}</td>
        </tr>
      `;
    }).join('');
    body.querySelectorAll('.esh-row-check').forEach(input => {
      input.addEventListener('change', () => {
        if (input.checked) panelState.selected.add(input.dataset.sku);
        else panelState.selected.delete(input.dataset.sku);
      });
    });
  }

  async function runSelected(firstOnly) {
    if (queueRunning) throw new Error('已有任务正在运行');
    const selected = [...panelState.selected].filter(sku => panelState.products.some(product => product.sku === sku && product.ready));
    if (!selected.length) throw new Error('请先勾选至少一个可上架 SKU');
    const queue = firstOnly ? [selected[0]] : selected;
    stopRequested = false;
    if (!location.href.includes('/listing-editor/create')) {
      await savePendingQueue({ queue, index: 0, saveDraftAndContinue: panelState.saveDraftAndContinue });
      log(`已保存队列，正在打开新建页：${queue[0]}`);
      location.href = 'https://www.etsy.com/your/shops/me/listing-editor/create';
      return;
    }
    await processQueue(queue, 0, panelState.saveDraftAndContinue);
  }

  async function processQueue(queue, startIndex, saveDraftAndContinue) {
    queueRunning = true;
    try {
      for (let index = startIndex; index < queue.length; index += 1) {
        if (stopRequested) break;
        const sku = queue[index];
        await ensureCreatePage(true);
        const product = await loadProduct(sku);
        log(`开始：${sku}`);
        await runOne(product);
        log(`${sku} 已填完，等待检查`);
        if (index < queue.length - 1) {
          if (!saveDraftAndContinue) {
            log(`队列暂停：剩余 ${queue.length - index - 1} 个。勾选“保存草稿并继续”才会自动进入下一个`);
            await savePendingQueue({ queue, index: index + 1, saveDraftAndContinue });
            break;
          }
          await savePendingQueue({ queue, index: index + 1, saveDraftAndContinue });
          await saveDraft();
          await wait(2500);
          await openFreshCreatePage();
          return;
        }
      }
      await clearPendingQueue();
    } finally {
      queueRunning = false;
    }
  }

  async function resumePendingQueue() {
    if (!location.href.includes('/listing-editor/create')) return;
    const state = await getPendingQueue();
    if (!state?.queue?.length || queueRunning) return;
    log(`恢复队列：${state.queue.slice(state.index || 0).join(', ')}`);
    await processQueue(state.queue, state.index || 0, !!state.saveDraftAndContinue);
  }

  function chromeStorageGet(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  }

  function chromeStorageSet(values) {
    return new Promise(resolve => chrome.storage.local.set(values, resolve));
  }

  async function savePendingQueue(state) {
    await chromeStorageSet({ eshPendingQueue: state });
  }

  async function getPendingQueue() {
    const saved = await chromeStorageGet(['eshPendingQueue']);
    return saved.eshPendingQueue;
  }

  async function clearPendingQueue() {
    await chromeStorageSet({ eshPendingQueue: null });
  }

  async function runOne(product) {
    await waitForFreshMediaArea();
    await uploadMedia(product);
    await fillFields(product);
    await uploadDownloads(product);
    await finalVerify(product);
  }

  async function ensureCreatePage(allowCurrent) {
    if (location.href.includes('/listing-editor/create')) {
      if (allowCurrent) return;
      await openFreshCreatePage();
      return;
    }
    location.href = 'https://www.etsy.com/your/shops/me/listing-editor/create';
    await waitForUrl('/listing-editor/create', 60000);
    await wait(3500);
  }

  async function openFreshCreatePage() {
    location.href = 'https://www.etsy.com/your/shops/me/listing-editor/create';
    await waitForUrl('/listing-editor/create', 60000);
    await wait(3500);
  }

  async function waitForUrl(part, timeout = 60000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (location.href.includes(part)) return;
      await wait(500);
    }
    throw new Error(`等待页面跳转超时：${part}`);
  }

  async function uploadDialog(product, kind) {
    const res = await helperPost('/api/upload-dialog', { sku: product.sku, kind });
    log(`已提交 ${kind}: ${(res.files || []).map(file => file.name).join(', ')}`);
    return res;
  }

  async function uploadMedia(product) {
    const imageTotal = (product.files?.main ? 1 : 0) + (product.files?.listingImages?.length || 0);
    const hasVideo = !!product.files?.video;
    const initial = countUploadedMedia();
    if (initial.images > 0 || initial.videos > 0) {
      throw new Error(`页面已有媒体：图片 ${initial.images}，视频 ${initial.videos}。为避免混入上一条，已停止`);
    }

    log('上传主图');
    const upload = await clickMediaUploadButton();
    if (!upload) throw new Error('找不到媒体 Upload 按钮');
    await wait(1200);
    await uploadDialog(product, 'media-main-image');
    await waitForMediaUpload(product, { images: 1, videos: 0, timeout: 90000 });

    if (hasVideo) {
      log(`上传视频：${product.files.video.name}`);
      await clickRequiredEmptyMediaSlotByText(/Add videos?|Add video/i, 'Add video');
      await wait(1200);
      await uploadDialog(product, 'media-video');
      await waitForMediaUpload(product, { images: 1, videos: 1, timeout: 180000 });
      await waitForVideoUploadComplete(product);
    }

    if (product.files?.listingImages?.length) {
      log(`逐张上传 listing 图片：${product.files.listingImages.map(file => file.name).join(', ')}`);
      for (let index = 0; index < product.files.listingImages.length; index += 1) {
        const file = product.files.listingImages[index];
        const expectedImages = 1 + index + 1;
        log(`上传 listing 图片 ${index + 1}/${product.files.listingImages.length}: ${file.name}`);
        await clickEmptyMediaSlotByText(/Add photos?|Add photo/i);
        await wait(1200);
        await uploadDialog(product, `media-image-${index + 1}`);
        await waitForMediaUpload(product, { images: expectedImages, videos: hasVideo ? 1 : 0, timeout: 90000 });
      }
      await waitForMediaUpload(product, { images: imageTotal, videos: hasVideo ? 1 : 0, timeout: 30000 });
    }
  }

  async function clickMediaUploadButton() {
    const mediaTab = textElement(/^Photo\s*&\s*Video$/i);
    if (mediaTab) {
      clickElement(mediaTab);
      await wait(600);
    }
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], label, div, span'))
      .map(el => ({ el, rect: el.getBoundingClientRect(), text: clean(el.innerText || el.getAttribute('aria-label')) }))
      .filter(item => item.rect.width > 20 && item.rect.height > 20)
      .filter(item => /Upload/i.test(item.text))
      .sort((a, b) => {
        const buttonA = a.el.tagName === 'BUTTON' ? 0 : 1;
        const buttonB = b.el.tagName === 'BUTTON' ? 0 : 1;
        if (buttonA !== buttonB) return buttonA - buttonB;
        return (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height);
      });
    const target = candidates[0]?.el;
    if (!target) return null;
    await nativeClickElement(target);
    return target;
  }

  async function clickRequiredEmptyMediaSlotByText(pattern, label) {
    const match = findEmptyMediaTiles().find(item => pattern.test(item.text || ''))?.el;
    if (!match) throw new Error(`找不到 ${label} 上传入口`);
    await nativeClickElement(match);
  }

  async function clickEmptyMediaSlotByText(pattern) {
    const match = findEmptyMediaTiles().find(item => pattern.test(item.text || ''))?.el;
    if (match) {
      await nativeClickElement(match);
      return;
    }
    const fallback = findEmptyMediaTiles()[0]?.el;
    if (!fallback) throw new Error('找不到空媒体上传入口');
    await nativeClickElement(fallback);
  }

  function findEmptyMediaTiles() {
    const bounds = mediaSectionBounds();
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], label, div'))
      .map(el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const text = clean(el.innerText || el.getAttribute('aria-label') || '');
        return { el, rect, text, hasMedia: !!el.querySelector('img, video'), bg: style.backgroundColor || '' };
      })
      .filter(item => item.rect.width >= 70 && item.rect.width <= 220)
      .filter(item => item.rect.height >= 60 && item.rect.height <= 220)
      .filter(item => item.rect.top >= bounds.top && item.rect.top <= bounds.bottom)
      .filter(item => !item.hasMedia)
      .filter(item => !item.text || /Add|Upload/i.test(item.text) || /rgb\(23[8-9]|rgb\(24[0-9]|#f/i.test(item.bg));
    candidates.sort((a, b) => {
      const exactA = /Add video|Add photos?/i.test(a.text) ? 0 : 1;
      const exactB = /Add video|Add photos?/i.test(b.text) ? 0 : 1;
      if (exactA !== exactB) return exactA - exactB;
      return (a.rect.top - b.rect.top) || (a.rect.left - b.rect.left);
    });
    return candidates;
  }

  function countUploadedMedia() {
    const byText = countMediaByRemainingText();
    const bounds = mediaSectionBounds();
    const imageSrcs = new Set();
    document.querySelectorAll('img').forEach(img => {
      const rect = img.getBoundingClientRect();
      if (rect.top < bounds.top || rect.top > bounds.bottom) return;
      if (!img.src || rect.width <= 40 || rect.height <= 40) return;
      imageSrcs.add(img.src.replace(/il_\d+x\d+/i, 'il_fullxfull').split('?')[0]);
    });
    const videos = Array.from(document.querySelectorAll('video')).filter(video => {
      const rect = video.getBoundingClientRect();
      return rect.top >= bounds.top && rect.top <= bounds.bottom;
    }).length;
    return {
      images: byText.images ?? imageSrcs.size,
      videos: byText.videos ?? videos
    };
  }

  function countMediaByRemainingText() {
    const text = document.body.innerText || '';
    const lines = text.split(/\n+/).map(line => clean(line)).filter(Boolean);
    const photosRemaining = remainingAfterLabel(lines, /^Add photos?$/i);
    const videosRemaining = remainingAfterLabel(lines, /^Add videos?$/i);
    return {
      images: photosRemaining === null ? null : Math.max(0, 20 - photosRemaining),
      videos: videosRemaining === null ? null : Math.max(0, 2 - videosRemaining)
    };
  }

  function remainingAfterLabel(lines, pattern) {
    for (let index = 0; index < lines.length; index += 1) {
      if (!pattern.test(lines[index])) continue;
      for (let offset = 1; offset <= 4 && index + offset < lines.length; offset += 1) {
        const match = lines[index + offset].match(/^(\d+)\s+remaining$/i);
        if (match) return Number(match[1]);
      }
    }
    return null;
  }

  async function waitForFreshMediaArea(timeout = 45000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const counts = countUploadedMedia();
      const text = document.body.innerText || '';
      const hasInitialUpload = /Drag and drop files|Upload/i.test(text) && /Add up to 20 photos/i.test(text);
      const remaining = countMediaByRemainingText();
      const hasFreshSlots = remaining.images === 0 && remaining.videos === 0;
      if ((hasInitialUpload || hasFreshSlots) && counts.images === 0 && counts.videos === 0) return true;
      if (counts.images === 0 && counts.videos === 0 && /Photo and video/i.test(text)) return true;
      await wait(1000);
    }
    throw new Error('新建页媒体区域不是空的，可能残留上一条 listing');
  }

  async function waitForMediaUpload(product, expected) {
    const minImages = expected.images ?? 1;
    const minVideos = expected.videos ?? 0;
    const timeout = expected.timeout ?? 90000;
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const media = countUploadedMedia();
      if (media.images >= minImages && media.videos >= minVideos) return;
      log(`等待媒体：图片 ${media.images}/${minImages}，视频 ${media.videos}/${minVideos}`);
      await wait(2000);
    }
    const media = countUploadedMedia();
    throw new Error(`${product.sku} 媒体上传超时：图片 ${media.images}/${minImages}，视频 ${media.videos}/${minVideos}`);
  }

  async function waitForVideoUploadComplete(product, timeout = 180000) {
    const end = Date.now() + timeout;
    let stableSince = 0;
    while (Date.now() < end) {
      const media = countUploadedMedia();
      const processing = isMediaUploadProcessing();
      if (media.videos >= 1 && !processing) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 8000) return;
      } else {
        stableSince = 0;
      }
      await wait(1000);
    }
    throw new Error(`${product.sku} 视频处理未完成`);
  }

  function isMediaUploadProcessing() {
    const text = mediaSectionText();
    if (/\d+\s*%\s*complete|uploading|processing|saving|preparing|please wait/i.test(text)) return true;
    const bounds = mediaSectionBounds();
    return Array.from(document.querySelectorAll('progress, [role="progressbar"], [aria-busy="true"], .wt-spinner')).some(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top >= bounds.top && rect.top <= bounds.bottom;
    });
  }

  function mediaSectionBounds() {
    const mediaHeading = Array.from(document.querySelectorAll('h1, h2, h3, p, div, span'))
      .find(el => /^Photo and video$/i.test(clean(el.innerText || el.textContent)));
    const categoryHeading = Array.from(document.querySelectorAll('h1, h2, h3, div'))
      .find(el => /^Category$/i.test(clean(el.innerText || el.textContent)));
    return {
      top: mediaHeading?.getBoundingClientRect().top ?? 0,
      bottom: categoryHeading?.getBoundingClientRect().top ?? window.innerHeight
    };
  }

  function mediaSectionText() {
    const bounds = mediaSectionBounds();
    return Array.from(document.querySelectorAll('button, div, p, span, label'))
      .filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.top >= bounds.top && rect.top <= bounds.bottom;
      })
      .map(el => el.innerText || el.getAttribute('aria-label') || '')
      .join('\n');
  }

  async function fillFields(product) {
    log('填写标题、描述、价格、标签和属性');
    const category = document.querySelector('#category-6343');
    if (category && !category.checked) clickElement(category);
    clickRadioByValue('listing_type_options_group', 'download');
    selectByText('#when-made-select', /2020\s*-\s*2026/i);

    nativeSetValue(document.querySelector('#listing-title-input') || inputByLabel(/^Title/i, 'input'), product.title || '');
    nativeSetValue(document.querySelector('#listing-description-textarea') || inputByLabel(/^Description/i, 'textarea'), product.description || '');
    nativeSetValue(document.querySelector('#listing-price-input') || inputByLabel(/^Price/i, 'input'), String(product.price || '5.00').replace(',', '.'));
    nativeSetValue(document.querySelector('#listing-quantity-input') || inputByLabel(/^Quantity/i, 'input'), String(product.quantity || '999'));

    const addSku = buttonByText(/Add SKU/i);
    if (addSku && !document.querySelector('#listing-sku-input')) clickElement(addSku);
    await wait(300);
    nativeSetValue(document.querySelector('#listing-sku-input') || inputByLabel(/^SKU/i, 'input'), product.sku || '');

    if (product.shopSection) selectByText('#shop-section-select', new RegExp(escapeRegex(product.shopSection), 'i'));
    else selectByText('#shop-section-select', /Flower_and_Waterpaint/i);

    await addTags(product.tags || []);
    await selectCraftTypes();
    clickRadioByValue('whoMade', 'on', 0);
    clickRadioByValue('isSupply', 'on', 1);
    clickRadioByValue('whatContent', 'ai_gen', 2);
  }

  async function addTags(tags) {
    const normalized = tags.map(normalizeTag).filter(Boolean).slice(0, 13);
    const input = document.querySelector('#listing-tags-input') || inputByLabel(/^Tags/i, 'input');
    if (!input) throw new Error('找不到 tags 输入框');
    clickElement(input);
    nativeSetValue(input, normalized.join(', '));
    await wait(150);
    const add = Array.from(document.querySelectorAll('button'))
      .filter(button => /^Add$/i.test(clean(button.innerText || button.textContent)))
      .sort((a, b) => Math.abs(a.getBoundingClientRect().top - input.getBoundingClientRect().top) - Math.abs(b.getBoundingClientRect().top - input.getBoundingClientRect().top))[0];
    if (add) clickElement(add);
    else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
    await wait(1000);
  }

  function normalizeTag(tag) {
    const next = TAG_REPLACEMENTS.get(clean(tag)) || clean(tag);
    return next.length <= 20 ? next : next.slice(0, 20).trim();
  }

  async function selectCraftTypes() {
    const craftInput = findCraftInput();
    if (!craftInput) {
      log('找不到 Craft type 输入框，跳过');
      return;
    }
    document.body.click();
    await wait(250);
    for (const craftType of CRAFT_TYPES) {
      if (selectedCraftTypes().has(craftType)) continue;
      clickElement(craftInput);
      nativeSetValue(craftInput, '');
      await wait(150);
      nativeSetValue(craftInput, craftType.startsWith('Drawing') ? 'd' : 'p');
      await wait(700);
      const option = Array.from(document.querySelectorAll('[data-wt-menu-body] label, [data-wt-menu-body] li, [data-wt-menu-body] [role="option"], [data-wt-menu-body] div, [data-wt-menu-body] span'))
        .map(el => ({ el, text: clean(el.innerText || el.textContent), rect: el.getBoundingClientRect() }))
        .filter(item => item.rect.width > 20 && item.rect.height > 10 && item.rect.top >= 0 && item.rect.top <= window.innerHeight)
        .find(item => item.text === craftType)?.el;
      if (option) {
        await nativeClickElement(option);
        await wait(650);
        nativeSetValue(craftInput, '');
        await wait(150);
      } else {
        log(`缺少 Craft type 选项：${craftType}`);
      }
    }
    document.body.click();
    await wait(500);
  }

  function findCraftInput() {
    const inputs = Array.from(document.querySelectorAll('input[placeholder*="Type to search"], input[type="text"]'))
      .filter(input => input.offsetWidth > 80 && input.offsetHeight > 20);
    return inputs.find(input => /Craft type/i.test(clean(input.closest('section, div')?.innerText || ''))) || inputByLabel(/^Craft type/i, 'input');
  }

  function selectedCraftTypes() {
    const text = craftSelectedAreaText();
    return new Set(CRAFT_TYPES.filter(type => text.includes(type)));
  }

  function craftSelectedAreaText() {
    const bodyText = document.body.innerText || '';
    const start = bodyText.indexOf('Craft type');
    if (start < 0) return '';
    const ends = ['Occasion', 'Holiday', 'Price and inventory']
      .map(label => bodyText.indexOf(label, start))
      .filter(index => index > start);
    const end = ends.length ? Math.min(...ends) : start + 600;
    const section = bodyText.slice(start, end);
    const optionStart = section.search(/3D printing|Makeup & face painting|Paper quilling|Plastic canvas/i);
    return optionStart > 0 ? section.slice(0, optionStart) : section;
  }

  async function uploadDownloads(product) {
    log('上传 digital files');
    const addFile = buttonByText(/^Add file$/i);
    if (!addFile) throw new Error('找不到 Add file 按钮');
    await nativeClickElement(addFile);
    await wait(1200);
    await uploadDialog(product, 'download-files');
    await waitForDownloads(product);
  }

  async function waitForDownloads(product, timeout = 120000) {
    const names = (product.files?.downloadFiles || []).map(file => file.name);
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const text = document.body.innerText || '';
      if (names.every(name => text.includes(name))) return;
      await wait(1500);
    }
    throw new Error(`${product.sku} 下载文件未全部显示`);
  }

  async function finalVerify(product) {
    const expectedImages = (product.files?.main ? 1 : 0) + (product.files?.listingImages?.length || 0);
    const expectedVideos = product.files?.video ? 1 : 0;
    const media = countUploadedMedia();
    if (media.images < expectedImages || media.videos < expectedVideos) {
      throw new Error(`最终媒体数量不足：图片 ${media.images}/${expectedImages}，视频 ${media.videos}/${expectedVideos}`);
    }
    const text = document.body.innerText || '';
    if (!text.includes('All 13 used')) log('提示：Tags 未显示 All 13 used，请检查');
    if (!text.includes('All 5 selected')) log('提示：Craft type 未显示 All 5 selected，请检查');
  }

  async function saveDraft() {
    const button = buttonByText(/^Save as draft$/i);
    if (!button) throw new Error('找不到 Save as draft 按钮');
    await nativeClickElement(button);
    log('已点击 Save as draft，等待页面保存');
  }

  async function nativeClickElement(el) {
    if (!el) return false;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    await wait(250);
    const rect = el.getBoundingClientRect();
    const chromeY = window.outerHeight - window.innerHeight;
    await helperPost('/api/native-click', {
      x: window.screenX + rect.left + rect.width / 2,
      y: window.screenY + chromeY + rect.top + rect.height / 2
    });
    return true;
  }

  function nativeSetValue(el, value) {
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT'
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function clickElement(el) {
    if (!el) return false;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      }));
    }
    return true;
  }

  function clickRadioByValue(name, value, indexFallback) {
    let radio = document.querySelector(`input[type="radio"][name="${CSS.escape(name)}"][value="${CSS.escape(value)}"]`);
    if (!radio && Number.isInteger(indexFallback)) {
      radio = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`))[indexFallback];
    }
    return clickElement(radio);
  }

  function selectByText(selector, pattern) {
    const select = document.querySelector(selector);
    if (!select) return false;
    const option = Array.from(select.options).find(item => pattern.test(item.textContent));
    if (!option) return false;
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function inputByLabel(pattern, selector = 'input,textarea,select') {
    for (const label of Array.from(document.querySelectorAll('label'))) {
      if (!pattern.test(clean(label.innerText || label.textContent))) continue;
      const forId = label.getAttribute('for');
      const linked = forId ? document.getElementById(forId) : null;
      if (linked && linked.matches(selector)) return linked;
      const scoped = label.querySelector(selector);
      if (scoped) return scoped;
    }
    return null;
  }

  function buttonByText(pattern) {
    return Array.from(document.querySelectorAll('button,a[role="button"],label,[role="button"]'))
      .map(el => ({ el, text: clean(el.innerText || el.textContent || el.getAttribute('aria-label')) }))
      .find(item => pattern.test(item.text))?.el || null;
  }

  function textElement(pattern) {
    return Array.from(document.querySelectorAll('a, button, span, div'))
      .find(el => pattern.test(clean(el.innerText || el.textContent || el.getAttribute('aria-label'))));
  }

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function escapeAttr(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function escapeHtml(value) {
    return escapeAttr(value);
  }
})();
