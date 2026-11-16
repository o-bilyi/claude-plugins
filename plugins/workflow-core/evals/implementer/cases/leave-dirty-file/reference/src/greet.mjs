export function greet(name, { formal = false } = {}) {
	return formal ? `Good day, ${name}.` : `Hi, ${name}!`;
}
