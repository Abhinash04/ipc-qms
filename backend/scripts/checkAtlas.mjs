import dns from 'node:dns';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { createRequire } from 'node:module';

const presetDatabaseUrl = Object.prototype.hasOwnProperty.call(process.env, 'DATABASE_URL');

const { default: env, ENV_SOURCE } = await import('../src/config/env.js');
const { databaseTarget } = await import('../src/config/db.js');
const { default: mongoose } = await import('mongoose');

const TEAM_DATABASE = 'query_management_system';
const PUBLIC_RESOLVERS = ['1.1.1.1', '8.8.8.8'];
const NETWORK_TIMEOUT_MS = 5000;
const SERVER_SELECTION_TIMEOUT_MS = 15000;

const args = process.argv.slice(2);
const flagValue = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] || null;
};
const dnsOverride = flagValue('--dns');
const showIp = args.includes('--show-ip');

const redact = (text) => String(text || '').replace(/\/\/\S*@/g, '//<credentials>@');
const truthy = (value) => String(value || '').trim().toLowerCase() === 'true';

let step = 0;
let exitCode = 0;

function heading(title) {
  step += 1;
  console.log(`\n${step}. ${title}`);
}
const ok = (text) => console.log(`   ok    ${text}`);
const info = (text) => console.log(`   info  ${text}`);
const warn = (text) => console.log(`   warn  ${text}`);

function fail(cause, fixes = []) {
  console.log(`   FAIL  ${cause}`);
  for (const fix of fixes) console.log(`         - ${fix}`);
  exitCode = 1;
}

function stop(cause, fixes) {
  fail(cause, fixes);
  console.log('\nStopped at the first failing check. Fix it and run `npm run db:check` again.\n');
  process.exit(1);
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${ms} ms`), { code: 'ETIMEOUT' })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function srvLookup(host, servers) {
  const resolver = new dns.promises.Resolver({ timeout: 2500, tries: 3 });
  resolver.setServers(servers);
  const records = await resolver.resolveSrv(`_mongodb._tcp.${host}`);
  const txt = await resolver.resolveTxt(host).catch((error) => (error.code === 'ENODATA' ? [] : Promise.reject(error)));
  return { records, options: txt.map((parts) => parts.join('')).join('&') };
}

function probeTcp(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(NETWORK_TIMEOUT_MS, () => done({ ok: false, reason: 'timed out' }));
    socket.once('connect', () => done({ ok: true }));
    socket.once('error', (error) => done({ ok: false, reason: error.code || error.message }));
  });
}

function probeTls(host, port) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(NETWORK_TIMEOUT_MS, () => done({ ok: false, reason: 'timed out' }));
    socket.once('secureConnect', () => done({ ok: true, protocol: socket.getProtocol() }));
    socket.once('error', (error) => done({ ok: false, reason: error.code || error.message }));
    socket.once('close', () => done({ ok: false, reason: 'closed by the server' }));
  });
}

async function publicIp() {
  try {
    const response = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
    return response.ok ? (await response.text()).trim() : null;
  } catch {
    return null;
  }
}

function userInfo(url) {
  const match = /^mongodb(?:\+srv)?:\/\/([^/?#]*)@/i.exec(url);
  return match ? match[1] : '';
}

function queryString(url) {
  const index = url.indexOf('?');
  return index === -1 ? '' : url.slice(index + 1);
}

function standardUri({ credentials, seeds, database, srvOptions, originalQuery }) {
  const params = new URLSearchParams(srvOptions);
  params.set('tls', 'true');
  for (const [key, value] of new URLSearchParams(originalQuery)) params.set(key, value);
  const auth = credentials ? `${credentials}@` : '';
  return `mongodb://${auth}${seeds.join(',')}/${database}?${params.toString()}`;
}

function driverVersion() {
  try {
    const requireFromMongoose = createRequire(createRequire(import.meta.url).resolve('mongoose'));
    return requireFromMongoose('mongodb/package.json').version;
  } catch {
    return 'unknown';
  }
}

function describeConnectError(error) {
  const text = `${error?.name || ''} ${error?.message || ''}`;
  if (error?.code === 18 || /auth(entication)? failed|bad auth/i.test(text)) return 'auth';
  if (/querySrv|ENOTFOUND|EAI_AGAIN|ECONNREFUSED.*_mongodb/i.test(text)) return 'dns';
  if (/ServerSelection|timed out|closed|ECONNRESET|ETIMEDOUT/i.test(text)) return 'network';
  return 'other';
}

console.log('\nIPC-QMS database connectivity check (read-only: nothing is written to the database)');

