// Runs before the page paints: apply the chosen lock-screen style, so there is no flash of the other one.
document.documentElement.dataset.lockStyle = localStorage.getItem('lockStyle') === 'dial' ? 'dial' : 'card';
