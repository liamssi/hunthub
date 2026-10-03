// Whether this browser tab is in front (terminals stop their frames while it isn't).
export const pageVisibility = $state({ visible: typeof document === 'undefined' || document.visibilityState === 'visible' });

if (typeof document !== 'undefined') {
	document.addEventListener('visibilitychange', () => (pageVisibility.visible = document.visibilityState === 'visible'));
}
