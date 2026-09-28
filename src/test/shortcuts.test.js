import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {launchCommand, shortcutDirs, shortcutFileNames, execQuote, windowsQuote, desktopEntry,
	desktopEntryProject, Shortcuts} from '../main/shortcuts.js';

test('the launch command', () =>
{
	assert.deepEqual(launchCommand({execPath: '/opt/a/app', appPath: '/x', defaultApp: false, env: {}}),
		{exe: '/opt/a/app', args: []});
	assert.deepEqual(launchCommand({execPath: '/tmp/.mount/app', appPath: '/x', defaultApp: false,
		env: {APPIMAGE: '/home/u/App.AppImage'}}), {exe: '/home/u/App.AppImage', args: []});
	assert.deepEqual(launchCommand({execPath: '/e/electron', appPath: '/src', defaultApp: true, env: {}}),
		{exe: '/e/electron', args: ['/src']});
});

test('shortcut folders', () =>
{
	const w = shortcutDirs({platform: 'win32', home: 'C:\\Users\\op', appData: 'C:\\Users\\op\\AppData\\Roaming',
		desktop: 'C:\\Users\\op\\Desktop'});
	assert.equal(w.menu, 'C:\\Users\\op\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Append HMI Desktop');
	assert.equal(w.startup, 'C:\\Users\\op\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup');

	const l = shortcutDirs({platform: 'linux', home: '/home/op', desktop: '/home/op/Desktop', env: {}});
	assert.equal(l.menu, '/home/op/.local/share/applications');
	assert.equal(l.startup, '/home/op/.config/autostart');
	assert.equal(shortcutDirs({platform: 'linux', home: '/h', desktop: '/h/D',
		env: {XDG_CONFIG_HOME: '/cfg'}}).startup, '/cfg/autostart');
});

test('file names', () =>
{
	const [first, second] = shortcutFileNames('win32', 'Line: 3', 'C:\\p\\Line 3.ahmi');
	assert.equal(first, 'Line 3.lnk');
	assert.match(second, /^Line 3 \([0-9a-f]{8}\)\.lnk$/);
	assert.match(shortcutFileNames('linux', 'Line 3', '/p/Line 3.ahmi')[0], /^append-hmi-desktop-line-3-[0-9a-f]{8}\.desktop$/);
	assert.notEqual(shortcutFileNames('linux', 'A', '/p/A.ahmi')[0], shortcutFileNames('linux', 'A', '/q/A.ahmi')[0]);
});

test('quoting', () =>
{
	assert.equal(windowsQuote('C:\\My Plant\\a.ahmi'), '"C:\\My Plant\\a.ahmi"');
	assert.equal(windowsQuote('C:\\p\\a.ahmi'), 'C:\\p\\a.ahmi');
	assert.equal(execQuote('/home/u/a.ahmi'), '/home/u/a.ahmi');
	assert.equal(execQuote('/home/u/My Plant/a$1.ahmi'), '"/home/u/My Plant/a\\$1.ahmi"');
	assert.equal(execQuote('/p/100%.ahmi'), '/p/100%%.ahmi');
});

test('a desktop entry names its project', () =>
{
	const text = desktopEntry({name: 'Line 3', command: {exe: '/opt/App Dir/app', args: []},
		projectPath: '/home/u/My Plant/Line 3.ahmi', icon: '/i.png', autostart: true});
	assert.match(text, /^\[Desktop Entry\]\nType=Application\n/);
	// The value's backslashes are doubled once more, per the string rules
	assert.match(text, /\nExec="\/opt\/App Dir\/app" "\/home\/u\/My Plant\/Line 3.ahmi"\n/);
	assert.match(text, /\nX-GNOME-Autostart-enabled=true\n/);
	assert.equal(desktopEntryProject(text), '/home/u/My Plant/Line 3.ahmi');
	assert.match(desktopEntry({name: 'X', command: {exe: '/a', args: []}, projectPath: '/x.ahmi'}), /\nCategories=Utility;\n/);
});

test('Linux shortcuts, menu entries and login start', () =>
{
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-desktop-home-'));

	try
	{
		const icon = path.join(home, 'icon.png');
		fs.writeFileSync(icon, 'png');
		const trusted = [];
		const s = new Shortcuts({platform: 'linux', dirs: shortcutDirs({platform: 'linux', home: home,
			desktop: path.join(home, 'Desktop'), env: {}}), command: {exe: '/opt/app/app', args: []},
			iconFile: icon, trust: (f) => trusted.push(f)});
		const config = {productName: 'Line 3', projectPath: '/plant/Line 3.ahmi'};
		const other = {productName: 'Line 3', projectPath: '/other/Line 3.ahmi'};

		const desktop = s.create('desktop', config);
		assert.equal(fs.statSync(desktop).mode & 0o777, 0o755);
		assert.deepEqual(trusted, [desktop]);
		assert.match(fs.readFileSync(desktop, 'utf8'), new RegExp('Icon=' + home + '/.local/share/icons/append-hmi-desktop.png'));
		assert.equal(s.find('desktop', config), desktop);
		assert.equal(s.find('desktop', other), null);
		assert.equal(s.create('desktop', config), desktop, 'created again in place');

		s.create('menu', config);
		assert.ok(s.find('menu', config).startsWith(path.join(home, '.local', 'share', 'applications')));

		assert.equal(s.isStartupEnabled(config), false);
		s.setStartup(config, true);
		assert.equal(s.isStartupEnabled(config), true);
		assert.equal(s.isStartupEnabled(other), false);
		assert.equal(s.setStartup(config, false), true);
		assert.equal(s.isStartupEnabled(config), false);
		assert.equal(s.setStartup(config, false), false);
	}
	finally
	{
		fs.rmSync(home, {recursive: true, force: true});
	}
});

test('Windows shortcuts go through the shell, and another project keeps its name', () =>
{
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-desktop-win-'));
	const links = new Map();
	const shell = {
		writeShortcutLink: (file, op, opts) =>
		{
			// Electron's 'replace' fails for a shortcut that does not exist yet
			if (op !== 'create') return false;

			links.set(file, opts);
			fs.writeFileSync(file, 'lnk');

			return true;
		},
		readShortcutLink: (file) => links.get(file)
	};

	try
	{
		const s = new Shortcuts({platform: 'win32', shell: shell, dirs: {desktop: dir, menu: dir, startup: dir},
			command: {exe: 'C:\\Program Files\\Append HMI Desktop\\Append HMI Desktop.exe', args: []}});
		const a = {productName: 'Line 3', projectPath: 'C:\\Plant A\\Line 3.ahmi'};
		const b = {productName: 'Line 3', projectPath: 'C:\\Plant B\\Line 3.ahmi'};

		const fa = s.create('desktop', a);
		assert.equal(path.dirname(fa), dir);
		assert.equal(path.basename(fa), 'Line 3.lnk');
		const link = links.get(fa);
		assert.equal(link.target, 'C:\\Program Files\\Append HMI Desktop\\Append HMI Desktop.exe');
		assert.equal(link.args, '"C:\\Plant A\\Line 3.ahmi"');
		assert.equal(link.description, 'Run Line 3 with Append HMI Desktop');
		assert.equal(link.icon, link.target);
		assert.equal(link.iconIndex, 0);

		const fb = s.create('desktop', b);
		assert.notEqual(fb, fa);
		assert.equal(s.find('desktop', a), fa);
		assert.equal(s.find('desktop', b), fb);
	}
	finally
	{
		fs.rmSync(dir, {recursive: true, force: true});
	}
});
