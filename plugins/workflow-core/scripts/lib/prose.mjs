// A small ASD-STE100 ("STE-lite") checker for Markdown and plain text. It checks only what a script can
// decide: sentence length, paragraph length, passive voice and words that have a simpler replacement.
// It skips frontmatter, code fences, inline code, tables, headings and HTML comments.

export const LIMITS = { procedural: 20, descriptive: 25, paragraph: 6 };

// Words that start an instruction. A sentence that starts with one is procedural.
const IMPERATIVE = new Set(
	`add allow ask build change check choose clear close commit compare copy create delete describe do
	edit end exit fill find fix follow get give go keep leave let list look make mark match move name
	note open pass pick print pull push put read record remove rename replace report reset resume return
	run save say search see send set show skip split start stop take tell try turn update use verify
	wait write`.split(/\s+/)
);

// Word (lowercase) → the simpler word to use. Multi-word keys match across spaces.
export const REPLACEMENTS = {
	utilize: 'use',
	utilise: 'use',
	leverage: 'use',
	approximately: 'about',
	numerous: 'many',
	'prior to': 'before',
	'in order to': 'to',
	commence: 'start',
	terminate: 'stop',
	sufficient: 'enough',
	additional: 'more',
	assist: 'help',
	obtain: 'get',
	perform: 'do',
	ensure: 'make sure',
	via: 'through',
	'e.g.': 'for example',
	'i.e.': 'that is',
	'etc.': 'and other',
	whilst: 'while',
	whereas: 'but',
	subsequently: 'then',
	'in the event that': 'if',
	'due to the fact that': 'because',
	facilitate: 'help',
	endeavor: 'try',
	modify: 'change',
	initiate: 'start',
	'a number of': 'some',
	'in addition': 'also',
	however: 'but',
};

const IRREGULAR =
	`built done given kept known made seen sent shown taken written found left told held
	brought chosen thrown hidden broken spent begun drawn driven fallen forgotten grown laid led lost
	meant met paid said sold shut spoken taught thought understood won run set put read`.split(/\s+/);
// Words that end in -ed but are not participles, or are adjectives here.
const NOT_PARTICIPLE = new Set(
	`red bed need seed speed feed embed shed hundred touched unchanged untouched untracked unrelated unused
	unsupported unexpected limited detailed advanced`.split(/\s+/)
);
const PASSIVE = new RegExp(
	`\\b(is|are|was|were|be|been|being)\\s+(?:not\\s+)?(?:\\w+ly\\s+)?(\\w+ed|${IRREGULAR.join('|')})\\b`,
	'gi'
);

function words(sentence) {
	return sentence.match(/[A-Za-z0-9À-ɏ][\w'’.-]*/g) ?? [];
}

function stripInline(text) {
	return text
		.replace(/`[^`]*`/g, ' CODE ')
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/https?:\/\/\S+/g, ' URL ')
		.replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1')
		.replace(/<[^>]+>/g, ' ');
}

// Returns [{ text, line, list }] blocks: paragraphs and list items, with their first line (1-based).
function blocks(text) {
	const lines = text.split('\n');
	const out = [];
	let i = 0;
	if (lines[0] === '---') {
		const end = lines.indexOf('---', 1);
		if (end > 0) i = end + 1;
	}
	let fence = null;
	let comment = false;
	let current = null;
	let ignoreNext = false;
	const flush = () => {
		if (current && !current.ignore) out.push(current);
		current = null;
	};
	for (; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		if (fence) {
			if (trimmed.startsWith(fence)) fence = null;
			continue;
		}
		const open = trimmed.match(/^(```|~~~)/);
		if (open) {
			flush();
			ignoreNext = false;
			fence = open[1];
			continue;
		}
		if (comment) {
			if (trimmed.includes('-->')) comment = false;
			continue;
		}
		if (trimmed.startsWith('<!--')) {
			flush();
			if (trimmed.includes('prose-ignore')) ignoreNext = true;
			if (!trimmed.includes('-->')) comment = true;
			continue;
		}
		if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('|')) {
			flush();
			continue;
		}
		const item = trimmed.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
		if (item) {
			flush();
			current = { text: item[1], line: i + 1, list: true, ignore: ignoreNext };
			ignoreNext = false;
			continue;
		}
		if (!current) {
			current = { text: trimmed, line: i + 1, list: false, ignore: ignoreNext };
			ignoreNext = false;
		} else current.text += ` ${trimmed}`;
	}
	flush();
	return out;
}

function sentences(text) {
	return stripInline(text)
		.split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
		.map(s => s.trim())
		.filter(s => words(s).length > 0);
}

function isProcedural(sentence) {
	const first = words(sentence)[0]?.toLowerCase();
	return Boolean(first && IMPERATIVE.has(first));
}

export function lintProse(text, limits = LIMITS) {
	const issues = [];
	const add = (line, rule, message) => issues.push({ line, rule, message });
	for (const block of blocks(text)) {
		const list = sentences(block.text);
		if (!block.list && list.length > limits.paragraph) {
			add(
				block.line,
				'paragraph',
				`${list.length} sentences in one paragraph (max ${limits.paragraph})`
			);
		}
		for (const sentence of list) {
			const count = words(sentence).length;
			const procedural = isProcedural(sentence);
			const max = procedural ? limits.procedural : limits.descriptive;
			if (count > max) {
				const kind = procedural ? 'instruction' : 'sentence';
				add(
					block.line,
					'length',
					`${kind} has ${count} words (max ${max}): "${sentence.slice(0, 60)}…"`
				);
			}
			for (const m of sentence.matchAll(PASSIVE)) {
				if (NOT_PARTICIPLE.has(m[2].toLowerCase())) continue;
				add(block.line, 'passive', `passive voice "${m[0]}": say who does it`);
			}
			const lower = ` ${sentence.toLowerCase().replace(/\s+/g, ' ')} `;
			for (const [word, use] of Object.entries(REPLACEMENTS)) {
				const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				if (new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`).test(lower)) {
					add(block.line, 'word', `"${word}": use "${use}"`);
				}
			}
		}
	}
	return issues;
}

export function renderProse(results) {
	const lines = [];
	for (const { file, issues } of results) {
		for (const i of issues) lines.push(`${file}:${i.line}: ${i.rule}: ${i.message}`);
	}
	const total = results.reduce((n, r) => n + r.issues.length, 0);
	lines.push(total ? `${total} writing issue(s)` : 'No writing issues.');
	return lines.join('\n');
}