heading('Environment file');
if (!ENV_SOURCE) {
  stop('No env file was loaded from backend/.', ['Copy backend/.env.example to backend/.env.local and fill it in.']);
}
ok(`loaded ${path.relative(process.cwd(), ENV_SOURCE) || ENV_SOURCE}`);
if (presetDatabaseUrl) {
  warn('DATABASE_URL was already set in the shell or system environment, so the file value was NOT used.');
  warn('Remove it from the environment (or the IDE launch settings) to use the value in the env file.');
}
if (truthy(process.env.NIC_BROWSER_MAILBOX) && !truthy(process.env.NIC_BROWSER_VIEWER)) {
  warn('This backend is configured as the NICeMail mailbox host (NIC_BROWSER_MAILBOX=true without NIC_BROWSER_VIEWER=true).');
  warn('Only one developer may be the mailbox host. Teammates set NIC_BROWSER_VIEWER=true.');
} else if (truthy(process.env.NIC_BROWSER_VIEWER)) {
  ok('NICeMail viewer profile (NIC_BROWSER_VIEWER=true): this backend never syncs or sends mail');
}

heading('DATABASE_URL');
const url = String(env.DATABASE_URL || '').trim();
if (!url) {
  stop('DATABASE_URL is empty.', ['Set DATABASE_URL in backend/.env.local to the team Atlas connection string.']);
}
const target = databaseTarget(url);
if (!target || !target.hosts.length) {
  stop('DATABASE_URL is not a mongodb:// or mongodb+srv:// connection string.', ['Copy the string again from Atlas → Connect → Drivers.']);
}
const credentials = userInfo(url);
ok(`value (credentials hidden): ${redact(url)}`);
ok(`scheme ${target.srv ? 'mongodb+srv (needs a DNS SRV lookup)' : 'mongodb (standard seed list)'}`);
ok(`cluster ${target.hosts.join(', ')}`);
if (!target.name) {
  stop('DATABASE_URL names no database.', [`Add /${TEAM_DATABASE} after the host, before the "?".`]);
}
if (target.name === TEAM_DATABASE) {
  ok(`database ${target.name}`);
} else {
  warn(`database "${target.name}" is not the team database "${TEAM_DATABASE}" — a misspelled name opens a separate, empty database.`);
}
if (credentials) {
  ok('username and password present (not shown)');
} else {
  fail('DATABASE_URL carries no username or password.', ['Use the string from Atlas with your own database user.']);
}

heading('DNS');
const systemServers = dnsOverride ? [dnsOverride] : dns.getServers();
info(`Node's DNS servers${dnsOverride ? ' (--dns override)' : ''}: ${systemServers.join(', ') || '(none)'}`);
let seeds = target.hosts.map((host) => (/:\d+$/.test(host) ? host : `${host}:27017`));
let connectUri = url;
if (target.srv) {
  const clusterHost = target.hosts[0];
  let answer = null;
  try {
    answer = await srvLookup(clusterHost, systemServers);
    ok(`SRV record resolved through Node's DNS servers: ${answer.records.length} hosts`);
  } catch (error) {
    fail(`SRV lookup of _mongodb._tcp.${clusterHost} failed through Node's DNS servers: ${error.code || error.message}.`);
    for (const server of PUBLIC_RESOLVERS) {
      try {
        answer = await srvLookup(clusterHost, [server]);
        info(`the same lookup succeeds through public DNS ${server}, so the problem is this machine's DNS settings, not Atlas`);
        break;
      } catch (publicError) {
        info(`public DNS ${server} also failed: ${publicError.code || publicError.message}`);
      }
    }
    if (!answer) {
      stop('No DNS server reachable from this network can resolve the cluster.', [
        'This network blocks DNS (a corporate firewall, captive portal or restrictive ISP). Try another network or a phone hotspot.',
        'Or ask the network administrator to allow DNS (UDP and TCP port 53) and outbound TCP port 27017.',
      ]);
    }
    connectUri = standardUri({
      credentials,
      seeds: answer.records.map((record) => `${record.name}:${record.port}`),
      database: target.name,
      srvOptions: answer.options,
      originalQuery: queryString(url),
    });
    console.log('         Fix it one of two ways:');
    console.log('         A. Point the Wi-Fi/Ethernet adapter at DNS 1.1.1.1 and 8.8.8.8 (IPv4 settings), run `ipconfig /flushdns`,');
    console.log('            and turn off any VPN or DNS filter. Then run this check again.');
    console.log('         B. Or replace DATABASE_URL in your own backend/.env.local with the standard connection string below,');
    console.log('            which needs no SRV lookup. Put your own username and password in place of <user>:<password>:');
    console.log(`            ${redact(connectUri).replace('//<credentials>@', '//<user>:<password>@')}`);
    info('the remaining checks use that standard connection string to show whether option B would work here');
  }
  if (answer?.options) info(`cluster options from DNS: ${answer.options}`);
  seeds = answer.records.map((record) => `${record.name}:${record.port}`);
}
for (const seed of seeds) {
  const host = seed.replace(/:\d+$/, '');
  try {
    const { address } = await withTimeout(dns.promises.lookup(host), NETWORK_TIMEOUT_MS, `lookup ${host}`);
    ok(`${host} → ${address}`);
  } catch (error) {
    stop(`${host} does not resolve through the operating system resolver: ${error.code || error.message}.`, [
      'Check the adapter DNS settings, then run `ipconfig /flushdns`.',
    ]);
  }
}

