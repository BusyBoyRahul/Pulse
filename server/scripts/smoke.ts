/**
 * Pulse backend smoke test.
 *
 * Drives the full pipeline against a RUNNING server (start it with `npm run dev`
 * in another terminal first):
 *   OTP login -> add contact -> sealed SOS relay -> contact fan-out -> dedup.
 *
 * Run:  npm run smoke
 */
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

const BASE = process.env.PULSE_BASE ?? 'http://localhost:4000';
const SERVER_PUB = 'bIlyAH2kjGQQd/sFW5IcATCEkWvuz37jU5nGqqiIFHc=';

// Unique-per-run identifiers so every smoke test shows a fresh delivery.
const stamp = Date.now();
const phone = `+1555${String(stamp).slice(-7)}`;
const victim = nacl.box.keyPair();
const victimPub = naclUtil.encodeBase64(victim.publicKey);
const packetId = `${stamp}-2222-4333-8444-555555555555`.slice(0, 36);

function appSeal(message: string, recipientPub: string): string {
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const c = nacl.box(naclUtil.decodeUTF8(message), nonce, naclUtil.decodeBase64(recipientPub), eph.secretKey);
  const blob = {
    e: naclUtil.encodeBase64(eph.publicKey),
    n: naclUtil.encodeBase64(nonce),
    c: naclUtil.encodeBase64(c),
  };
  return naclUtil.encodeBase64(naclUtil.decodeUTF8(JSON.stringify(blob)));
}

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? {Authorization: `Bearer ${token}`} : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {status: res.status, data: (await res.json().catch(() => ({}))) as any};
}

function line(ok: boolean, label: string, detail: string) {
  console.log(`${ok ? '✅' : '❌'}  ${label.padEnd(22)} ${detail}`);
}

async function main() {
  console.log(`\nPulse smoke test -> ${BASE}\n`);

  const health = await call('GET', '/health');
  line(health.data.db === true, 'Health / DB', JSON.stringify(health.data));
  if (!health.data.ok) {
    console.log('\n⚠  Server not healthy. Is `npm run dev` running and MySQL started in XAMPP?\n');
    process.exit(1);
  }

  const otp = await call('POST', '/auth/request-otp', {phone});
  line(otp.data.ok === true, 'Request OTP', `devMode=${otp.data.devMode} (code 000000)`);

  const verify = await call('POST', '/auth/verify-otp', {
    phone,
    code: '000000',
    displayName: 'Smoke Test',
    meshPublicKey: victimPub,
  });
  const token = verify.data.token as string;
  line(!!token, 'Verify OTP', `user id=${verify.data.user?.id}, phone=${phone}`);

  const add = await call('POST', '/contacts', {name: 'Emergency Contact', phoneNumber: '+15559990000'}, token);
  line(add.status === 201 || add.status === 409, 'Add contact', `status=${add.status}`);

  const list = await call('GET', '/contacts', undefined, token);
  line(Array.isArray(list.data.contacts), 'List contacts', `${list.data.contacts?.length} in circle`);

  const payload = appSeal(JSON.stringify({lat: 40.7128, lng: -74.006, accuracy: 8, name: phone}), SERVER_PUB);
  const relay = await call('POST', '/sos/relay', {packetId, origin: victimPub, payload, originTimestamp: stamp}, token);
  line(relay.data.delivered === true, 'SOS relay', JSON.stringify(relay.data));

  const dup = await call('POST', '/sos/relay', {packetId, origin: victimPub, payload}, token);
  line(dup.data.duplicate === true, 'SOS dedup', 'same packet ignored (not re-sent)');

  console.log('\n👉  Check the `npm run dev` terminal — you should see the [sms:dev] alert with a maps link.\n');
}

main().catch(e => {
  console.error('\n❌ Smoke test could not reach the server:', e.message);
  console.error('   Start it first:  cd server ; npm run dev\n');
  process.exit(1);
});
