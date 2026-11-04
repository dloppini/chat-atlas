'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { createCodexProjectChat } = require('../src/codex-chat');
const id = '12345678-1234-1234-1234-123456789abc';
function runtime(reply, closeOnEnd = true) {
  const messages = [], child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; child.emit('exit', 0); child.emit('close', 0); };
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      const message = JSON.parse(chunk.toString()); messages.push(message);
      const response = reply(message);
      if (response) queueMicrotask(() => child.stdout.write(JSON.stringify({ id: message.id, ...response }) + '\n'));
      callback();
    }, final(callback) { if (closeOnEnd) queueMicrotask(() => child.emit('close', 0)); callback(); }
  });
  return { child, messages, spawn: (binary, args, options) => { child.launch = { binary, args, options }; return child; } };
}
test('Project thread creation persists the selected cwd without a model turn or visible process', async () => {
  const r = runtime(message => ({ result: message.method === 'thread/start' ? { thread: { id, cwd: message.params.cwd } } : {} }));
  const session = await createCodexProjectChat('codex-runtime', 'C:/Projects/With spaces', { spawn: r.spawn, codexHome: 'C:/Fixtures/codex', projectName: 'My project' });
  assert.deepEqual(session, { provider: 'codex', id, cwd: 'C:/Projects/With spaces' });
  assert.deepEqual(r.messages.map(m => m.method), ['initialize', 'initialized', 'thread/start', 'thread/archive', 'thread/unarchive']);
  assert.deepEqual(r.messages[2].params, { cwd: 'C:/Projects/With spaces', ephemeral: false });
  assert.deepEqual(r.messages[3].params, { threadId: id });
  assert.deepEqual(r.messages[4].params, { threadId: id });
  assert.equal(r.messages.some(m => m.method === 'thread/name/set'), false);
  assert.equal(r.child.launch.options.windowsHide, true);
  assert.equal(r.child.launch.options.env.CODEX_HOME, 'C:/Fixtures/codex');
  assert.equal(r.child.launch.options.cwd, session.cwd);
  assert.deepEqual(r.child.launch.args, ['app-server', '--stdio']);
  assert.equal(r.child.stdin.writableEnded, true);
});

test('A persisted chat is ready to open before the helper process finishes shutting down', async () => {
  const r = runtime(message => ({ result: message.method === 'thread/start' ? { thread: { id, cwd: message.params.cwd } } : {} }), false);
  let ready = false;
  const creation = createCodexProjectChat('codex-runtime', 'C:/target', { spawn: r.spawn }).then(session => { ready = true; return session; });
  try {
    await new Promise(setImmediate);
    assert.equal(ready, true, 'Opening the chat must not wait for process shutdown');
    assert.equal(r.child.stdin.writableEnded, true);
    assert.equal(r.child.killed, undefined);
    assert.equal((await creation).id, id);
  } finally { r.child.kill(); await creation; }
});
test('Wrong cwd and invalid session IDs fail before persisting or opening a chat', async () => {
  for (const thread of [{ id, cwd: 'C:/wrong' }, { id: 'bad-id', cwd: 'C:/target' }]) {
    const r = runtime(message => ({ result: message.method === 'thread/start' ? { thread } : {} }));
    await assert.rejects(createCodexProjectChat('codex-runtime', 'C:/target', { spawn: r.spawn }), /selected project folder/);
    assert.equal(r.messages.some(m => m.method === 'thread/archive'), false);
    assert.equal(r.child.stdin.writableEnded, true);
  }
});
test('Provider errors and timeouts close the hidden process', async () => {
  const r = runtime(message => message.method === 'thread/start' ? { error: { message: 'Project config rejected' } } : { result: {} });
  await assert.rejects(createCodexProjectChat('codex-runtime', 'C:/target', { spawn: r.spawn }), /Project config rejected/);
  assert.equal(r.child.stdin.writableEnded, true);
  const silent = runtime(() => null);
  await assert.rejects(createCodexProjectChat('codex-runtime', 'C:/target', { spawn: silent.spawn, timeoutMs: 20 }), /too long/);
  assert.equal(silent.child.stdin.writableEnded, true);
});
