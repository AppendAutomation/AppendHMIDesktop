// The launcher window: choose an HMI application, run it, give it a shortcut
// or run it at login. Everything goes through window.launcher
// (src/main/launcher-preload.cjs).

(function()
{
	'use strict';

	const $ = (id) => document.getElementById(id);
	const MODES = {kiosk: 'Kiosk (full screen, locked)', fullscreen: 'Full screen', window: 'Window'};
	const EXITS = {
		shortcut: 'exit with Ctrl+Alt+Shift+Q',
		password: 'exit with Ctrl+Alt+Shift+Q and a password',
		never: 'cannot be exited'
	};

	let state = null;
	let current = null;

	// Paths are shown right-aligned so the file name stays in view; the mark
	// keeps a leading / or drive letter where it belongs
	const pathText = (p) => '‎' + p;

	function status(text, isError)
	{
		const el = $('status');
		el.textContent = text || '';
		el.classList.toggle('error', isError === true);
	}

	function fail(e)
	{
		status(String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
	}

	function setEnabled(ok)
	{
		for (const id of ['run', 'desktop', 'menu', 'startup'])
		{
			$(id).disabled = !ok;
		}
	}

	function show(info)
	{
		current = info;
		const file = $('file');
		const details = $('details');

		if (info == null)
		{
			file.textContent = 'No application chosen';
			file.classList.add('empty');
			file.title = '';
			details.hidden = true;
			setEnabled(false);
			$('startup').checked = false;
			renderRecent();

			return;
		}

		file.textContent = pathText(info.path);
		file.classList.remove('empty');
		file.title = info.path;
		details.hidden = false;
		details.classList.toggle('failed', info.error != null);
		$('name').textContent = info.name;

		if (info.error != null)
		{
			$('summary').textContent = '';
			$('error').textContent = info.error;
			$('error').hidden = false;
			setEnabled(false);
			$('startup').checked = false;
		}
		else
		{
			$('summary').textContent = info.width + ' × ' + info.height + ' · ' +
				(MODES[info.windowMode] || info.windowMode) + ' · ' + (EXITS[info.exitMode] || info.exitMode);
			$('error').hidden = true;
			setEnabled(true);
			$('startup').checked = info.startup === true;
		}

		renderRecent();
	}

	function renderRecent()
	{
		const list = $('recent');
		list.textContent = '';
		const recent = (state && state.recent) || [];
		$('no-recent').hidden = recent.length > 0;

		for (const r of recent)
		{
			const li = document.createElement('li');
			li.dataset.path = r.path;
			li.classList.toggle('selected', current != null && current.path === r.path);
			li.classList.toggle('missing', !r.exists);
			li.title = r.exists ? r.path : r.path + ' (not found)';

			const name = document.createElement('span');
			name.className = 'recent-name';
			name.textContent = r.name.replace(/\.(ahmi|drawio-hmi)$/i, '');
			const where = document.createElement('span');
			where.className = 'recent-path';
			where.textContent = pathText(r.path);
			const forget = document.createElement('button');
			forget.className = 'forget';
			forget.textContent = '×';
			forget.title = 'Remove from the list';
			forget.dataset.field = 'forget';

			forget.addEventListener('click', async (e) =>
			{
				e.stopPropagation();
				await window.launcher.forget(r.path);
				await refresh();

				if (current != null && current.path === r.path)
				{
					show(null);
				}
			});

			li.addEventListener('click', () => select(r.path));
			li.addEventListener('dblclick', () => run());
			li.append(name, where, forget);
			list.appendChild(li);
		}
	}

	async function refresh()
	{
		state = await window.launcher.state();
		renderRecent();
	}

	async function select(file)
	{
		status('');

		try
		{
			show(await window.launcher.info(file));
		}
		catch (e)
		{
			fail(e);
		}
	}

	async function run()
	{
		if (current == null || current.error != null)
		{
			return;
		}

		// A project that cannot be exited takes the PC over until it shuts down
		if (current.exitMode === 'never' && !window.confirm(current.name + ' cannot be closed once it runs: ' +
			'only shutting down the computer stops it. Run it anyway?'))
		{
			return;
		}

		try
		{
			status('Starting ' + current.name + '…');
			await window.launcher.run(current.path);
			status(current.name + ' is running.');
			await refresh();
		}
		catch (e)
		{
			fail(e);
		}
	}

	async function shortcut(place)
	{
		try
		{
			const file = await window.launcher.shortcut(current.path, place);
			status((place === 'desktop' ? 'Desktop shortcut created: ' : 'Menu entry created: ') + file);
			await refresh();
		}
		catch (e)
		{
			fail(e);
		}
	}

	$('browse').addEventListener('click', async () =>
	{
		try
		{
			const info = await window.launcher.browse();

			if (info != null)
			{
				status('');
				show(info);
			}
		}
		catch (e)
		{
			fail(e);
		}
	});

	$('run').addEventListener('click', run);
	$('desktop').addEventListener('click', () => shortcut('desktop'));
	$('menu').addEventListener('click', () => shortcut('menu'));

	$('startup').addEventListener('change', async (e) =>
	{
		const on = e.target.checked;

		try
		{
			const enabled = await window.launcher.startup(current.path, on);
			e.target.checked = enabled;
			status(enabled ? current.name + ' will run when you log in.' :
				current.name + ' will no longer run when you log in.');
			await refresh();
		}
		catch (err)
		{
			e.target.checked = !on;
			fail(err);
		}
	});

	(async () =>
	{
		try
		{
			await refresh();
			$('version').textContent = 'Version ' + state.version;

			if (state.platform !== 'win32')
			{
				$('menu').textContent = 'Add to applications menu';
			}

			const first = state.recent.find(r => r.exists);

			if (first != null)
			{
				await select(first.path);
			}
			else
			{
				show(null);
			}
		}
		catch (e)
		{
			fail(e);
		}
	})();
})();
