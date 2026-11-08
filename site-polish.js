// Block standard page copying while retaining normal form entry and paste.
const isField = (target) => target instanceof Element && !!target.closest('input, textarea, [contenteditable="true"]');
document.addEventListener('copy', (event) => event.preventDefault());
document.addEventListener('cut', (event) => event.preventDefault());
document.addEventListener('selectstart', (event) => { if (!isField(event.target)) event.preventDefault(); });
document.addEventListener('contextmenu', (event) => { if (!isField(event.target)) event.preventDefault(); });
document.addEventListener('dragstart', (event) => { if (!isField(event.target)) event.preventDefault(); });
