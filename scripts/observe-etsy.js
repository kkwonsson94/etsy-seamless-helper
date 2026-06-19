const fs = require('fs');

const sessionId = process.env.WEBDRIVER_SESSION_ID;
const handle = process.env.WEBDRIVER_WINDOW_HANDLE;
const webdriverUrl = process.env.WEBDRIVER_URL || 'http://127.0.0.1:4445';
const outputPath = process.env.OUTPUT_PATH || 'tmp-etsy-observe.json';

if (!sessionId) {
  console.error('Missing WEBDRIVER_SESSION_ID');
  process.exit(1);
}

async function wd(method, path, body) {
  const res = await fetch(`${webdriverUrl}/session/${sessionId}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (data.value && data.value.error) throw new Error(JSON.stringify(data.value));
  return data.value;
}

async function main() {
  if (handle) await wd('POST', '/window', { handle });

  const script = `
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const elementTop = el => Math.round(el.getBoundingClientRect().top + window.scrollY);

    const sections = Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"]'))
      .map(el => ({ text: clean(el.innerText || el.textContent), top: elementTop(el) }))
      .filter(item => item.text);

    const buttons = Array.from(document.querySelectorAll('button,a[role="button"],a'))
      .map(el => ({
        text: clean(el.innerText || el.textContent || el.getAttribute('aria-label')),
        aria: el.getAttribute('aria-label') || '',
        tag: el.tagName.toLowerCase(),
        href: el.getAttribute('href') || '',
        top: elementTop(el)
      }))
      .filter(item => item.text || item.aria)
      .slice(0, 260);

    const fields = Array.from(document.querySelectorAll('input,textarea,select'))
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        name: el.name || '',
        id: el.id || '',
        placeholder: el.placeholder || '',
        aria: el.getAttribute('aria-label') || '',
        value: clean(el.value).slice(0, 240),
        checked: Boolean(el.checked),
        top: elementTop(el)
      }))
      .slice(0, 260);

    const labels = Array.from(document.querySelectorAll('label'))
      .map(el => ({ text: clean(el.innerText || el.textContent), forAttr: el.getAttribute('for') || '', top: elementTop(el) }))
      .filter(item => item.text)
      .slice(0, 260);

    return {
      url: location.href,
      title: document.title,
      scrollY: window.scrollY,
      sections,
      buttons,
      fields,
      labels,
      text: document.body.innerText.slice(0, 40000)
    };
  `;

  const data = await wd('POST', '/execute/sync', { script, args: [] });
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf8');

  console.log(JSON.stringify({
    url: data.url,
    title: data.title,
    sectionCount: data.sections.length,
    buttonCount: data.buttons.length,
    fieldCount: data.fields.length,
    labelCount: data.labels.length,
    textLength: data.text.length
  }, null, 2));
  console.log(data.sections.map(section => section.text).join(' | '));
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
