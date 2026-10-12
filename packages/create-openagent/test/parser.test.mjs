import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArguments, collectOptions, validateProjectName } from '../dist/index.js';

test('starter is the default and --yes is complete without interactive input', async () => {
  const parsed = parseArguments(['my-agent', '--yes']);
  assert.deepEqual(parsed, { kind: 'create', projectName: 'my-agent', yes: true, template: 'starter' });
  assert.deepEqual(await collectOptions(parsed, false), { projectName: 'my-agent', template: 'starter',
    adapters: [], bridge: 'none', deploy: 'local', bioagentic: false, fabrics: false });
  assert.deepEqual(parseArguments(['--template', 'starter', '-y', 'my-agent']), parsed);
  assert.equal(parseArguments(['my-agent']).template, 'starter');
  await assert.rejects(collectOptions(parseArguments([]), false), /Provide a project name/);
  assert.throws(() => parseArguments(['--yes']), /provide a project name/);
});
test('help and version are explicit standalone commands', () => {
  assert.deepEqual(parseArguments(['--help']), { kind: 'help' });
  assert.deepEqual(parseArguments(['-h']), { kind: 'help' });
  assert.deepEqual(parseArguments(['--version']), { kind: 'version' });
  assert.deepEqual(parseArguments(['-v']), { kind: 'version' });
  for (const args of [['app', '--help'], ['--yes', '--version'], ['--help', '--version']]) {
    assert.throws(() => parseArguments(args), /on its own/);
  }
});
test('names preserve exact bytes and reject traversal, whitespace and reserved destinations', () => {
  for (const value of ['app', 'my-agent', 'a_1', 'a'.repeat(64)]) assert.equal(validateProjectName(value), value);
  for (const value of ['', '.', '..', '../app', '/app', 'app/child', 'app\\child', 'app\n', ' app', 'app ',
    'UPPER', 'a'.repeat(65), 'nul', 'con', 'com1', 'lpt9', 'node_modules', '\u0000app']) {
    assert.throws(() => validateProjectName(value), /project name/);
    assert.throws(() => parseArguments([value, '--yes']));
  }
});
test('duplicate, missing, unsupported and historical options never silently generate a project', () => {
  for (const args of [['app', '--yes', '-y'], ['app', '--template', 'starter', '--template', 'starter'],
    ['app', 'other'], ['app', '--template'], ['app', '--template', 'unknown'], ['app', '--template=starter'],
    ['app', '--adapter', 'http'], ['app', '--bridge', 'none'], ['app', '--deploy', 'local'],
    ['app', '--bioagentic'], ['app', '--fabrics'], ['app', '--unknown'], ['app', '--'],
    ['app', '--template', 'agent'], ['app', '--template', 'mcp-server'],
    ['app', '--template', 'web-dashboard'], ['app', '--template', 'full-stack']]) {
    assert.throws(() => parseArguments(args));
  }
  assert.throws(() => parseArguments(['app', '--deploy', 'local']), /starter/);
  assert.throws(() => parseArguments(['app', '--template', 'agent']), /migration/);
});
