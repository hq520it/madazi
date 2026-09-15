#!/usr/bin/env node
/**
 * madazi License 签发工具（厂商侧使用，私钥自持）
 *
 * 用法：
 *   生成密钥对（首次使用）：   node scripts/gen-license.mjs --gen-keys
 *   签发 License：            node scripts/gen-license.mjs --expires 2027-12-31 --plan professional --seats 10 --domain <YOUR-DOMAIN>.com --issued-to "某某公司"
 *   签发不限域名 License：    省略 --domain 即可（部署在任何域名都能激活）
 *
 * License Key 格式：base64url(payload) + '.' + base64url(RSA-SHA256 签名)
 * payload = { lk, plan, seats, exp, dom, iss }
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE_KEY_PATH = path.join(__dirname, 'keys', 'license-private.pem');
const PUBLIC_KEY_PATH = path.join(__dirname, 'keys', 'license-public.pem');

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? def) : def;
}

// 生成 RSA-2048 密钥对（PKCS#1 PEM）
if (args.includes('--gen-keys')) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  fs.mkdirSync(path.join(__dirname, 'keys'), { recursive: true });
  fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
  fs.writeFileSync(PUBLIC_KEY_PATH, publicKey);
  console.log('✅ 密钥对已生成：');
  console.log(`   私钥（厂商自持，勿外泄）: ${PRIVATE_KEY_PATH}`);
  console.log(`   公钥（已内置到 server，需提交）: ${PUBLIC_KEY_PATH}`);
  process.exit(0);
}

const plan = arg('--plan', 'professional');
const seats = parseInt(arg('--seats', '5'), 10);
const expires = arg('--expires', '');
const domain = arg('--domain', '') || null;
const issuedTo = arg('--issued-to', '') || null;

if (!expires) {
  console.error('用法: node scripts/gen-license.mjs --expires YYYY-MM-DD [--plan professional] [--seats 10] [--domain example.com] [--issued-to "公司名"]');
  process.exit(1);
}
if (!fs.existsSync(PRIVATE_KEY_PATH)) {
  console.error('❌ 未找到私钥，请先运行: node scripts/gen-license.mjs --gen-keys');
  process.exit(1);
}

const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');

// 人类可读的 License 编号：MDZ-XXXX-XXXX
const licenseNo = 'MDZ-' + crypto.randomBytes(4).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');

const payload = { lk: licenseNo, plan, seats, exp: expires, dom: domain, iss: issuedTo };
const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
const sig = crypto.sign('RSA-SHA256', Buffer.from(payloadB64), privateKey).toString('base64url');

console.log('\n┌─ License 信息 ─────────────────────────');
console.log(`│ 编号    : ${licenseNo}`);
console.log(`│ 套餐    : ${plan}`);
console.log(`│ 席位    : ${seats}`);
console.log(`│ 到期    : ${expires}`);
console.log(`│ 域名    : ${domain ?? '不限'}`);
console.log(`│ 客户    : ${issuedTo ?? '-'}`);
console.log('└────────────────────────────────────────');
console.log('\nLicense Key（发给客户，客户在激活页粘贴）:\n');
console.log(payloadB64 + '.' + sig);
console.log('');
