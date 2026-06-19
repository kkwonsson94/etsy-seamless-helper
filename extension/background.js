chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'helper') return false;

  handleHelperMessage(message)
    .then(sendResponse)
    .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));

  return true;
});

async function handleHelperMessage(message) {
  const baseUrl = (message.baseUrl || 'http://127.0.0.1:8788').replace(/\/$/, '');
  if (message.action !== 'json') throw new Error('Unknown helper action');
  const data = await requestJson(baseUrl + message.path, message.token, message.method, message.body);
  return { ok: true, data };
}

function requestJson(url, token, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method || 'GET', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (token) xhr.setRequestHeader('X-Local-Token', token);
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        reject(new Error('Helper returned non-JSON response'));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300 || data.ok === false) {
        reject(new Error(data.error || `Helper request failed: ${xhr.status}`));
        return;
      }
      resolve(data);
    };
    xhr.onerror = () => reject(new Error('Cannot connect to local helper'));
    xhr.send(body ? JSON.stringify(body) : undefined);
  });
}
