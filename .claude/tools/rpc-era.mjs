/**
 * An MCP session over a spawned server's stdio, in either protocol era — raw JSON-RPC lines, Node built-ins only (the
 * tools in this folder reach end users' disks and import no SDK; MCP 2.0 plan, Global Constraints).
 *
 * - `legacy` — the 2025 era: `initialize` (protocolVersion 2024-11-05, the oldest a 2025 server negotiates, so a
 *   bundle of any age answers it), then `notifications/initialized`.
 * - `modern` — revision 2026-07-28 (https://modelcontextprotocol.io/specification/2026-07-28): no `initialize`. The
 *   session opens with `server/discover`, and every request carries the revision, the client's info and its
 *   capabilities in `params._meta`. Frames captured from the SDK v2 client against the v2 bundle (2026-11-28, quota
 *   0): discover answers `supportedVersions: ["2026-07-28"]`, and each reply carries the server's info in its
 *   `_meta`. A bundle built on SDK v1 answers enveloped requests too (it ignores `_meta`) but answers
 *   `server/discover` with -32601 "Method not found" — so the opening asks discover first and reads
 *   `supportedVersions`, and anything else is "not served" (`error.notServed === true`), never a session that only
 *   looks modern. "Anything else" includes no reply within the timeout: the stdio binding's probe rules
 *   (basic/transports/stdio, "Backward Compatibility") count silence as a legacy server, as some answer an unknown
 *   request sent before `initialize` with an error and some not at all.
 */

export const LEGACY_VERSION = '2024-11-05';
export const MODERN_VERSION = '2026-07-28';
const META = 'io.modelcontextprotocol';
const DEFAULT_TIMEOUT_MS = 30_000;

/** "tools/call grok_auth_check: no reply within 30000 ms" — the grader's evidence says which tool it waited for. */
function defaultTimeoutMessage(method, ms, params) {
  const what = method === 'tools/call' && typeof params?.name === 'string' ? `${method} ${params.name}` : method;
  return `${what}: no reply within ${ms} ms`;
}

/**
 * Open a session on `child` (spawned with piped stdio). Resolves to
 * `{ era, protocolVersion, serverInfo, request(method, params) }`; `request` resolves with the whole JSON-RPC reply
 * (`{ result }` or `{ error }`) and rejects only on a timeout or when the server is gone.
 *
 * Options: `clientInfo`; `timeoutFor(method, params)` → milliseconds (default 30 s); `timeoutMessage(method, ms,
 * params)` → the text of a timeout's error (by default it names the tool a `tools/call` was for).
 */
export async function openSession(child, era, options = {}) {
  if (era !== 'legacy' && era !== 'modern') throw new Error(`unknown era: ${String(era)}`);
  const clientInfo = options.clientInfo ?? { name: 'rpc-era', version: '0' };
  const timeoutFor = options.timeoutFor ?? (() => DEFAULT_TIMEOUT_MS);
  const timeoutMessage = options.timeoutMessage ?? defaultTimeoutMessage;
  const pending = new Map();
  let gone;
  let buf = '';
  let nextId = 1;

  const fail = (reason) => {
    gone ??= new Error(reason);
    for (const [id, entry] of [...pending]) { pending.delete(id); entry.reject(gone); }
  };
  child.on('error', (e) => fail(`could not start the server: ${e.message}`));
  child.on('exit', (code, signal) => fail(`server exited before answering (code=${code}, signal=${signal})`));
  if (child.exitCode !== null || child.signalCode !== null) fail(`server exited before answering (code=${child.exitCode}, signal=${child.signalCode})`);
  // A write after the server has gone fails with EPIPE on stdin; unheard, that error would end the caller. The
  // 'exit' handler above says why the session ended.
  child.stdin.on('error', () => {});
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    for (let nl = buf.indexOf('\n'); nl !== -1; nl = buf.indexOf('\n')) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const entry = msg.id === undefined || msg.id === null ? undefined : pending.get(msg.id);
      if (entry) { pending.delete(msg.id); entry.resolve(msg); }
    }
  });

  const envelope = (params) => {
    if (era !== 'modern') return params;
    const p = params ?? {};
    return {
      ...p,
      _meta: {
        ...p._meta,
        [`${META}/protocolVersion`]: MODERN_VERSION,
        [`${META}/clientInfo`]: clientInfo,
        [`${META}/clientCapabilities`]: {},
      },
    };
  };
  const send = (frame) => child.stdin.write(JSON.stringify(frame) + '\n');
  const request = (method, params) => new Promise((resolve, reject) => {
    if (gone) { reject(gone); return; }
    const id = nextId++;
    const ms = timeoutFor(method, params);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(new Error(timeoutMessage(method, ms, params)), { timedOut: true }));
    }, ms);
    pending.set(id, {
      resolve: (m) => { clearTimeout(timer); resolve(m); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    const enveloped = envelope(params);
    send({ jsonrpc: '2.0', id, method, ...(enveloped === undefined ? {} : { params: enveloped }) });
  });

  if (era === 'legacy') {
    const opened = await request('initialize', { protocolVersion: LEGACY_VERSION, capabilities: {}, clientInfo });
    if (opened.error) throw Object.assign(new Error(`initialize failed: ${opened.error.message ?? opened.error.code}`), { reply: opened });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return { era, protocolVersion: opened.result?.protocolVersion, serverInfo: opened.result?.serverInfo, request };
  }
  let discovered;
  try {
    discovered = await request('server/discover', {});
  } catch (e) {
    // No reply in time: a legacy server (header). A server that EXITED is not that — it stays a failure.
    if (e?.timedOut) throw Object.assign(new Error(`the ${MODERN_VERSION} era is not served: ${e.message}`), { notServed: true });
    throw e;
  }
  const offered = discovered.result?.supportedVersions;
  if (discovered.error || !Array.isArray(offered) || !offered.includes(MODERN_VERSION)) {
    let why = `server/discover offered ${JSON.stringify(offered ?? null)}`;
    if (discovered.error) {
      const message = discovered.error.message ? ' ' + discovered.error.message : '';
      why = `server/discover answered ${discovered.error.code}${message}`;
    }
    throw Object.assign(new Error(`the ${MODERN_VERSION} era is not served: ${why}`), { notServed: true, reply: discovered });
  }
  return { era, protocolVersion: MODERN_VERSION, serverInfo: discovered.result?._meta?.[`${META}/serverInfo`], request };
}
