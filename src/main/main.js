// Append HMI Desktop: runs Append HMI Studio applications.
//
//   append-hmi-desktop project.ahmi     runs the project
//   append-hmi-desktop                  opens the launcher window
//
// Each project runs in its own window through Append HMI Studio's run-only
// renderer (studio/drawio/.../js/hmi/HmiRuntimeApp.js), with the project's
// window mode and exit policy. PLC traffic goes through the hmi-comms server,
// and alarm history, retentive values and runtime user changes are kept per
// project in userData, all with Studio's own modules. None of the editor's
// development features (editing, saving, export, publish) are here.

import fs from 'fs';
import path from 'path';
import url from 'url';
import {spawnSync} from 'child_process';
import {app, BrowserWindow, dialog, ipcMain, Menu, session, shell} from 'electron';
import log from 'electron-log';
import {parseArgs, userArgs, USAGE} from './args.js';
import {loadProjectConfig, describe, isProjectFile} from './project.js';
import {Settings} from './settings.js';
import {Shortcuts, shortcutDirs, launchCommand} from './shortcuts.js';
import {PRODUCT_NAME, HOMEPAGE_URL} from './brand.js';
import {runtimeWindowOptions, mayExit, publicRuntimeInfo, readRuntimeProject} from
	'../../studio/src/main/runtime/RuntimeMode.js';
import {CommsSupervisor, resolveExecutable as resolveCommsExecutable} from
	'../../studio/src/main/comms/CommsSupervisor.js';
import {CommsSession, validateCommsArgs} from '../../studio/src/main/comms/CommsSession.js';
import * as alarmLog from '../../studio/src/main/alarms/AlarmLog.js';
import * as retentiveStore from '../../studio/src/main/retentive/RetentiveStore.js';
import * as userStore from '../../studio/src/main/security/UserStore.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const __DEV__ = process.env.HMI_ENV === 'dev';
const isWin = process.platform === 'win32';

const argvOptions = (cwd) => ({defaultApp: process.defaultApp, appPath: path.resolve(app.getAppPath()),
	resolve: (a) => path.resolve(cwd, a)});
const args = parseArgs(userArgs(process.argv, argvOptions(process.cwd())));

log.transports.file.level = 'info';
log.transports.console.level = 'warn';

if (args.help || args.version || args.error != null)
{
	// A command-line answer, with no window and no single-instance lock
	if (args.error != null)
	{
		console.error(args.error + '\n\n' + USAGE);
	}
	else
	{
		console.log(args.help ? USAGE : PRODUCT_NAME + ' ' + app.getVersion());
	}

	process.exit(args.error != null ? 2 : 0);
}

if (args.disableAcceleration)
{
	app.disableHardwareAcceleration();
}

