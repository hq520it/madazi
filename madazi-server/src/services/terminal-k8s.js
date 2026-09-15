// ═══════════════_terminal-k8s.js═══════════════
// K8s 终端 exec：WebSocket v1.channel.k8s.io（裸 https + crypto，零依赖）
// 协议：WS 帧首字节为 channel 编号（0=stdin, 1=stdout, 2=stderr, 3=error, 4=resize）
import https from 'https';
import fs from 'fs';
import crypto from 'crypto';

const NAMESPACE = process.env.K8S_NAMESPACE || 'madazi';

/**
 * 在 preview Pod 内执行交互式 shell（K8s exec over WebSocket）。
 * @param {string} projectId
 * @param {object} opts { onOpen, onOutput(chunk), onExit(code), onError(msg) }
 * @returns {{ write(data), resize(cols,rows), destroy() }}
 */
export function execPreviewPodShell(projectId, opts) {
  const shortId = projectId.slice(0, 8);
  const podName = `madazi-preview-${shortId}`;
  const saToken = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8').trim();
  const caCert = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
  const host = process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc';
  const port = Number(process.env.KUBERNETES_SERVICE_PORT || 443);

  // ★ K8s exec API 不支持 workingDir 参数，用 cd 切到项目目录再起 shell
  //   预览 Pod 项目代码挂载在 /data/{projectDirName}（与 Docker 模式 WorkingDir 一致）
  const dir = opts.projectDirName ? `/data/${opts.projectDirName}` : '/data';
  const cmds = ['sh', '-c', `cd ${dir} 2>/dev/null || cd /data; exec $(command -v bash || command -v sh)`];
  const params = new URLSearchParams();
  // K8s exec API 要求 command 为多次参数（数组语义），不能用 set 拼接
  params.delete('command');
  for (const c of cmds) params.append('command', c);
  params.set('container', 'preview');
  params.set('stdout', 'true');
  params.set('stderr', 'true');
  params.set('stdin', 'true');
  // ★ 一次性命令（execPreviewPodCommand）用非 tty：tty 下 su/psql 会从终端读输入 → Status 错误
  params.set('tty', opts.tty === false ? 'false' : 'true');
  const path = `/api/v1/namespaces/${NAMESPACE}/pods/${podName}/exec?${params}`;

  let socket = null;
  let closed = false;

  const req = https.request({
    hostname: host,
    port,
    path,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${saToken}`,
      'Connection': 'Upgrade',
      'Upgrade': 'websocket',
      'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
      'Sec-WebSocket-Version': '13',
      // ★ K3s 的 SPDY 翻译层拒绝 v1.channel.k8s.io（403），必须用 v5
      'Sec-WebSocket-Protocol': 'v5.channel.k8s.io',
    },
    ca: caCert,
  });

  let buf = Buffer.alloc(0);

  function handleData(chunk) {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      if (buf.length < 2) return;
      const b0 = buf[0];
      const b1 = buf[1];
      const opcode = b0 & 0x0f;
      const masked = !!(b1 & 0x80);
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      const totalLen = off + len + (masked ? 4 : 0);
      if (buf.length < totalLen) return;
      let payload = buf.slice(off, off + len);
      if (masked) {
        const mask = buf.slice(off + len, off + len + 4);
        const unmasked = Buffer.alloc(len);
        for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ mask[i % 4];
        payload = unmasked;
      }
      buf = buf.slice(totalLen);
      processFrame(opcode, payload);
    }
  }

  function processFrame(opcode, payload) {
    if (opcode === 0x1 || opcode === 0x2) {
      if (!payload.length) return;
      const channel = payload[0];
      const data = payload.slice(1);
      if (channel === 1 && data.length) {
        opts.onOutput?.(data.toString('utf-8'));
      } else if (channel === 2 && data.length) {
        opts.onOutput?.(data.toString('utf-8'));
      } else if (channel === 3) {
        // K8s Status JSON：exec 结束时总会发一个 Status（无论成败）
        // ★ Success = 正常结束（此前误判为错误，导致 execPreviewPodCommand 丢失已成功的输出）
        try {
          const status = JSON.parse(data.toString('utf-8'));
          if (status.status === 'Failure') {
            opts.onError?.(status.message || 'exec failed');
            opts.onExit?.(1);
          } else {
            opts.onExit?.(0);
          }
        } catch {
          opts.onError?.(data.toString('utf-8'));
          opts.onExit?.(1);
        }
        destroy();
      }
    } else if (opcode === 0x8) {
      // close frame
      opts.onExit?.(0);
      destroy();
    }
  }

  function maskFrame(opcode, payload) {
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
    return Buffer.concat([header, mask, masked]);
  }

  function destroy() {
    if (closed) return;
    closed = true;
    try { socket?.destroy(); } catch {}
    try { req.destroy(); } catch {}
  }

  req.on('upgrade', (res, s, head) => {
    socket = s;
    opts.onOpen?.();
    if (head && head.length) handleData(head);
    socket.on('data', handleData);
    socket.on('close', () => { opts.onExit?.(0); destroy(); });
    socket.on('error', (e) => { opts.onError?.(e.message); destroy(); });
  });
  req.on('response', (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => {
      opts.onError?.(`K8s exec 拒绝 (HTTP ${res.statusCode}): ${body.slice(0, 300)}`);
      opts.onExit?.(1);
      destroy();
    });
  });
  req.on('error', (e) => {
    opts.onError?.(e.message);
    opts.onExit?.(1);
    destroy();
  });
  req.end();

  return {
    write(data) {
      // stdin channel 0
      socket?.write(maskFrame(0x1, Buffer.concat([Buffer.from([0]), Buffer.from(data, 'utf-8')])));
    },
    resize(cols, rows) {
      // resize channel 4，payload = JSON {Width, Height}
      socket?.write(maskFrame(0x1, Buffer.concat([Buffer.from([4]), Buffer.from(JSON.stringify({ Width: cols, Height: rows }))])));
    },
    destroy,
  };
}

/**
 * ★ 在 preview Pod 内执行一次性命令并返回输出（替代原 docker exec；HMR 触发等用）。
 * 基于 v5.channel.k8s.io WebSocket，复用 execPreviewPodShell 的升级握手与帧协议。
 * @param {string} projectId
 * @param {string} command   shell 命令（sh -c）
 * @param {object} [opts]    { projectDirName, timeoutMs }
 * @returns {Promise<{code:number, output:string}>}
 */
export function execPreviewPodCommand(projectId, command, opts = {}) {
  const { projectDirName, timeoutMs = 30000 } = opts;
  return new Promise((resolve, reject) => {
    let out = '';
    let timer = null;
    const shell = execPreviewPodShell(projectId, {
      projectDirName,
      tty: false,
      onOpen() {
        // ★ 必须在 socket 就绪后再写命令：execPreviewPodShell 的 write 用 socket?.write，
        //   upgrade 未完成时 socket 为 null，立即 write 会静默丢命令 → 容器不执行 → 超时。
        shell.write(`${command}\nexit\n`);
      },
      onOutput(chunk) {
        out += chunk.toString('utf-8');
      },
      onExit(code) {
        if (timer) clearTimeout(timer);
        resolve({ code: code ?? 0, output: out });
      },
      onError(msg) {
        if (timer) clearTimeout(timer);
        reject(new Error(msg));
      },
    });
    timer = setTimeout(() => {
      shell.destroy();
      reject(new Error(`exec timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}
