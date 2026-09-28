// Command line:
//
//   append-hmi-desktop [options] [project.ahmi]
//
// With a project it runs it; without one it opens the launcher window.

export const USAGE = `Usage: append-hmi-desktop [options] [project.ahmi]

Runs an Append HMI Studio application. Without a project, opens the
launcher window.

Options:
  --create-shortcut <where>  Create a shortcut that runs the project, then
                             exit. <where> is desktop or menu.
  --startup <on|off>         Run the project when the user logs in (on) or
                             stop doing so (off), then exit.
  --disable-acceleration     Turn off GPU acceleration.
  -h, --help                 Show this help.
  -v, --version              Show the version.`;

export const SHORTCUT_PLACES = ['desktop', 'menu'];

// Switches Electron or Chromium take themselves, passed through untouched
const PASSTHROUGH = [/^--no-sandbox$/, /^--disable-gpu/, /^--enable-logging/, /^--v=/,
	/^--remote-debugging-port=/, /^--inspect/, /^--ozone-platform/, /^--enable-features=/,
	/^--disable-features=/, /^--lang=/, /^--force-device-scale-factor=/, /^--allow-file-access/];

// argv without the executable (and, for `electron .`, without the app path).
// Returns {project, createShortcut, startup, help, version,
// disableAcceleration, error}.
export function parseArgs(argv)
{
	const res = {project: null, createShortcut: null, startup: null, help: false, version: false,
		disableAcceleration: false, error: null};
	const fail = (msg) =>
	{
		if (res.error == null) res.error = msg;
	};

	for (let i = 0; i < argv.length; i++)
	{
		const a = argv[i];

		if (typeof a !== 'string' || a === '')
		{
			continue;
		}

		if (a === '-h' || a === '--help')
		{
			res.help = true;
		}
		else if (a === '-v' || a === '--version')
		{
			res.version = true;
		}
		else if (a === '--disable-acceleration')
		{
			res.disableAcceleration = true;
		}
		else if (a === '--create-shortcut' || a.startsWith('--create-shortcut='))
		{
			const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];

			if (!SHORTCUT_PLACES.includes(v))
			{
				fail('--create-shortcut needs one of: ' + SHORTCUT_PLACES.join(', '));
			}

			res.createShortcut = v;
		}
		else if (a === '--startup' || a.startsWith('--startup='))
		{
			const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];

			if (v !== 'on' && v !== 'off')
			{
				fail('--startup needs on or off');
			}

			res.startup = v;
		}
		else if (a.startsWith('-'))
		{
			if (!PASSTHROUGH.some(r => r.test(a)))
			{
				fail('Unknown option: ' + a);
			}
		}
		else if (res.project == null)
		{
			res.project = a;
		}
		else
		{
			fail('Only one project can be given');
		}
	}

	if ((res.createShortcut != null || res.startup != null) && res.project == null)
	{
		fail('--create-shortcut and --startup need a project');
	}

	return res;
}

// The user's arguments from an argv (process.argv, or a second instance's):
// argv[0] is the executable, and for `electron .` (defaultApp) the app folder
// is among the arguments too. A second instance's argv comes reordered, with
// the switches first, so the app folder is found by where it points, not by
// its position. resolve(arg) gives an argument's absolute path.
export function userArgs(argv, {defaultApp, appPath, resolve})
{
	const rest = argv.slice(1);

	if (defaultApp)
	{
		const i = rest.findIndex(a => typeof a === 'string' && !a.startsWith('-') && resolve(a) === appPath);

		if (i >= 0)
		{
			rest.splice(i, 1);
		}
	}

	return rest;
}
