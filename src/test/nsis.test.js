import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {fileURLToPath} from 'url';
import {buildDesktopNsis} from '../../scripts/nsis.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function script(overrides = {})
{
	return buildDesktopNsis(Object.assign({
		productName: 'Append HMI Desktop',
		version: '1.2.3',
		publisher: 'Append Automation',
		exeName: 'Append HMI Desktop.exe',
		scope: 'machine',
		compression: 'fast',
		outFile: '/out/Setup.exe',
		appDir: '/app',
		rootEntries: [{name: 'Append HMI Desktop.exe', dir: false}, {name: 'locales', dir: true},
			{name: 'resources', dir: true}],
		resources: [{name: 'app.asar', dir: false}, {name: 'comms', dir: true}],
		ext: 'ahmi',
		progId: 'AppendHMIDesktop.Project',
		runVerb: 'RunWithAppendHMIDesktop',
		runVerbLabel: 'Run with Append HMI Desktop',
		installerIcon: null,
		join: path.posix.join,
		estimatedSizeKb: 1000
	}, overrides));
}

test('per machine: Program Files, admin, HKLM', () =>
{
	const s = script();
	assert.match(s, /RequestExecutionLevel admin/);
	assert.match(s, /InstallDir "\$PROGRAMFILES64\\Append HMI Desktop"/);
	assert.match(s, /File "\/app\/Append HMI Desktop.exe"/);
	assert.match(s, /File \/r "\/app\/resources\/comms"/);
	assert.match(s, /VIProductVersion "1.2.3.0"/);
	assert.match(s, /CreateShortcut "\$SMPROGRAMS\\\$\{PRODUCT\}.lnk"/);
});

test('per user: no admin, HKCU', () =>
{
	const s = script({scope: 'user'});
	assert.match(s, /RequestExecutionLevel user/);
	assert.match(s, /WriteRegStr HKCU "Software\\Classes\\SystemFileAssociations/);
	assert.doesNotMatch(s, /HKLM/);
});

test('the Run verb is added to every .ahmi file', () =>
{
	const s = script();
	const key = 'Software\\\\Classes\\\\SystemFileAssociations\\\\\\.ahmi\\\\shell\\\\RunWithAppendHMIDesktop';
	assert.match(s, new RegExp('WriteRegStr HKLM "' + key + '" "" "Run with Append HMI Desktop"'));
	assert.match(s, new RegExp('WriteRegStr HKLM "' + key + '\\\\command" "" \'"\\$INSTDIR\\\\\\$\\{EXE\\}" "%1"\''));
	assert.match(s, new RegExp('DeleteRegKey HKLM "' + key + '"'));
});

test('the default for .ahmi is taken only when free, and given back only if still ours', () =>
{
	const s = script();
	assert.match(s, /ReadRegStr \$0 HKCR "\.ahmi" ""\n  StrCmp \$0 "" 0 assoc_done\n  WriteRegStr HKLM "Software\\Classes\\\.ahmi" "" "AppendHMIDesktop\.Project"/);
	assert.match(s, /WriteRegStr HKLM "Software\\Classes\\\.ahmi\\OpenWithProgids" "AppendHMIDesktop\.Project" ""/);
	assert.match(s, /DeleteRegKey \/ifempty HKLM "Software\\Classes\\\.ahmi"\n/);
	assert.match(s, /ReadRegStr \$0 HKLM "Software\\Classes\\\.ahmi" ""\n  StrCmp \$0 "AppendHMIDesktop\.Project" 0 \+2\n  DeleteRegValue HKLM "Software\\Classes\\\.ahmi" ""/);
});

test('a running copy is stopped before files are replaced', () =>
{
	const s = script();
	assert.ok(s.indexOf('!insertmacro StopApp') < s.indexOf('RMDir /r "$INSTDIR\\resources"'));
	assert.match(s, /taskkill\.exe" \/F \/T \/IM "\$\{EXE\}"/);
});

test('makensis compiles it', {skip: !fs.existsSync(path.join(root, 'build', 'nsis', 'linux', 'makensis')) ||
	process.platform !== 'linux'}, () =>
{
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-desktop-nsis-'));

	try
	{
		const app = path.join(dir, 'app');
		fs.mkdirSync(path.join(app, 'resources', 'comms'), {recursive: true});
		fs.mkdirSync(path.join(app, 'locales'));
		fs.writeFileSync(path.join(app, 'Append HMI Desktop.exe'), 'exe');
		fs.writeFileSync(path.join(app, 'locales', 'en-US.pak'), 'pak');
		fs.writeFileSync(path.join(app, 'resources', 'app.asar'), 'asar');
		fs.writeFileSync(path.join(app, 'resources', 'comms', 'hmi-comms.exe'), 'comms');

		const out = path.join(dir, 'Setup.exe');
		const nsi = path.join(dir, 'installer.nsi');
		fs.writeFileSync(nsi, script({appDir: app, outFile: out, join: path.join,
			installerIcon: path.join(root, 'build', 'icon.ico')}));

		const r = spawnSync(path.join(root, 'build', 'nsis', 'linux', 'makensis'), ['-V2', '-INPUTCHARSET', 'UTF8', nsi],
			{env: Object.assign({}, process.env, {NSISDIR: path.join(root, 'build', 'nsis', 'share')}), encoding: 'utf8'});
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.ok(fs.statSync(out).size > 10000);
	}
	finally
	{
		fs.rmSync(dir, {recursive: true, force: true});
	}
});
