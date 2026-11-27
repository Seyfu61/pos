// Zeichnet Bon-Blöcke (siehe receipt.js) auf ein Canvas in Druckerauflösung.
// Dasselbe Bild dient als Vorschau und wird 1:1 an den Drucker geschickt –
// dadurch stimmen Umlaute, €-Zeichen und Layout unabhängig von Drucker-Zeichensätzen.

import { encode as encodeQr } from '../../vendor/uqr.js';

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const SIZES = { s: 21, m: 26, l: 36, lx: 44, xl: 48, xxl: 56, xxxl: 64 };

/** Bedruckbare Breite in Punkten (203 dpi): 80 mm -> 576, 58 mm -> 384 */
export function paperDots(mm) {
  return mm >= 72 ? 576 : 384;
}

function wrap(ctx, str, maxWidth) {
  const out = [];
  for (const para of String(str).split('\n')) {
    let line = '';
    for (let word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      // Einzelnes Wort breiter als die Zeile: hart umbrechen.
      while (ctx.measureText(word).width > maxWidth && word.length > 1) {
        let n = word.length - 1;
        while (n > 1 && ctx.measureText(word.slice(0, n)).width > maxWidth) n--;
        out.push(word.slice(0, n));
        word = word.slice(n);
      }
      line = word;
    }
    out.push(line);
  }
  return out;
}

function fit(ctx, str, maxWidth) {
  let s = String(str);
  while (s.length > 1 && ctx.measureText(s).width > maxWidth) s = s.slice(0, -1);
  return s;
}

export function renderBlocks(blocks, { width = 576 } = {}) {
  const pad = 4;
  const inner = width - pad * 2;
  const mctx = document.createElement('canvas').getContext('2d');
  const font = (size = 'm', bold = false) => `${bold ? 700 : 500} ${SIZES[size] ?? SIZES.m}px ${FONT}`;
  const lineHeight = (size = 'm') => Math.round((SIZES[size] ?? SIZES.m) * 1.3);
  const ops = [];
  let y = 6;

  const drawText = (str, x, baseline, f, align = 'left', color = '#000') =>
    ops.push((ctx) => {
      ctx.font = f;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.fillText(str, x, baseline);
    });

  for (const b of blocks) {
    const f = font(b.size, b.bold);
    const lh = lineHeight(b.size);
    const ascent = Math.round((SIZES[b.size] ?? SIZES.m) * 0.98);
    const indent = b.indent ?? 0;
    mctx.font = f;

    if (b.t === 'text') {
      for (const line of wrap(mctx, b.text, inner - indent)) {
        const x = b.align === 'center' ? width / 2 : b.align === 'right' ? width - pad : pad + indent;
        drawText(line, x, y + ascent, f, b.align ?? 'left');
        y += lh;
      }
    } else if (b.t === 'row') {
      const right = String(b.right ?? '');
      const rw = right ? mctx.measureText(right).width + 16 : 0;
      const lines = wrap(mctx, b.left, inner - indent - rw);
      if (right) drawText(right, width - pad, y + ascent, f, 'right');
      for (const line of lines) {
        drawText(line, pad + indent, y + ascent, f);
        y += lh;
      }
    } else if (b.t === 'cols') {
      let x = pad;
      for (const cell of b.cells) {
        const w = inner * cell.w;
        const s = fit(mctx, cell.text, w - 4);
        if (cell.align === 'right') drawText(s, x + w, y + ascent, f, 'right');
        else if (cell.align === 'center') drawText(s, x + w / 2, y + ascent, f, 'center');
        else drawText(s, x, y + ascent, f);
        x += w;
      }
      y += lh;
    } else if (b.t === 'box') {
      const bf = font(b.size, true);
      mctx.font = bf;
      const lines = wrap(mctx, b.text, inner - 16);
      const h = lines.length * lh + 12;
      const top = y;
      ops.push((ctx) => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, top, width, h);
      });
      lines.forEach((line, i) => drawText(line, width / 2, top + 6 + i * lh + ascent, bf, 'center', '#fff'));
      y += h;
    } else if (b.t === 'qr') {
      // Fehlerkorrektur M; rundum bleibt die vorgeschriebene Ruhezone von 4 Modulen weiß.
      const qr = encodeQr(b.data, { ecc: 'M', border: 0 });
      const scale = Math.max(3, Math.min(6, Math.floor((inner * 0.62) / qr.size)));
      const side = qr.size * scale;
      const left = Math.round((width - side) / 2);
      const top = y + 4 * scale;
      ops.push((ctx) => {
        ctx.fillStyle = '#000';
        for (let r = 0; r < qr.size; r++) {
          for (let c = 0; c < qr.size; c++) if (qr.data[r][c]) ctx.fillRect(left + c * scale, top + r * scale, scale, scale);
        }
      });
      y = top + side + 4 * scale;
      if (b.caption) {
        const cf = font('s', false);
        mctx.font = cf;
        for (const line of wrap(mctx, b.caption, inner)) {
          drawText(line, width / 2, y + Math.round(SIZES.s * 0.98), cf, 'center');
          y += lineHeight('s');
        }
        y += 6;
      }
    } else if (b.t === 'rule') {
      const yy = y + 9;
      ops.push((ctx) => {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.setLineDash(b.dashed ? [8, 6] : []);
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(width, yy);
        ctx.stroke();
        ctx.setLineDash([]);
      });
      y += 18;
    } else if (b.t === 'space') {
      y += b.h ?? 10;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.ceil(y + 6);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'alphabetic';
  for (const op of ops) op(ctx);
  return canvas;
}
