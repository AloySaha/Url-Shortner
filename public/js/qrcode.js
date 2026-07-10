/**
 * Thin QR helper. Prefers the full qrcode library when loaded from CDN;
 * falls back to a remote PNG endpoint so the UI still works offline-of-lib.
 */
(function (global) {
  'use strict';

  function drawWithLibrary(canvas, text, options) {
    return new Promise((resolve, reject) => {
      const QR = global.QRCodeLib || global.QRCode;
      if (!QR || typeof QR.toCanvas !== 'function') {
        reject(new Error('library missing'));
        return;
      }
      QR.toCanvas(
        canvas,
        text,
        {
          width: canvas.width,
          margin: options && options.margin != null ? options.margin : 2,
          color: {
            dark: (options && options.foreground) || '#0b1220',
            light: (options && options.background) || '#ffffff',
          },
        },
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  function drawWithImage(canvas, text) {
    return new Promise((resolve, reject) => {
      const size = canvas.width || 180;
      const src =
        'https://api.qrserver.com/v1/create-qr-code/?size=' +
        size +
        'x' +
        size +
        '&margin=8&data=' +
        encodeURIComponent(text);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve();
      };
      img.onerror = () => reject(new Error('QR image failed'));
      img.src = src;
    });
  }

  async function drawToCanvas(canvas, text, options) {
    try {
      await drawWithLibrary(canvas, text, options || {});
    } catch {
      await drawWithImage(canvas, text);
    }
  }

  // Public API used by app.js
  global.QRCode = { drawToCanvas };
})(typeof window !== 'undefined' ? window : globalThis);
