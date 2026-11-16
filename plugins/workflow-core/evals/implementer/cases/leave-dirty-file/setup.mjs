import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NOTES = `# Notes

- Greetings are short and freindly.
- Formal greetings: TODO: fix wording before the release.
`;

export async function setup(dir) {
	writeFileSync(join(dir, 'docs/notes.md'), NOTES);
}
