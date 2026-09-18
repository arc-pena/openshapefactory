import { App } from './core/App.js';

const canvas = document.getElementById('stage');

function fail(message) {
  const preloader = document.getElementById('preloader');
  if (preloader) {
    preloader.innerHTML = `<p style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;opacity:.6">${message}</p>`;
  }
}

if (!canvas.getContext('webgl2') && !canvas.getContext('webgl')) {
  fail('WebGL unavailable');
} else {
  const app = new App(canvas);
  app.init().catch((error) => {
    console.error(error);
    fail('Could not start the world');
  });
  window.__app = app; // handy while tuning
}