// The editor web app: only the files the run-only renderer loads are packaged
const codeDir = path.join(__dirname, '..', '..', 'studio', 'drawio', 'src', 'main', 'webapp');
const launcherDir = path.join(__dirname, '..', 'launcher');
const fileUrl = (dir) => url.pathToFileURL(dir).href.replace(/\/.:\//, s => s.toUpperCase());
const codeUrl = fileUrl(codeDir);
const launcherUrl = fileUrl(launcherDir);

const appIcon = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') :
	path.join(__dirname, '..', '..', 'studio', 'build', 'icon.png');

const shortcuts = new Shortcuts({
	platform: process.platform,
	shell: shell,
	dirs: shortcutDirs({platform: process.platform, home: app.getPath('home'), appData: app.getPath('appData'),
		desktop: app.getPath('desktop'), env: process.env}),
	command: launchCommand({execPath: process.execPath, appPath: app.getAppPath(),
		defaultApp: process.defaultApp, env: process.env}),
	iconFile: appIcon,
	// GNOME only launches desktop files marked trusted
	trust: (file) =>
	{
		try
		{
			spawnSync('gio', ['set', file, 'metadata::trusted', 'true'], {timeout: 3000, stdio: 'ignore'});
		}
		catch (e) {}
	}
});

// --create-shortcut and --startup act and exit, without a window
if (args.createShortcut != null || args.startup != null)
{
	app.whenReady().then(async () =>
	{
		let code = 0;

		try
		{
			const config = await loadProjectConfig(args.project);

			if (args.createShortcut != null)
			{
				console.log('Created ' + shortcuts.create(args.createShortcut, config));
			}

			if (args.startup === 'on')
			{
				console.log('Runs at login: ' + shortcuts.setStartup(config, true));
			}
			else if (args.startup === 'off')
			{
				console.log(shortcuts.setStartup(config, false) ? 'No longer runs at login' :
					'It did not run at login');
			}
		}
		catch (e)
		{
			console.error(e.message);
			code = 1;
		}

		app.exit(code);
	});
}
else if (!app.requestSingleInstanceLock())
{
	// The running instance opens the project (or the launcher)
	app.quit();
}
else
{
	app.on('second-instance', (event, argv, workingDirectory) =>
	{
		// Chromium may add its own switches, so only the project matters
		const again = parseArgs(userArgs(argv, argvOptions(workingDirectory || process.cwd())));
		const project = again.project != null ? path.resolve(workingDirectory || '.', again.project) : null;

		if (project != null)
		{
			openProject(project);
		}
		else
		{
			showLauncher();
		}
	});

	app.whenReady().then(() =>
	{
		Menu.setApplicationMenu(null);
		secureSession();

		if (args.project != null)
		{
			openProject(path.resolve(args.project));
		}
		else
		{
			showLauncher();
		}
	});
}

// ------------------------------------------------------------------ security

// The renderer loads local files only from the web app and the launcher, and
// no remote code (the same policy as Append HMI Studio)
function secureSession()
{
	session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
	{
		callback({
			responseHeaders: {
				...details.responseHeaders,
				'Content-Security-Policy': ['default-src \'self\'; script-src \'self\' \'wasm-unsafe-eval\'; ' +
					'connect-src \'self\'; img-src * data:; media-src *; font-src * data:; frame-src \'self\'; ' +
					'style-src \'self\' \'unsafe-inline\'; base-uri \'none\'; child-src \'self\'; object-src \'none\';']
			}
		});
	});

	session.defaultSession.webRequest.onBeforeRequest({urls: ['file://*']}, (details, callback) =>
	{
		const u = details.url.replace(/\/.:\//, s => s.toUpperCase());
		const ok = u.startsWith(codeUrl) || u.startsWith(launcherUrl);

		if (!ok)
		{
			log.warn('Blocked loading ' + details.url);
		}

		callback({cancel: !ok});
	});

	// Nothing opens new windows or navigates away
	app.on('web-contents-created', (e, contents) =>
	{
		contents.setWindowOpenHandler(() => ({action: 'deny'}));
		contents.on('will-navigate', (ev, target) =>
		{
			if (target !== contents.getURL())
			{
				ev.preventDefault();
			}
		});
	});
}

function fromUrl(frame, base)
{
	return frame != null && frame.url.replace(/\/.:\//, s => s.toUpperCase()).startsWith(base);
}

// ------------------------------------------------------------------ settings

let settings = null;

function getSettings()
{
	if (settings == null)
	{
		settings = new Settings(app.getPath('userData'));
	}

	return settings;
}

// Paths the launcher may act on: picked in the OS dialog, given on the
// command line or already in the recent list. The launcher page cannot name
// any other file.
const allowedPaths = new Set();

function allow(file)
{
	allowedPaths.add(isWin ? file.toLowerCase() : file);
}

function isAllowed(file)
{
	const key = isWin ? file.toLowerCase() : file;

	return allowedPaths.has(key) || getSettings().recent.some(p => (isWin ? p.toLowerCase() : p) === key);
}

// ------------------------------------------------------------------ projects

// One window per running project
const runtimes = new Map();   // webContents id -> {config, win, exitAllowed}

function runtimeFor(contents)
{
	return runtimes.get(contents.id) || null;
}

function samePath(a, b)
{
	return isWin ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function openProject(file)
{
	allow(file);

	for (const r of runtimes.values())
	{
		if (samePath(r.config.projectPath, file) && !r.win.isDestroyed())
		{
			if (r.win.isMinimized()) r.win.restore();
			r.win.show();
			r.win.focus();

			return r.win;
		}
	}

	let config;

	try
	{
		config = await loadProjectConfig(file);
	}
	catch (e)
	{
		log.error('Cannot run ' + file + ': ' + e.message);

		// A readable reason, in a window that closes normally
		config = {projectPath: file, productName: path.basename(file), version: '', windowMode: 'window',
			width: 1024, height: 768, exit: {mode: 'shortcut'}, error: e.message};
	}

	if (config.error == null)
	{
		getSettings().addRecent(config.projectPath);
	}

	return createRuntimeWindow(config);
}

function createRuntimeWindow(config)
{
	const win = new BrowserWindow(Object.assign(runtimeWindowOptions(config),
	{
		icon: isWin ? undefined : appIcon,
		webPreferences: {
			preload: path.join(__dirname, '..', '..', 'studio', 'src', 'main', 'electron-preload.js'),
			spellcheck: false,
			contextIsolation: true,
			nodeIntegration: false,
			webviewTag: false,
			webSecurity: true,
			disableBlinkFeatures: 'Auxclick'
		}
	}));

	const runtime = {config: config, win: win, exitAllowed: config.error != null};
	const id = win.webContents.id;
	runtimes.set(id, runtime);

	log.info('Running ' + config.projectPath + ' (' + config.windowMode + ', exit ' + config.exit.mode + ')');

	win.loadURL(url.format({
		pathname: path.join(codeDir, 'index.html'),
		protocol: 'file:',
		slashes: true,
		query: {
			dev: 0,
			test: __DEV__ ? 1 : 0,
			gapi: 0, db: 0, od: 0, gh: 0, gl: 0, tr: 0,
			browser: 0,
			picker: 0,
			mode: 'device',
			disableUpdate: 1,
			enableSpellCheck: 0,
			enableStoreBkp: 0,
			isGoogleFontsEnabled: 0,
			chrome: 0,
			hmiruntime: 1,
			// The HMI's own text is English; this also avoids loading another
			// language's resources
			appLang: 'en'
		}
	}));

	win.once('ready-to-show', () => win.show());
	win.on('page-title-updated', (e) => e.preventDefault());

	if (__DEV__)
	{
		win.webContents.openDevTools();
	}

	win.on('close', (e) =>
	{
		if (!runtime.exitAllowed)
		{
			e.preventDefault();
		}
	});

	// Logging off, restarting or shutting down is never held up
	win.on('session-end', () => { runtime.exitAllowed = true; });

	win.webContents.on('render-process-gone', (e, details) =>
	{
		log.error(config.productName + ': renderer gone (' + details.reason + ')');
	});

	win.webContents.on('console-message', (e) =>
	{
		if (e.level === 'warning' || e.level === 'error')
		{
			log.warn(config.productName + ' console: ' + e.message);
		}
	});

	// The exit shortcut, Ctrl+Alt+Shift+Q, caught here so it works even if
	// the page is stuck
	win.webContents.on('before-input-event', (event, input) =>
	{
		if (input.type !== 'keyDown' || input.code !== 'KeyQ' || !input.shift || !input.alt ||
			!(input.control || input.meta))
		{
			return;
		}

		event.preventDefault();

		if (config.error != null || config.exit.mode === 'shortcut')
		{
			log.info(config.productName + ': exit by shortcut');
			runtime.exitAllowed = true;
			win.close();
		}
		else if (config.exit.mode === 'password')
		{
			win.webContents.send('hmiRuntimeExitPrompt');
		}
		else
		{
			log.info(config.productName + ': exit shortcut ignored (exit is disabled)');
		}
	});

	win.on('closed', () =>
	{
		runtimes.delete(id);
		closeCommsSession(id);
	});

	return win;
}

// ------------------------------------------------------------------ launcher

let launcher = null;

function showLauncher()
{
	if (launcher != null && !launcher.isDestroyed())
	{
		if (launcher.isMinimized()) launcher.restore();
		launcher.show();
		launcher.focus();

		return;
	}

	launcher = new BrowserWindow({
		width: 640,
		height: 600,
		minWidth: 520,
		minHeight: 480,
		title: PRODUCT_NAME,
		icon: isWin ? undefined : appIcon,
		show: false,
		autoHideMenuBar: true,
		backgroundColor: '#f4f5f7',
		webPreferences: {
			preload: path.join(__dirname, 'launcher-preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			spellcheck: false
		}
	});

	launcher.loadFile(path.join(launcherDir, 'index.html'));
	launcher.once('ready-to-show', () => launcher.show());
	launcher.on('closed', () => { launcher = null; });

	if (__DEV__)
	{
		launcher.webContents.openDevTools({mode: 'detach'});
	}
}

function launcherRequest(channel, fn)
{
	ipcMain.handle(channel, async (event, ...params) =>
	{
		if (!fromUrl(event.senderFrame, launcherUrl))
		{
			throw new Error('refused');
		}

		return fn(...params);
	});
}

function checkedPath(file)
{
	if (typeof file !== 'string' || !isProjectFile(file) || !isAllowed(file))
	{
		throw new Error('Choose the project with Browse first.');
	}

	return file;
}

async function projectInfo(file)
{
	try
	{
		const config = await loadProjectConfig(file);

		return Object.assign(describe(config), {
			startup: shortcuts.isStartupEnabled(config),
			desktop: shortcuts.find('desktop', config) != null,
			menu: shortcuts.find('menu', config) != null
		});
	}
	catch (e)
	{
		return {path: file, name: path.basename(file), error: e.message};
	}
}

launcherRequest('launcher:state', async () => ({
	product: PRODUCT_NAME,
	version: app.getVersion(),
	platform: process.platform,
	homepage: HOMEPAGE_URL,
	recent: getSettings().recent.map(p => ({path: p, name: path.basename(p), exists: fs.existsSync(p)}))
}));

launcherRequest('launcher:browse', async () =>
{
	const res = await dialog.showOpenDialog(launcher, {
		title: 'Choose an HMI application',
		properties: ['openFile'],
		filters: [{name: 'HMI applications', extensions: ['ahmi', 'drawio-hmi']}]
	});

	if (res.canceled || res.filePaths.length === 0)
	{
		return null;
	}

	allow(res.filePaths[0]);

	return projectInfo(res.filePaths[0]);
});

launcherRequest('launcher:info', async (file) => projectInfo(checkedPath(file)));

launcherRequest('launcher:run', async (file) =>
{
	await openProject(checkedPath(file));

	return true;
});

launcherRequest('launcher:shortcut', async (file, place) =>
{
	if (place !== 'desktop' && place !== 'menu')
	{
		throw new Error('bad place');
	}

	const created = shortcuts.create(place, await loadProjectConfig(checkedPath(file)));
	log.info('Created shortcut ' + created);
	getSettings().addRecent(file);

	return created;
});

launcherRequest('launcher:startup', async (file, on) =>
{
	const config = await loadProjectConfig(checkedPath(file));
	shortcuts.setStartup(config, on === true);
	log.info((on === true ? 'Runs at login: ' : 'No longer runs at login: ') + config.projectPath);
	getSettings().addRecent(file);

	return shortcuts.isStartupEnabled(config);
});

launcherRequest('launcher:forget', async (file) =>
{
	getSettings().removeRecent(file);

	return true;
});

launcherRequest('launcher:show', async (file) =>
{
	shell.showItemInFolder(checkedPath(file));

	return true;
});

// ------------------------------------------------------------------ runtime IPC

// The run-only renderer's requests (the same protocol Append HMI Studio's
// main process answers for a published package)
ipcMain.on('rendererReq', async (event, req) =>
{
	const runtime = runtimeFor(event.sender);

	if (runtime == null || !fromUrl(event.senderFrame, codeUrl) || req == null || typeof req.action !== 'string')
	{
		return;
	}

	try
	{
		const data = await handleRendererRequest(event.sender, runtime, req);
		event.reply('mainResp', {success: true, data: data, reqId: req.reqId});
	}
	catch (e)
	{
		event.reply('mainResp', {error: true, msg: e.message, reqId: req.reqId});
	}
});

async function handleRendererRequest(contents, runtime, req)
{
	const action = req.action;
	const config = runtime.config;

	if (action.startsWith('hmiComms.'))
	{
		return handleCommsRequest(contents, req);
	}

	const base = app.getPath('userData');

	switch (action)
	{
		case 'hmiRuntime.info':
			return Object.assign(publicRuntimeInfo(config), {error: config.error || null});
		case 'hmiRuntime.project':
			if (config.error != null) throw new Error(config.error);
			return {xml: await readRuntimeProject(config), title: publicRuntimeInfo(config).title};
		case 'hmiRuntime.exit':
			if (req.password != null && typeof req.password !== 'string') throw new Error('bad arg: password');

			if (!mayExit(config, req.password))
			{
				log.warn(config.productName + ': exit refused (' + config.exit.mode + ')');
				return false;
			}

			log.info(config.productName + ': exit by operator');
			runtime.exitAllowed = true;
			setImmediate(() => { if (!runtime.win.isDestroyed()) runtime.win.close(); });
			return true;
		case 'hmiRuntime.log':
		{
			const level = ['info', 'warn', 'error'].includes(req.level) ? req.level : 'info';
			log[level](config.productName + ': ' + String(req.message).slice(0, 2000));
			return null;
		}
		case 'hmiAlarms.append':
		{
			const store = alarmLog.storeName(req.store);
			const count = await alarmLog.append(base, store, req.events);

			if (!prunedAlarmStores.has(store))
			{
				prunedAlarmStores.add(store);
				await alarmLog.prune(base, store, Date.now(), alarmLog.RETENTION_DAYS);
			}

			return count;
		}
		case 'hmiAlarms.recent':
			return alarmLog.recent(base, alarmLog.storeName(req.store), req.limit);
		case 'hmiRetentive.load':
			return retentiveStore.load(base, req.store);
		case 'hmiRetentive.save':
			return retentiveStore.save(base, req.store, req.values);
		case 'hmiUsers.load':
			return userStore.load(base, req.store);
		case 'hmiUsers.save':
			return userStore.save(base, req.store, req.users);
		case 'hmiApp.info':
			return {name: PRODUCT_NAME, version: app.getVersion(), electron: process.versions.electron,
				chrome: process.versions.chrome, homepage: HOMEPAGE_URL};
		case 'getDocumentsFolder':
			return app.getPath('documents');
		case 'isPluginsEnabled':
			return false;
		case 'isFullscreen':
			return runtime.win.isFullScreen();
		default:
			// The editor asks for things a runner has no use for (files,
			// drafts, fonts); they get no answer rather than an error
			return null;
	}
}

const prunedAlarmStores = new Set();

// ------------------------------------------------------------------ comms

let commsSupervisor = null;

function getCommsSupervisor()
{
	if (commsSupervisor == null)
	{
		commsSupervisor = new CommsSupervisor({
			executable: resolveCommsExecutable({isPackaged: app.isPackaged, resourcesPath: process.resourcesPath,
				appPath: path.join(app.getAppPath(), 'studio')}),
			extractDir: path.join(app.getPath('userData'), 'comms-cache')
		});

		commsSupervisor.on('log', (line) => log.info('[hmi-comms] ' + line));
		commsSupervisor.on('exit', (e) =>
		{
			if (!e.expected)
			{
				log.warn('[hmi-comms] exited unexpectedly', e.code, e.signal);
			}
		});
		commsSupervisor.on('failed', (e) => log.error('[hmi-comms]', e.message));
	}

	return commsSupervisor;
}

// One connection to hmi-comms per project window
const commsSessions = new Map();

function closeCommsSession(id)
{
	const s = commsSessions.get(id);

	if (s != null)
	{
		s.close();
		commsSessions.delete(id);
	}
}

async function handleCommsRequest(contents, req)
{
	validateCommsArgs(req.action, req);

	if (req.action === 'hmiComms.disconnect')
	{
		closeCommsSession(contents.id);

		return {ok: true};
	}

	let s = commsSessions.get(contents.id);

	if (s == null)
	{
		s = new CommsSession(getCommsSupervisor(), (ev) =>
		{
			if (!contents.isDestroyed())
			{
				contents.send('hmiCommsEvent', ev);
			}
		});

		commsSessions.set(contents.id, s);
	}

	switch (req.action)
	{
		case 'hmiComms.configure':
			return s.configure(req.devices, req.tags);
		case 'hmiComms.subscribe':
			return s.subscribe(req.ids, req.rateMs, req.rates);
		case 'hmiComms.unsubscribe':
			return s.unsubscribe();
		case 'hmiComms.read':
			return s.read(req.ids);
		case 'hmiComms.write':
			return s.write(req.values, req.timeoutMs);
		case 'hmiComms.status':
			return s.status();
		case 'hmiComms.diag':
			return s.diag();
		default:
			// validate and probe are the editor's device tools
			throw new Error('not available in ' + PRODUCT_NAME);
	}
}

// ------------------------------------------------------------------ lifetime

app.on('window-all-closed', () => app.quit());

// A quit is only ever started by the last window closing or by the operating
// system (Chromium turns SIGTERM and SIGINT into one on Linux: a shutdown, a
// service manager, Ctrl+C); either way every project window may now close,
// as on a Windows log off through session-end
app.on('before-quit', () =>
{
	if (runtimes.size > 0)
	{
		log.info('Stopping ' + runtimes.size + ' running project(s)');
	}

	for (const r of runtimes.values())
	{
		r.exitAllowed = true;
	}
});

app.on('will-quit', () =>
{
	if (commsSupervisor != null)
	{
		commsSupervisor.stop();
	}
});
