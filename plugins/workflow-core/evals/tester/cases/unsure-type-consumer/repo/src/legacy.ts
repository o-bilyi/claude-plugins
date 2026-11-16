export function initWidgets(): void {
	const root = document.getElementById('app');
	if (!root) return;
	root.dataset.ready = 'true';
	// eslint-disable-next-line
	jQuery(root).fadeIn();
}
