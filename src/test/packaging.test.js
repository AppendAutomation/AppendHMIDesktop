import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {PRODUCT_NAME, APP_ID, LINUX_EXECUTABLE} from '../main/brand.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const pkg = read('package.json');
const configs = {win: read('electron-builder-win.json'), linux: read('electron-builder-linux.json')};
const WEBAPP = 'studio/drawio/src/main/webapp/';

// What the run-only renderer loads (measured on a running project)
const LOADED = ['index.html', 'js/bootstrap.js', 'js/main.js', 'js/PreConfig.js', 'js/PostConfig.js', 'js/app.min.js',
	'js/extensions.min.js', 'js/stencils.min.js', 'js/shapes-14-6-5.min.js', 'js/plantuml/drawio-plantuml.min.js',
	'js/hmi/HmiRuntimeApp.js', 'js/diagramly/ElectronApp.js', 'js/diagramly/DesktopLibrary.js',
	'styles/grapheditor.css', 'css/hmi.css', 'mxgraph/css/common.css', 'images/spin.gif', 'resources/dia.txt',
	'math4/es5/startup.js'];

// A glob of the small kind the configs use: * within a name, ** for anything
function matches(pattern, file)
{
	const re = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*')
		.replace(/\u0000/g, '.*');

	return new RegExp('^' + re + '$').test(file);
}

function packaged(files, file)
{
	let inc = false;

	for (const p of files)
	{
		if (typeof p !== 'string')
		{
			// A {from, to} entry maps a folder into the package from
			// somewhere else; it matches nothing in this tree
			continue;
		}

		if (p.startsWith('!'))
		{
			if (matches(p.slice(1), file)) inc = false;
		}
		else if (matches(p, file))
		{
			inc = true;
		}
	}

	return inc;
}

test('one identity everywhere', () =>
{
	assert.equal(pkg.productName, PRODUCT_NAME);

	for (const c of Object.values(configs))
	{
		assert.equal(c.productName, PRODUCT_NAME);
		assert.equal(c.appId, APP_ID);
		assert.equal(c.publish, null);
	}

	assert.equal(configs.linux.linux.executableName, LINUX_EXECUTABLE);
});

test('both configs package the same files, and only English Chromium resources', () =>
{
	assert.deepEqual(configs.win.files, configs.linux.files);
	assert.deepEqual(configs.win.electronLanguages, ['en-US']);
	assert.deepEqual(configs.linux.electronLanguages, ['en-US']);
});

test('everything the runner loads is packaged', () =>
{
	for (const f of LOADED)
	{
		assert.ok(packaged(configs.win.files, WEBAPP + f), f);
		assert.ok(fs.existsSync(path.join(root, WEBAPP, f)), f + ' exists');
	}

	for (const f of ['LICENSE', 'NOTICE', 'src/main/main.js', 'src/main/launcher-preload.cjs', 'src/launcher/index.html',
		'studio/package.json', 'studio/src/main/electron-preload.js', 'studio/src/main/runtime/RuntimeMode.js',
		'studio/src/main/comms/CommsSession.js', 'studio/src/main/alarms/AlarmLog.js',
		'studio/src/main/security/UserStore.js', 'studio/src/main/retentive/RetentiveStore.js',
		'studio/src/main/recipes/RecipeStore.js', 'studio/src/main/trends/TrendLog.js', 'studio/src/main/print/ScreenPdf.js',
		'studio/src/main/runtime/RuntimeShutdown.js', 'studio/src/main/sql/SqlSession.js',
		'studio/src/main/sql/SqlClient.js', 'studio/src/main/sql/DataSourceStore.js'])
	{
		assert.ok(packaged(configs.win.files, f), f);
	}
});

test('the editor and Studio\'s development features are left out', () =>
{
	for (const f of ['studio/src/main/electron.js', 'studio/src/main/publish/Publisher.js', 'studio/comms/README.md',
		WEBAPP + 'js/integrate.min.js', WEBAPP + 'js/viewer.min.js', WEBAPP + 'js/diagramly/Editor.js',
		WEBAPP + 'js/grapheditor/Graph.js', WEBAPP + 'stencils/basic.xml', WEBAPP + 'templates/basic/cross.xml',
		WEBAPP + 'resources/dia_de.txt', WEBAPP + 'js/app.min.js.map', 'src/test/args.test.js', 'scripts/dist-win.mjs'])
	{
		assert.ok(!packaged(configs.win.files, f), f);
	}
});

test('the comms server and the icon ship as resources', () =>
{
	const res = (c) => Object.fromEntries(c.extraResources.map(r => [r.to, r.from]));
	assert.equal(res(configs.win).comms, 'studio/comms/publish/win-${arch}');
	assert.equal(res(configs.linux).comms, 'studio/comms/publish/linux-${arch}');
	assert.equal(res(configs.win)['icon.png'], 'build/icon.png');
	assert.equal(res(configs.linux)['icon.png'], 'build/icon.png');
});

test('the run-time dependencies are electron-log and the SQL Server driver', () =>
{
	// tedious has to be named here, not only in Studio's package.json: the
	// SQL* script functions run through studio/src/main/sql, but npm
	// resolves from this package's own node_modules and studio/node_modules
	// is not shipped. Leaving it out fails only in a packaged build.
	assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['electron-log', 'tedious']);
});

test('the SQL Server driver ships without its Azure AD half', () =>
{
	for (const [name, c] of Object.entries(configs))
	{
		assert.ok(c.files.includes(
			'!node_modules/@azure/{identity,keyvault-keys,msal-browser,msal-node,msal-common}{,/**}'),
			name + ' packs the Azure AD packages, which are about 43 MB of code that cannot run here');
		assert.ok(c.files.includes('!node_modules/@types{,/**}'), name);

		// The driver requires both eagerly, so they cannot simply be left
		// out: Studio's stubs take their place
		const mapped = Object.fromEntries(c.files.filter((f) => typeof f === 'object').map((f) => [f.to, f.from]));
		assert.equal(mapped['node_modules/@azure/identity'], 'studio/build/sql-stubs/azure-identity', name);
		assert.equal(mapped['node_modules/@azure/keyvault-keys'],
			'studio/build/sql-stubs/azure-keyvault-keys', name);
	}
});

test('every glob comes before the first file set, or the ones after it stop applying', () =>
{
	// electron-builder reads a pattern that follows a {from, to} entry as
	// part of that entry's file set, so the exclusions after one are ignored
	for (const [name, c] of Object.entries(configs))
	{
		const first = c.files.findIndex((f) => typeof f === 'object');

		if (first >= 0)
		{
			assert.ok(c.files.slice(first).every((f) => typeof f === 'object'),
				name + ' has a glob after a file set entry');
		}
	}
});

test('the test list names every test file', () =>
{
	const listed = pkg.scripts.test.split(' ').filter(a => a.endsWith('.test.js')).map(a => path.basename(a)).sort();
	const present = fs.readdirSync(path.join(root, 'src', 'test')).filter(f => f.endsWith('.test.js')).sort();
	assert.deepEqual(listed, present);
});
