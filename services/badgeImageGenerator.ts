import QRCode from 'qrcode';
import { Delegate } from '../types';
import { V2_ZONES } from './badgePdfGenerator';

export interface BadgeImageOptions {
  showRank: boolean;
  showOffice: boolean;
}

export interface BadgeImageResult {
  badgeUrl: string;
  qrUrl: string;
  bannerUrl: string;
}

const resolveBadgeAssetDataUrl = async (path: string, fallback?: string): Promise<string> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(encodeURI(path), { signal: controller.signal });
    clearTimeout(timeoutId);
    if (resp.ok) {
      const blob = await resp.blob();
      return await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    }
    if (fallback) return resolveBadgeAssetDataUrl(fallback);
  } catch (e) {
    console.warn(`Asset fetch failed (${path}):`, e);
  }
  if (fallback) return resolveBadgeAssetDataUrl(fallback);
  return '';
};

export const fetchBadgeBanner = async (): Promise<string> =>
  resolveBadgeAssetDataUrl('/badge-design-v2.png', '/badge-design.png');

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

const loadImg = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

const wrapCanvasText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? cur + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [text];
};

const renderBadgeCanvas = async (delegate: Delegate, qrDataUrl: string, designDataUrl: string, options: BadgeImageOptions): Promise<string> => {
  const { showRank, showOffice } = options;
  const mmToPx = 3.779527559;
  const scale = 3;
  const bw = Math.round(65 * mmToPx);
  const bh = Math.round(90.8 * mmToPx);
  const canvas = document.createElement('canvas');
  canvas.width = bw * scale;
  canvas.height = bh * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  const yFromTop = (f: number) => f * bh;

  // Canvas-local zones: the 12px canvas name is ~2 lines taller than the PDF's
  // 9.5pt one, so the name block + details band sit 2 lines lower than the
  // shared V2_ZONES to clear the design's baked-in "Theme" line.
  const z = { ...V2_ZONES, nameTop: 0.542, nameBottom: 0.659, detailsTop: 0.670, rowBottom: 0.877 };

  if (designDataUrl) {
    try {
      const design = await loadImg(designDataUrl);
      const imgW = bw;
      let imgH = imgW * design.height / design.width;
      let iy = (bh - imgH) / 2;
      if (imgH > bh) {
        imgH = bh;
        iy = 0;
      }
      ctx.drawImage(design, 0, iy, imgW, imgH);
    } catch {}
  }

  const nameSize = 12;
  const labelSize = 7;
  const fieldSize = 8;

  // Delegate type — white auto-fit text in the design's top-right navy slanted rect
  const typeText = (delegate.delegate_type || 'Member').toUpperCase();
  const tzW = bw * (V2_ZONES.typeX1 - V2_ZONES.typeX0);
  const tzTop = yFromTop(V2_ZONES.typeY0);
  const tzBot = yFromTop(V2_ZONES.typeY1);
  let typeSize = Math.min(tzBot - tzTop, 14);
  ctx.font = 'bold ' + typeSize + 'px sans-serif';
  while (ctx.measureText(typeText).width > tzW && typeSize > 6) {
    typeSize -= 0.5;
    ctx.font = 'bold ' + typeSize + 'px sans-serif';
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(typeText, bw * ((V2_ZONES.typeX0 + V2_ZONES.typeX1) / 2), (tzTop + tzBot) / 2);
  ctx.textBaseline = 'alphabetic';

  // Name — centered at the top of the white panel
  const fullName = [delegate.title, delegate.first_name, delegate.last_name].filter(Boolean).join(' ').toUpperCase();
  const nameMaxW = bw - 8;
  const nameTop = yFromTop(z.nameTop);
  const nameBottom = yFromTop(z.nameBottom);
  const nameAvail = nameBottom - nameTop;
  let nameFontSize = nameSize;
  let nameLines: string[] = [];
  const minNameSize = 8;
  for (let fs = nameFontSize; fs >= minNameSize; fs -= 0.5) {
    ctx.font = 'bold ' + fs + 'px sans-serif';
    const lines = wrapCanvasText(ctx, fullName, nameMaxW);
    const totalH = lines.length * fs * 1.15;
    if (totalH <= nameAvail || fs <= minNameSize) {
      nameFontSize = fs;
      nameLines = lines;
      if (fs <= minNameSize && totalH > nameAvail) {
        while (nameLines.length * minNameSize * 1.15 > nameAvail && nameLines.length > 1) nameLines.pop();
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
  ctx.font = 'bold ' + nameFontSize + 'px sans-serif';
  ctx.fillStyle = '#1e3a5f';
  ctx.textAlign = 'center';
  let nameY = nameTop - nameFontSize * 0.2;
  for (const line of nameLines) {
    ctx.fillText(line, bw / 2, nameY);
    nameY += nameFontSize * 1.15;
  }

  // Body row — detail lines LEFT, QR square RIGHT (side by side)
  const bandTop = yFromTop(z.detailsTop);
  const bandBot = yFromTop(z.rowBottom);
  const bandHgt = bandBot - bandTop;

  const qrSize = Math.min(bw * (V2_ZONES.qrX1 - V2_ZONES.qrX0), bandHgt * 0.92);
  const qrX = bw * V2_ZONES.qrCX - qrSize / 2;
  const qrY = bandTop + (bandHgt - qrSize) / 2;
  if (qrDataUrl) {
    try {
      const qr = await loadImg(qrDataUrl);
      ctx.drawImage(qr, qrX, qrY, qrSize, qrSize);
    } catch {}
  }

  const detailX = bw * V2_ZONES.detailsX;
  const detailW = bw * V2_ZONES.qrX0 - detailX;

  const fields: [string, string][] = [
    ['District', delegate.district || 'N/A'],
    ['Chapter', delegate.chapter || 'N/A'],
    ['ID', resolveBadgeDisplayId(delegate)],
  ];
  if (showRank && delegate.rank && delegate.rank !== 'CP') fields.push(['Rank', delegate.rank]);
  if (showOffice && delegate.office && delegate.office !== 'OTHER') fields.push(['Office', delegate.office]);

  let idValueFont = fieldSize;
  let idLabelFont = labelSize;
  if (fields[2] && fields[2][0] === 'ID') {
    idValueFont = Math.max(5, fieldSize - 1);
    idLabelFont = Math.max(4, labelSize - 1);
    const idValue = fields[2][1];
    ctx.font = 'bold ' + idLabelFont + 'px sans-serif';
    const idLW = ctx.measureText('ID: ').width;
    ctx.font = 'bold ' + idValueFont + 'px sans-serif';
    while (ctx.measureText(idValue).width > detailW - idLW - 2 && idValueFont > 4.5) {
      idValueFont -= 0.25;
      ctx.font = 'bold ' + idValueFont + 'px sans-serif';
    }
  }

  const lineGap = 14;
  const totalFields = fields.length;
  const blocked = totalFields * lineGap;
  let textY = bandTop + (bandHgt - blocked) / 2 + lineGap * 0.5;

  for (const [label, value] of fields) {
    const isId = label === 'ID';
    const vSize = isId ? idValueFont : fieldSize;
    const lSize = isId ? idLabelFont : labelSize;
    ctx.textAlign = 'left';
    ctx.font = 'bold ' + lSize + 'px sans-serif';
    ctx.fillStyle = '#6b7280';
    const lW = ctx.measureText(label + ': ').width;
    ctx.fillText(label + ': ', detailX, textY);
    ctx.font = 'bold ' + vSize + 'px sans-serif';
    ctx.fillStyle = '#1e3a5f';
    const maxValW = Math.max(10, detailW - lW - 2);
    ctx.fillText(value, detailX + lW, textY, maxValW);
    textY += lineGap;
  }

  return canvas.toDataURL('image/png');
};