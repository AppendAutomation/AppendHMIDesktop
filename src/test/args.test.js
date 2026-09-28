import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {parseArgs, userArgs} from '../main/args.js';

test('a project runs', () =>
{
	const a = parseArgs(['C:\\Plant\\Line 3.ahmi']);
	assert.equal(a.project, 'C:\\Plant\\Line 3.ahmi');
	assert.equal(a.error, null);
});

test('no arguments open the launcher', () =>
{
	const a = parseArgs([]);
	assert.equal(a.project, null);
	assert.equal(a.error, null);
});

test('shortcut and startup options', () =>
{
	assert.equal(parseArgs(['--create-shortcut', 'desktop', 'x.ahmi']).createShortcut, 'desktop');
	assert.equal(parseArgs(['--create-shortcut=menu', 'x.ahmi']).createShortcut, 'menu');
	assert.equal(parseArgs(['--startup', 'on', 'x.ahmi']).startup, 'on');
	assert.equal(parseArgs(['x.ahmi', '--startup=off']).startup, 'off');
});

test('bad options are errors', () =>
{
	assert.match(parseArgs(['--create-shortcut', 'taskbar', 'x.ahmi']).error, /desktop, menu/);
	assert.match(parseArgs(['--startup', 'maybe', 'x.ahmi']).error, /on or off/);
	assert.match(parseArgs(['--startup', 'on']).error, /need a project/);
	assert.match(parseArgs(['--bogus']).error, /Unknown option: --bogus/);
	assert.match(parseArgs(['a.ahmi', 'b.ahmi']).error, /Only one project/);
});

test('Electron and Chromium switches pass through', () =>
{
	const a = parseArgs(['--no-sandbox', '--remote-debugging-port=9222', '--enable-logging', 'x.ahmi']);
	assert.equal(a.error, null);
	assert.equal(a.project, 'x.ahmi');
});

test('help and version', () =>
{
	assert.equal(parseArgs(['-h']).help, true);
	assert.equal(parseArgs(['--version']).version, true);
});

test('user arguments of a packaged app skip only the executable', () =>
{
	const opts = {defaultApp: false, appPath: '/opt/app/resources/app.asar', resolve: (a) => path.resolve('/home/u', a)};
	assert.deepEqual(userArgs(['/opt/app/append-hmi-desktop', 'x.ahmi'], opts), ['x.ahmi']);
});

test('the app folder is dropped wherever a second instance puts it', () =>
{
	const opts = {defaultApp: true, appPath: '/src/desktop', resolve: (a) => path.resolve('/src/desktop', a)};
	// First instance: electron . file
	assert.deepEqual(userArgs(['/e/electron', '.', '--no-sandbox', 'x.ahmi'], opts), ['--no-sandbox', 'x.ahmi']);
	// Second instance: switches first, then the positionals
	assert.deepEqual(userArgs(['/e/electron', '--no-sandbox', '--allow-file-access-from-files', '.'], opts),
		['--no-sandbox', '--allow-file-access-from-files']);
	assert.equal(parseArgs(userArgs(['/e/electron', '--no-sandbox', '.'], opts)).project, null);
});