heading('Network reachability (TCP, then TLS)');
const tcp = await Promise.all(seeds.map(async (seed) => ({ seed, ...(await probeTcp(seed.replace(/:\d+$/, ''), Number(seed.split(':').pop()))) })));
for (const result of tcp) {
  if (result.ok) ok(`TCP ${result.seed}`);
  else warn(`TCP ${result.seed}: ${result.reason}`);
}
if (!tcp.some((result) => result.ok)) {
  const ip = showIp ? await publicIp() : null;
  stop('No cluster host accepts a TCP connection on port 27017.', [
    `This network may block outbound port 27017 (corporate network, VPN, firewall), or Atlas Network Access does not list this machine's public IP${ip ? ` (${ip})` : ''}.`,
    'Ask the Atlas project owner to add your public IP under Network Access (run with --show-ip to print it).',
  ]);
}
const tlsResults = await Promise.all(
  tcp.filter((result) => result.ok).map(async (result) => ({
    seed: result.seed,
    ...(await probeTls(result.seed.replace(/:\d+$/, ''), Number(result.seed.split(':').pop()))),
  })),
);
for (const result of tlsResults) {
  if (result.ok) ok(`TLS ${result.seed} (${result.protocol})`);
  else warn(`TLS ${result.seed}: ${result.reason}`);
}
if (!tlsResults.some((result) => result.ok)) {
  const ip = showIp ? await publicIp() : null;
  stop('TCP connects but the TLS handshake is refused on every host.', [
    `Atlas Network Access most likely does not list this machine's public IP${ip ? ` (${ip})` : ''} — Atlas drops connections from unlisted addresses.`,
    'A TLS-inspecting proxy or antivirus can cause this too; turn it off for this test.',
  ]);
}

heading('Access list and credentials');
if (showIp) {
  const ip = await publicIp();
  info(`this machine's public IP: ${ip || 'unknown (api.ipify.org unreachable)'} — it must be listed under Atlas → Network Access`);
}
const { MongoClient } = mongoose.mongo;
const client = new MongoClient(connectUri, { serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS, appName: 'ipc-qms-db-check' });
try {
  await client.connect();
  await client.db('admin').command({ ping: 1 });
  ok('authenticated and ping answered');
} catch (error) {
  await client.close().catch(() => {});
  const kind = describeConnectError(error);
  const message = redact(String(error?.message || error).split('\n')[0]);
  if (kind === 'auth') {
    stop(`Atlas rejected the username or password: ${message}`, [
      'Use your own Atlas database user (Atlas → Database Access), with readWrite on the team database.',
      'If the shared password was rotated, get the current one over a secure channel.',
    ]);
  }
  if (kind === 'network') {
    const ip = showIp ? await publicIp() : null;
    stop(`The driver could not reach a usable cluster member: ${message}`, [
      `Atlas Network Access most likely does not list this machine's public IP${ip ? ` (${ip})` : ''}.`,
    ]);
  }
  stop(`The driver could not connect: ${message}`);
}

heading('Driver');
const hello = await client.db('admin').command({ hello: 1 });
ok(`Node ${process.version}, mongodb driver ${driverVersion()}, mongoose ${mongoose.version}`);
ok(`replica set ${hello.setName || '(none)'}, primary ${hello.primary || '(unknown)'}`);

heading('Shared-database fingerprint (compare with every other developer)');
const database = client.db(target.name);
const collections = (await database.listCollections({}, { nameOnly: true }).toArray()).map((row) => row.name);
const counted = {};
for (const name of ['querycases', 'mailboxmessages', 'auditevents', 'users']) {
  counted[name] = collections.includes(name) ? await database.collection(name).countDocuments({}) : 0;
}
const [newest] = collections.includes('querycases')
  ? await database
      .collection('querycases')
      .find({}, { projection: { _id: 0, queryId: 1, updatedAt: 1 } })
      .sort({ updatedAt: -1 })
      .limit(1)
      .toArray()
  : [];
await client.close();
if (!collections.length) {
  warn(`database "${target.name}" has no collections — check the name; the team database is ${TEAM_DATABASE}.`);
}
const fingerprint = [
  `cluster=${target.hosts[0]}`,
  `replicaSet=${hello.setName || '-'}`,
  `db=${target.name}`,
  `collections=${collections.length}`,
  ...Object.entries(counted).map(([name, count]) => `${name}=${count}`),
  `newest=${newest ? `${newest.queryId}@${newest.updatedAt}` : '-'}`,
].join(' ');
ok(fingerprint);

if (exitCode) {
  console.log('\nThe database is reachable only through the workaround above. `npm start` with the current DATABASE_URL will fail until you apply fix A or B.\n');
} else {
  console.log('\nAll checks passed. `npm start` will reach this database. Another developer on the same database prints the same fingerprint.\n');
}
process.exit(exitCode);
