const WEBDRIVER_URL = process.env.WEBDRIVER_URL || 'http://127.0.0.1:4445';

async function createSession() {
  const res = await fetch(`${WEBDRIVER_URL}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capabilities: { alwaysMatch: { acceptInsecureCerts: true } } })
  });
  const data = await res.json();
  if (data.value?.error) throw new Error(JSON.stringify(data.value));
  return data.value.sessionId;
}

async function wd(sessionId, method, endpoint, body) {
  const res = await fetch(`${WEBDRIVER_URL}/session/${sessionId}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body || {}) : undefined
  });
  const data = await res.json();
  if (data.value?.error) throw new Error(JSON.stringify(data.value));
  return data.value;
}

async function main() {
  const buttonText = process.argv[2] || 'Upload';
  const sessionId = await createSession();
  const handles = await wd(sessionId, 'GET', '/window/handles');
  for (const handle of handles) {
    await wd(sessionId, 'POST', '/window', { handle });
    const url = await wd(sessionId, 'GET', '/url');
    if (url.includes('/listing-editor/create')) break;
  }
  await wd(sessionId, 'POST', '/execute/sync', {
    script: 'window.scrollTo(0, 0); return location.href;',
    args: []
  });
  await new Promise(resolve => setTimeout(resolve, 500));
  if (buttonText !== 'Upload') {
    const clicked = await wd(sessionId, 'POST', '/execute/sync', {
      script: `
        const text = arguments[0];
        const button = Array.from(document.querySelectorAll('button'))
          .find(item => (item.innerText || '').trim() === text);
        if (!button) return false;
        button.scrollIntoView({ block: 'center' });
        window.scrollBy(0, -180);
        return true;
      `,
      args: [buttonText]
    });
    if (!clicked) throw new Error(`Button not found: ${buttonText}`);
    await new Promise(resolve => setTimeout(resolve, 500));
    const element = await wd(sessionId, 'POST', '/element', {
      using: 'xpath',
      value: `//button[normalize-space()='${buttonText}']`
    });
    const id = element['element-6066-11e4-a52e-4f735466cecf'];
    await wd(sessionId, 'POST', `/element/${id}/click`);
    console.log(sessionId);
    return;
  }
  const element = await wd(sessionId, 'POST', '/element', {
    using: 'xpath',
    value: `//button[normalize-space()='${buttonText}']`
  });
  const id = element['element-6066-11e4-a52e-4f735466cecf'];
  await wd(sessionId, 'POST', `/element/${id}/click`);
  console.log(sessionId);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
