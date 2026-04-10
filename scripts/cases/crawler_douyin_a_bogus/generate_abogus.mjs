import {createConnection} from 'node:net';

const SOCKET_PATH = '/tmp/js-reverse-mcp.sock';

function sendCommand(request) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(SOCKET_PATH);
    let response = '';
    socket.on('data', chunk => {
      response += chunk.toString();
    });
    socket.on('end', () => {
      try {
        const jsonStr = response.trim().replace(/\0$/, '');
        const parsed = JSON.parse(jsonStr);
        if (parsed.error) {
          reject(new Error(parsed.error));
        } else {
          resolve(parsed);
        }
      } catch (e) {
        reject(new Error('Failed to parse: ' + response));
      }
    });
    socket.on('error', reject);
    socket.write(JSON.stringify(request));
  });
}

/**
 * Generate a_bogus by building a request URL and letting the browser's
 * bdms.js VM intercept it via the pre-installed URLSearchParams hook.
 */
async function generateABogus(url) {
  // Use XMLHttpRequest to trigger bdms.js's XHR interception
  const result = await sendCommand({
    method: 'invoke_tool',
    tool: 'cdp_eval',
    args: {
      expr: `
(function() {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '${url}', true);
    xhr.onload = function() {
      resolve({ status: xhr.status, data: xhr.responseText.substring(0, 2000) });
    };
    xhr.onerror = function() {
      resolve({ status: 0, error: 'Network error' });
    };
    xhr.send();
  });
})()
      `,
    },
  });

  return result;
}

/**
 * Get captured a_bogus values from the hook
 */
async function getCapturedValues() {
  return sendCommand({
    method: 'invoke_tool',
    tool: 'cdp_eval',
    args: {
      expr: `
(function() {
  if (!window.__a_bogus_capture) return { error: 'hooks not installed' };
  return {
    count: window.__a_bogus_capture.values.length,
    values: window.__a_bogus_capture.values.slice(-5).map(v => ({
      name: v.name,
      value: v.value,
      ts: v.ts
    })),
    xhrUrls: window.__a_bogus_capture.xhrUrls.slice(-5)
  };
})()
      `,
    },
  });
}

async function main() {
  console.log('=== Douyin a_bogus Reverse Engineering ===\n');

  // Check captured values
  console.log('[1/3] Getting captured a_bogus values...');
  const captured = await getCapturedValues();
  console.log('Captured:', captured);

  console.log('\n[2/3] Making test request...');
  const result = await generateABogus(
    'https://www.douyin.com/aweme/v1/web/solution/resource/list/?spot_keys=test&app_id=6383',
  );
  console.log('Result:', result);

  // Show final captured values
  console.log('\n[3/3] Final captured values after test request...');
  const finalCaptured = await getCapturedValues();
  console.log('Final:', JSON.stringify(finalCaptured, null, 2));
}

main().catch(e => console.error('Error:', e.message));
