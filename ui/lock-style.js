// Runs before the page paints: apply the chosen lock-screen layout, so there is no flash of the other one.
document.documentElement.dataset.lockLayout = localStorage.getItem('lockLayout') === 'card' ? 'card' : 'device';
