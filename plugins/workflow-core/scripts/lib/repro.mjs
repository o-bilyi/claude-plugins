import { reproduction } from './plan.mjs';
import { excerpt, runCommand } from './run.mjs';
import { readRun, writeRun } from './runstate.mjs';
import { touched } from './touched.mjs';

// The touched files as `<sha> <path>` entries, by path.
function entriesByPath(model) {
	const map = new Map();
	for (const repo of Object.values(touched(model).repos)) {
		for (const entry of repo.projectEntries) map.set(entry.slice(entry.indexOf(' ') + 1), entry);
	}
	return map;
}

// Runs the reproduction command of a bug plan. The first run must fail: that shows the bug. The script
// then keeps the hash of each touched file (the new test). A later run must pass, and those files must
// not change: a fix must not make the test weaker.
export async function runRepro(model, dir, planText) {
	const repro = reproduction(planText);
	if (!repro) throw new Error('repro: the plan of the run has no Reproduction part');
	const run = readRun(dir);
	const ask = (status, reason, extra = {}) => {
		run.asked = true;
		writeRun(dir, run);
		return { status, next: 'ask', reason, ok: true, ...extra };
	};
	if (!repro.command) return ask('manual', `manual reproduction: ${repro.manual}`);

	const names = Object.keys(model.units);
	const unit = model.units[repro.unit ?? (names.length === 1 ? names[0] : '')];
	if (!unit) throw new Error('repro: the Reproduction part needs a `Unit:` line with a unit');
	const result = await runCommand(repro.command, unit.path);
	const passed = result.code === 0;
	const output = excerpt(result.output, 'tail');
	const now = entriesByPath(model);

	if (!run.repro) {
		if (passed) {
			return ask('not-reproduced', 'the command passes before the fix: the bug is not reproduced', {
				output,
			});
		}
		run.repro = { status: 'reproduced', at: new Date().toISOString(), files: [...now.values()] };
		writeRun(dir, run);
		return { status: 'reproduced', next: 'fix', ok: true, output };
	}

	const changed = run.repro.files
		.filter(entry => now.get(entry.slice(entry.indexOf(' ') + 1)) !== entry)
		.map(entry => entry.slice(entry.indexOf(' ') + 1));
	if (changed.length) {
		run.repro.changed = changed;
		return ask(
			'test-changed',
			`the reproduction files changed after they failed: ${changed.join(', ')}`
		);
	}
	run.repro.status = passed ? 'fixed' : 'still-failing';
	writeRun(dir, run);
	if (passed) return { status: 'fixed', next: 'continue', ok: true };
	return { status: 'still-failing', next: 'fix', ok: false, output };
}

export function renderRepro(result) {
	const lines = [`REPRO: ${result.status}`];
	if (result.output) lines.push(result.output);
	lines.push(`NEXT: ${result.next}${result.reason ? ` (${result.reason})` : ''}`);
	return lines.join('\n');
}
