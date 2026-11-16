import { join, relative } from 'node:path';
import { saveBaseline, selectUnits } from './baseline.mjs';
import { git } from './git.mjs';
import { currentEntries, entryPath } from './touched.mjs';

function ticketCase(ticket, pattern) {
	const letters = pattern.replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');
	if (/[A-Z]/.test(letters) && !/[a-z]/.test(letters)) return ticket.toUpperCase();
	if (/[a-z]/.test(letters) && !/[A-Z]/.test(letters)) return ticket.toLowerCase();
	return ticket;
}

export function branchTicket(branch, pattern) {
	const match = branch ? new RegExp(pattern, 'i').exec(branch) : null;
	return match ? ticketCase(match[0], pattern) : null;
}

export async function preflight(model, names = [], { force = false } = {}) {
	const units = selectUnits(model, names);
	const { config } = model;
	const checkTicket = config.process.preflight.branchTicket && Boolean(config.pr.ticketPattern);
	const repos = {};
	for (const key of new Set(units.map(unit => unit.repo))) {
		const repo = model.repos[key];
		const branch = git(repo.path, ['branch', '--show-current'])?.trim() || null;
		const dirty = currentEntries(repo).map(entry =>
			relative(model.root, join(repo.path, entryPath(entry)))
		);
		repos[key] = {
			branch,
			ticket: checkTicket ? branchTicket(branch, config.pr.ticketPattern) : undefined,
			ticketChecked: checkTicket,
			dirty,
			units: units.filter(unit => unit.repo === key).map(unit => unit.name),
		};
	}
	const baseline = await saveBaseline(model, names, { force });
	return { repos, baseline };
}

export function renderPreflight(result) {
	const lines = [];
	for (const [key, repo] of Object.entries(result.repos)) {
		lines.push(`## repo ${key} (${repo.units.join(', ')})`);
		lines.push(`branch: ${repo.branch ?? '(detached HEAD)'}`);
		if (repo.ticketChecked) lines.push(`ticket: ${repo.ticket ?? 'missing'}`);
		if (repo.dirty.length)
			lines.push(`dirty files (${repo.dirty.length}):`, ...repo.dirty.map(f => `- ${f}`));
		else lines.push('dirty files: none');
		lines.push('');
	}
	lines.push(renderBaselineSave(result.baseline));
	return lines.join('\n').trimEnd();
}

export function renderBaselineSave(result) {
	if (!result.saved) return result.message;
	const lines = ['Baseline saved:'];
	for (const [key, repo] of Object.entries(result.repos)) {
		for (const [unit, checks] of Object.entries(repo.units)) {
			const parts = Object.entries(checks).map(([name, c]) => {
				if (c.count !== undefined) return `${name} ${c.count} errors`;
				if (c.unparseable) return `${name} unparseable (${c.unparseable})`;
				return `${name} skipped (${c.skipped})`;
			});
			lines.push(`- ${key}/${unit}: ${parts.join(', ') || 'no parser checks'}`);
		}
		lines.push(`- ${key}: ${repo.dirty} dirty file(s) recorded`);
	}
	return lines.join('\n');
}
