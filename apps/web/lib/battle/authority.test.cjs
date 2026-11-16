const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Exercise the shipped TypeScript directly without introducing a browser test
// framework. Only transport/React hooks and clocks are replaced at the boundary.
function load(file, dependencies = {}, bindings = {}) {
  const source = ts.transpileModule(readFileSync(path.resolve(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  const resolve = (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name.endsWith('.json')) {
      const json = JSON.parse(readFileSync(path.resolve(__dirname, path.dirname(file), name), 'utf8'));
      return { __esModule: true, default: json };
    }
    if (name.startsWith('.')) return load(path.join(path.dirname(file), `${name}.ts`));
    throw new Error(`Unexpected dependency ${name}`);
  };
  new Function('require', 'module', 'exports', ...Object.keys(bindings), source)(
    resolve, module, module.exports, ...Object.values(bindings),
  );
  return module.exports;
}
const typeChart = load('typeChart.ts');
const roster = load('roster.ts');
const { applyBattleEvent } = load('BattleEngine.ts', { react: {} });
const move = (pp = 1) => ({ id: 'tackle', name: 'Tackle', type: 'Normal', category: 'physical', power: 40, accuracy: 100, pp, maxPp: pp });
const creature = (types = ['Normal']) => ({ id: 'one', species: 'Ditto', spriteId: 'ditto', types, level: 50, speed: 50,
  hp: 200, maxHp: 200, stats: { atk: 100, def: 100, spa: 100, spd: 100 }, moves: [move()], fainted: false });
function initial() {
  return { type: 'init', state: { id: 'test', turn: 1, you: 'p1', format: { name: 'Test', rated: false, rules: [] },
    users: [], pendingChoice: null, winner: null, timer: { enabled: false, secondsLeft: null, secondsPerTurn: 150 },
    sides: { p1: { trainer: { name: 'Ash' }, activeIndex: 0, team: [creature()] },
      p2: { trainer: { name: 'Misty' }, activeIndex: 0, team: [creature(['Ghost'])] } } } };
}

test('replay installs Struggle after PP exhaustion, then logs the actual fallback', () => {
  const init = initial();
  const events = [init, { type: 'move', side: 'p1', moveIndex: 0, ppLeft: 0 },
    { type: 'moves', side: 'p1', moves: [roster.createStruggleMove()] },
    { type: 'move', side: 'p1', moveIndex: 0, ppLeft: 1 },
    { type: 'damage', side: 'p2', hp: 180, effectiveness: 'normal', crit: false },
    { type: 'damage', side: 'p1', hp: 150, effectiveness: 'normal', crit: false }];
  const live = events.reduce(applyBattleEvent, null);
  const { applyBattleEvent: replayEvent } = load("BattleEngine.ts", { react: {} });
  const replay = JSON.parse(JSON.stringify(events)).reduce(replayEvent, null);
  assert.deepEqual(live, replay);
  assert.equal(live.sides.p1.team[0].moves[0].name, 'Struggle');
  assert.match(live.log.findLast((entry) => entry.kind === 'move').text, /Struggle/);
  assert.equal(init.state.sides.p1.team[0].moves[0].pp, 1);
});

test('server effect events update the visible battle and replay state', () => {
  const events = [initial(),
    { type: 'status', side: 'p1', status: 'burn' },
    { type: 'volatile', side: 'p1', volatile: 'confusion', active: true },
    { type: 'boost', side: 'p1', stat: 'atk', change: 2, stage: 2 },
    { type: 'heal', side: 'p2', hp: 190 },
    { type: 'weather', weather: 'rain', turns: 5 },
    { type: 'damage', side: 'p1', hp: 175, effectiveness: 'normal', crit: false, cause: 'burn' }];
  const state = events.reduce(applyBattleEvent, null);
  assert.equal(state.sides.p1.team[0].status, 'burn');
  assert.equal(state.sides.p1.team[0].confused, 1);
  assert.equal(state.sides.p1.team[0].boosts.atk, 2);
  assert.equal(state.sides.p1.team[0].hp, 175);
  assert.equal(state.sides.p2.team[0].hp, 190);
  assert.equal(state.weather, 'rain');
  assert.match(state.log.at(-1).text, /burn/);
  const replayed = JSON.parse(JSON.stringify(events)).reduce(applyBattleEvent, null);
  assert.deepEqual(replayed.sides, state.sides);
  assert.equal(replayed.weather, state.weather);
});

test('retained offline engine uses typeless Struggle, recoil, and the same moves event', () => {
  const timers = [];
  const rules = load('rules.ts', { './typeChart': typeChart });
  const { MockBattleStream } = load('MockBattleStream.ts', { './roster': roster, './rules': rules }, {
    setTimeout: (callback) => { timers.push(callback); return timers.length; }, clearTimeout: () => {},
  });
  const stream = new MockBattleStream({ you: { name: 'Ash' }, teams: { p1: [], p2: [] } });
  stream.sides = initial().state.sides;
  const events = [];
  stream.listener = (event) => events.push(event);
  stream.performMove('p1', 0);
  while (timers.length) timers.shift()();
  assert.equal(events.find((e) => e.type === 'moves').moves[0].id, 'struggle');
  const before = stream.sides.p1.team[0].hp;
  stream.performMove('p1', 0);
  while (timers.length) timers.shift()();
  assert.ok(stream.sides.p2.team[0].hp < 200, 'Ghost takes fallback damage');
  assert.equal(stream.sides.p1.team[0].hp, before - 50);
  const normal = creature(['Normal']);
  const water = creature(['Water']);
  assert.deepEqual(rules.computeDamage(normal, creature(['Ghost']), roster.createStruggleMove(), () => 0.5),
    rules.computeDamage(water, creature(['Rock']), roster.createStruggleMove(), () => 0.5));
});

const request = { player: 'Ash', rating: 9999, format: 'champion', tier: 1, entry: 5, team: [] };
const matched = { status: 'matched', id: 'BATTLE', token: 'token', side: 'p1',
  you: { trainer: { name: 'Ash' }, rating: 1200, team: [] },
  opponent: { trainer: { name: 'Misty' }, rating: 1300, wins: 7, losses: 3, team: [] } };
class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
function matchmaking(apiRequest, timers = []) {
  const { ServerMatchmakingService } = load('../match/ServerMatchmakingService.ts', {
    '../battle/battleApi': { apiRequest, ApiError }, '../rank/RankService': { tierFor: () => 'Bronze' },
  }, { setTimeout: (callback) => { timers.push(callback); return timers.length; } });
  return new ServerMatchmakingService();
}

test('offline Struggle recoil knock-out faints the attacker and ends the battle like the server', () => {
  const timers = [];
  const rules = load('rules.ts', { './typeChart': typeChart });
  const { MockBattleStream } = load('MockBattleStream.ts', { './roster': roster, './rules': rules }, {
    setTimeout: (callback) => { timers.push(callback); return timers.length; }, clearTimeout: () => {},
  });
  const stream = new MockBattleStream({ you: { name: 'Ash' }, teams: { p1: [], p2: [] } });
  stream.sides = initial().state.sides;
  const attacker = stream.sides.p1.team[0];
  attacker.moves = [{ ...roster.createStruggleMove(), accuracy: 0 }]; // exercise the miss path
  attacker.hp = 40;
  const events = [];
  stream.listener = (event) => events.push(event);
  stream.performMove('p1', 0);
  while (timers.length) timers.shift()();
  assert.equal(attacker.hp, 0);
  assert.equal(attacker.fainted, true);
  assert.deepEqual(events.filter((e) => e.type === 'faint').map((e) => e.side), ['p1']);
  assert.equal(events.find((e) => e.type === 'win').winner, 'p2');
});

test('cancel during sleep collects a concurrently paired ticket and actual opponent records', async () => {
  const calls = [], timers = [];
  const service = matchmaking(async (method) => {
    calls.push(method);
    return method === 'POST' ? { status: 'searching', ticket: 'ticket' } : method === 'GET' ? matched : { ok: true };
  }, timers);
  const search = service.find(request);
  await Promise.resolve();
  search.cancel();
  timers.shift()();
  const ticket = await search.result;
  assert.equal(ticket.live.battleId, matched.id);
  assert.equal(ticket.you.rating, 1200);
  assert.equal(ticket.opponent.wins, 7);
  assert.ok(calls.indexOf('GET') > calls.indexOf('DELETE'));
});

test('cancel while POST is in flight accepts its already matched reply', async () => {
  let resolvePost;
  const service = matchmaking(() => new Promise((resolve) => { resolvePost = resolve; }));
  const search = service.find(request);
  search.cancel();
  resolvePost(matched);
  assert.equal((await search.result).matchId, matched.id);
});

test('cancelled unpaired search tolerates final GET 404 and rejects cancellation', async () => {
  const calls = [], timers = [];
  const service = matchmaking(async (method) => {
    calls.push(method);
    if (method === 'GET') throw new ApiError('expired', 404);
    return method === 'POST' ? { status: 'searching', ticket: 'ticket' } : { ok: true };
  }, timers);
  const search = service.find(request);
  await Promise.resolve();
  search.cancel();
  timers.shift()();
  await assert.rejects(search.result, /cancelled/);
  assert.ok(calls.includes('GET'));
});

test('server species requests deduplicate only in flight and refetch after completion', async () => {
  let requests = 0;
  const { ServerSpeciesService } = load('../pokemon/SpeciesService.ts', {
    '../battle/battleApi': { apiRequest: async () => ({ key: 'ditto', version: ++requests }) },
    '../battle/roster': roster, './cache': { cached: () => { throw new Error('must not use localStorage'); } },
  });
  const service = new ServerSpeciesService();
  const first = service.getSpecies('ditto');
  assert.equal(first, service.getSpecies('ditto'));
  assert.equal((await first).version, 1);
  assert.equal((await service.getSpecies('ditto')).version, 2);
});

test('presentation keeps summon audio and sprites without overriding server combat fields', async () => {
  const authoritative = { key: 'ditto', base: { hp: 48 }, moves: [{ id: 'struggle' }],
    sprites: { frontStatic: 'server-front' }, artwork: 'server-art', cry: null };
  const { ServerSpeciesService } = load('../pokemon/SpeciesService.ts', {
    '../battle/battleApi': { apiRequest: async () => authoritative },
    '../battle/roster': roster,
    './cache': { cached: async () => ({
      stats: [{ base_stat: 99999 }], moves: [{ move: { name: 'tampered' } }],
      sprites: { front_default: 'actual-front', back_default: 'actual-back',
        other: { 'official-artwork': { front_default: 'actual-art' } } },
      cries: { latest: 'actual-cry' },
    }) },
  });
  const species = await new ServerSpeciesService().getSpecies('ditto');
  assert.deepEqual(species.base, authoritative.base);
  assert.deepEqual(species.moves, authoritative.moves);
  assert.equal(species.cry, 'actual-cry');
  assert.equal(species.sprites.back, 'actual-back');
});


test('normal server connection failure reports an error without simulating AI', async () => {
  let offlineStarts = 0;
  const statuses = [];
  const { ServerBattleStream } = load('ServerBattleStream.ts', {
    './battleApi': { ApiError, apiRequest: async () => { throw new Error('API unreachable'); } },
    './battleFeed': { BattleFeed: class {} },
    './eventPacer': load('eventPacer.ts'),
    './MockBattleStream': { MockBattleStream: class { constructor() { offlineStarts++; } } },
  }, { process: { env: { NEXT_PUBLIC_LIVE_BATTLE: '1' } } });
  const stream = new ServerBattleStream({ mode: 'ai', teams: { p1: [], p2: [] }, onStatus: (s) => statuses.push(s) });
  const disconnect = stream.connect(() => {});
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(offlineStarts, 0);
  assert.match(statuses.join(' '), /API unreachable/);
  disconnect();
});
