const dots = cmd => cmd.replaceAll('{files}', '.').replaceAll('{code}', '.');
const cell = cmds => (cmds.length ? cmds.map(c => `\`${c}\``).join(' + ') : '-');

export function renderTable(config) {
	const units = Object.entries(config.units);
	const runs = (unit, kind) =>
		unit.checks.filter(c => c.kind === kind && c.run).map(c => dots(c.run));

	const lines = ['| App | Dir | Typecheck | Lint | Tests |', '| --- | --- | --- | --- | --- |'];
	for (const [name, unit] of units) {
		const columns = ['typecheck', 'lint', 'test'].map(kind => cell(runs(unit, kind)));
		lines.push(`| ${name} | ${unit.dir} | ${columns.join(' | ')} |`);
	}

	const notes = units.filter(([, unit]) => unit.notes);
	if (notes.length) {
		lines.push('', 'Notes:', ...notes.map(([name, unit]) => `- ${name}: ${unit.notes}`));
	}

	const others = Object.entries(config.units).flatMap(([name, unit]) =>
		unit.checks.filter(c => c.kind === 'other').map(check => ({ name, unit, check }))
	);
	if (others.length) {
		lines.push(
			'',
			'Extras:',
			...others.map(
				x => `- ${x.name} (${x.check.name}, from ${x.unit.dir}): \`${dots(x.check.run)}\``
			)
		);
	}

	return lines.join('\n');
}
