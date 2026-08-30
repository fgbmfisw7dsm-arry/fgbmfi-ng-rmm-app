import QRCode from 'qrcode';
import { Delegate } from '../types';

export interface BadgeImageOptions {
  showRank: boolean;
  showOffice: boolean;
}

export interface BadgeImageResult {
  badgeUrl: string;
  qrUrl: string;
  bannerUrl: string;
}

export const fetchBadgeBanner = async (): Promise<string> => {
  let bannerResp = '';
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(encodeURI('/badge-design.png'), { signal: controller.signal });
    clearTimeout(timeoutId);
    if (resp.ok) {
      const blob = await resp.blob();
      bannerResp = await new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    }
  } catch (fetchErr) {
    console.warn('Banner fetch failed, badge will render without banner:', fetchErr);
  }
  return bannerResp;
};

export const generateBadgeImage = async (delegate: Delegate, options: BadgeImageOptions): Promise<BadgeImageResult> => {
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, delegate.qr_hash, { width: 400, margin: 1, color: { dark: '#1e3a5f' } });
  const qrUrl = qrCanvas.toDataURL('image/png');

  const bannerUrl = await fetchBadgeBanner();

  const badgeUrl = await renderBadgeCanvas(delegate, qrUrl, bannerUrl, options);
  return { badgeUrl, qrUrl, bannerUrl };
};

export const resolveBadgeDisplayId = (delegate: Delegate): string =>
  delegate.external_id?.startsWith('CON26') ? delegate.external_id : delegate.delegate_id.slice(0, 8);

const renderBadgeCanvas = async (delegate: Delegate, qrDataUrl: string, bannerDataUrl: string, options: BadgeImageOptions): Promise<string> => {
  const { showRank, showOffice } = options;
  const mmToPx = 3.779527559;
  const scale = 3;
  const bw = Math.round(63 * mmToPx);
  const bh = Math.round(90 * mmToPx);
  const canvas = document.createElement('canvas');
  canvas.width = bw * scale;
  canvas.height = bh * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  const headerH = bh * 0.29;
  const bodyH = bh * 0.64;
  const bandH = bh * 0.07;
  const bandTop = headerH + bodyH;

  if (bannerDataUrl) {
    try {
      const design = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = bannerDataUrl;
      });
      const cardAspect = design.width / design.height;
      const badgeAspect = bw / bh;
      let imgW: number;
      let imgH: number;
      if (cardAspect > badgeAspect) {
        imgH = bh;
        imgW = bh * cardAspect;
      } else {
        imgW = bw;
        imgH = bw / cardAspect;
      }
      const ix = (bw - imgW) / 2;
      const iy = (bh - imgH) / 2;
      ctx.drawImage(design, ix, iy, imgW, imgH);
    } catch {}
  }

  const bodyTop = headerH;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, bodyTop, bw, bodyH);

  if (qrDataUrl) {
    try {
      const qr = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = qrDataUrl;
      });
      const qrSize = Math.min(bw * 0.48, bh * 0.385);
      const qrX = (bw - qrSize) / 2;
      const qrY = bodyTop + 8;
      ctx.drawImage(qr, qrX, qrY, qrSize, qrSize);

      const wrapCanvasText = (ctx2: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
        const words = text.split(' ');
        const lines: string[] = [];
        let cur = '';
        for (const word of words) {
          const test = cur ? cur + ' ' + word : word;
          if (ctx2.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = word; }
          else { cur = test; }
        }
        if (cur) lines.push(cur);
        return lines.length > 0 ? lines : [text];
      };

      const fullName = [delegate.title, delegate.first_name, delegate.last_name].filter(Boolean).join(' ').toUpperCase();
      const nameMaxW = bw - 16;
      const nameY = qrY + qrSize + 16;
      const fieldCount = 3 + (showOffice && delegate.office ? 1 : 0) + (showRank && delegate.rank ? 1 : 0);
      const lineGap = 18;
      const fieldsNeeded = fieldCount * lineGap;
      const bodyBottom = bodyTop + bodyH;
      const availForName = bodyBottom - nameY - fieldsNeeded - 8;

      let nameFontSize = 14;
      let nameLines: string[] = [];
      const minNameSize = 9;

      for (let fs = nameFontSize; fs >= minNameSize; fs -= 0.5) {
        ctx.font = 'bold ' + fs + 'px sans-serif';
        const lines = wrapCanvasText(ctx, fullName, nameMaxW);
        const totalH = lines.length * fs * 1.15;
        if (totalH <= availForName || fs <= minNameSize) {
          nameFontSize = fs;
          nameLines = lines;
          if (fs <= minNameSize && totalH > availForName) {
            while (nameLines.length * minNameSize * 1.15 > availForName && nameLines.length > 1) nameLines.pop();
            if (nameLines.length > 0) {
              let last = nameLines[nameLines.length - 1];
              ctx.font = 'bold ' + minNameSize + 'px sans-serif';
              while (ctx.measureText(last + '\u2026').width > nameMaxW && last.length > 1) last = last.slice(0, -1);
              nameLines[nameLines.length - 1] = last + '\u2026';
            }
          }
          break;
        }
      }

      ctx.fillStyle = '#1e3a5f';
      ctx.textAlign = 'center';
      let currentNameY = nameY;
      for (const line of nameLines) {
        ctx.font = 'bold ' + nameFontSize + 'px sans-serif';
        ctx.fillText(line, bw / 2, currentNameY);
        currentNameY += nameFontSize * 1.15;
      }

      let textY = currentNameY + 4;

      ctx.fillStyle = '#4b5563';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText('District: ' + (delegate.district || 'N/A'), bw / 2, textY);
      textY += lineGap;

      ctx.fillStyle = '#4b5563';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText('Chapter: ' + (delegate.chapter || 'N/A'), bw / 2, textY);
      textY += lineGap;

      if (showOffice && delegate.office) {
        ctx.fillStyle = '#4b5563';
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText('Office: ' + delegate.office, bw / 2, textY);
        textY += lineGap;
      }
      if (showRank && delegate.rank) {
        ctx.fillStyle = '#4b5563';
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText('Rank: ' + delegate.rank, bw / 2, textY);
        textY += lineGap;
      }

      ctx.fillStyle = '#1e3a5f';
      ctx.font = 'bold 8px sans-serif';
      const displayId = resolveBadgeDisplayId(delegate);
      ctx.fillText('ID: ' + displayId, bw / 2, textY);
    } catch {}
  }

  const dt = delegate.delegate_type || 'Member';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(dt.toUpperCase(), bw / 2, bandTop + bandH / 2 + 3);

  return canvas.toDataURL('image/png');
};