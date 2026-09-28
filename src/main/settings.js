// The launcher's few settings (recent projects), in userData/settings.json.
// A plain JSON file written atomically keeps the app free of a settings
// library.

import fs from 'fs';
import path from 'path';

export const MAX_RECENT = 10;

export class Settings
{
	constructor(dir)
	{
		this.file = path.join(dir, 'settings.json');
		this.data = {recent: []};

		try
		{
			const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));

			if (raw != null && typeof raw === 'object' && Array.isArray(raw.recent))
			{
				this.data.recent = raw.recent.filter(p => typeof p === 'string' && /\.(ahmi|drawio-hmi)$/i.test(p))
					.slice(0, MAX_RECENT);
			}
		}
		catch (e)
		{
			// Missing or damaged: start empty
		}
	}

	get recent()
	{
		return this.data.recent.slice();
	}

	// Most recent first; one entry per file (case-insensitively on Windows)
	addRecent(file, platform = process.platform)
	{
		const same = (a) => (platform === 'win32') ? a.toLowerCase() === file.toLowerCase() : a === file;
		this.data.recent = [file].concat(this.data.recent.filter(p => !same(p))).slice(0, MAX_RECENT);
		this.save();
	}

	removeRecent(file)
	{
		this.data.recent = this.data.recent.filter(p => p !== file);
		this.save();
	}

	save()
	{
		const tmp = this.file + '.' + process.pid + '.tmp';

		try
		{
			fs.mkdirSync(path.dirname(this.file), {recursive: true});
			fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
			fs.renameSync(tmp, this.file);
		}
		catch (e)
		{
			try { fs.rmSync(tmp, {force: true}); } catch (e2) {}
		}
	}
}
