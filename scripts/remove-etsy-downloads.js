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
  const sessionId = await createSession();
  const handles = await wd(sessionId, 'GET', '/window/handles');
  for (const handle of handles) {
    await wd(sessionId, 'POST', '/window', { handle });
    const url = await wd(sessionId, 'GET', '/url');
    if (url.includes('/listing-editor/create')) break;
  }
  const count = await wd(sessionId, 'POST', '/execute/sync', {
    script: `
      const buttons = Array.from(document.querySelectorAll('button'))
        .filter(button => ((button.innerText || button.getAttribute('aria-label') || '').trim() === 'Remove'));
      let count = 0;
      for (const button of buttons.slice(0, 2)) {
        button.scrollIntoView({ block: 'center' });
        button.click();
        count++;
      }
      return count;
    `,
    args: []
  });
  await new Promise(resolve => setTimeout(resolve, 1000));
  await wd(sessionId, 'DELETE', '');
  console.log(`removed ${count}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
