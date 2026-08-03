import { PDFDocument, StandardFonts, rgb, PDFPage } from 'pdf-lib';
import { Delegate, Event, BadgeLayout, BadgeLayoutConfig, BadgeGenerationProgress } from '../types';
import QRCode from 'qrcode';

const PT_PER_MM = 72 / 25.4;
const mmToPt = (mm: number) => mm * PT_PER_MM;

const A4 = { w: mmToPt(210), h: mmToPt(297) };

const LAYOUTS: Record<BadgeLayout, BadgeLayoutConfig> = {
  '8-up': { cols: 2, rows: 4, badgeW: 90, badgeH: 60, cutGap: 3 },
  '10-up': { cols: 2, rows: 5, badgeW: 80, badgeH: 55, cutGap: 3 },
  '6-up-portrait': { cols: 3, rows: 2, badgeW: 63, badgeH: 95, cutGap: 3 },
  '9-up-portrait': { cols: 3, rows: 3, badgeW: 55, badgeH: 80, cutGap: 3 },
  '8-up-portrait': { cols: 4, rows: 2, badgeW: 63, badgeH: 90, cutGap: 3 },
};

const IS_PORTRAIT: Record<BadgeLayout, boolean> = {
  '8-up': false,
  '10-up': false,
  '6-up-portrait': true,
  '9-up-portrait': true,
  '8-up-portrait': true,
};

const ZONES = {
  headerFraction: 0.17,
  bodyFraction: 0.70,
  bandFraction: 0.13,
};

const BAND_COLORS: Record<string, readonly [number, number, number]> = {
  'Member': [0.20, 0.40, 0.80],
  'Delegate': [0.18, 0.70, 0.30],
  'VIP': [0.80, 0.55, 0.05],
  'Gold': [0.80, 0.55, 0.05],
  'Speaker': [0.60, 0.10, 0.10],
  'Volunteer': [0.20, 0.30, 0.55],
  'Staff': [0.45, 0.15, 0.45],
  'Minister': [0.12, 0.12, 0.12],
  'Exhibitor': [0.80, 0.35, 0.10],
  'Press': [0.05, 0.05, 0.05],
};
const DEFAULT_BAND: readonly [number, number, number] = [0.35, 0.35, 0.40];
const HEADER_BG = rgb(0.227, 0.000, 0.027);
const HEADER_TEXT = rgb(1, 1, 1);
const ACCENT_GOLD = rgb(0.784, 0.588, 0.047);
const BODY_BG = rgb(1, 1, 1);
const TEXT_PRIMARY = rgb(0.06, 0.09, 0.16);
const TEXT_SECONDARY = rgb(0.39, 0.45, 0.55);
const QR_DARK = rgb(0.12, 0.16, 0.22);
const CROP_COLOR = rgb(0, 0, 0);
const HEADER_STRIP_BG = rgb(0.027, 0.000, 0.000);

function encodeQRData(delegate: Delegate, event: Event): string {
  return delegate.qr_hash || delegate.delegate_id;
}

function drawCropMarks(page: PDFPage, x: number, y: number, w: number, h: number) {
  const markLen = mmToPt(5);
  const overhang = mmToPt(3);
  const lineW = 0.25;

  const corners = [
    { cx: x, cy: y, dx1: 1, dy1: 0, dx2: 0, dy2: 1 },
    { cx: x + w, cy: y, dx1: -1, dy1: 0, dx2: 0, dy2: 1 },
    { cx: x, cy: y + h, dx1: 1, dy1: 0, dx2: 0, dy2: -1 },
    { cx: x + w, cy: y + h, dx1: -1, dy1: 0, dx2: 0, dy2: -1 },
  ];

  for (const corner of corners) {
    const cx = corner.cx;
    const cy = corner.cy;

    page.drawLine({
      start: { x: cx, y: cy },
      end: { x: cx + markLen * corner.dx1, y: cy + overhang * corner.dx1 },
      color: CROP_COLOR,
      thickness: lineW,
    });
    page.drawLine({
      start: { x: cx, y: cy },
      end: { x: cx + overhang * corner.dx2, y: cy + markLen * corner.dy1 },
      color: CROP_COLOR,
      thickness: lineW,
    });

    const innerX = cx + overhang * corner.dx2;
    const innerY = cy + overhang * corner.dy1;
    const extX = cx + (markLen + overhang) * corner.dx2;
    const extY = cy + (markLen + overhang) * corner.dy1;

    if (Math.abs(corner.dx2) > 0) {
      page.drawLine({
        start: { x: innerX, y: innerY },
        end: { x: extX, y: extY },
        color: CROP_COLOR,
        thickness: lineW,
      });
    } else {
      page.drawLine({
        start: { x: innerX, y: innerY },
        end: { x: extX, y: extY },
        color: CROP_COLOR,
        thickness: lineW,
      });
    }
  }
}

function drawQRCode(
  page: PDFPage,
  data: string,
  qrX: number,
  qrY: number,
  qrSize: number
) {
  try {
    const qr = QRCode.create(data, { errorCorrectionLevel: 'M' });
    const moduleCount = qr.modules.size;
    const moduleSize = qrSize / moduleCount;

    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (qr.modules.get(row, col)) {
          const mx = qrX + col * moduleSize;
          const my = qrY + qrSize - (row + 1) * moduleSize;
          page.drawRectangle({
            x: mx,
            y: my,
            width: moduleSize,
            height: moduleSize,
            color: QR_DARK,
          });
        }
      }
    }
  } catch {
    page.drawRectangle({
      x: qrX,
      y: qrY,
      width: qrSize,
      height: qrSize,
      borderColor: QR_DARK,
      borderWidth: 1,
      color: BODY_BG,
    });
  }
}

function drawBadge(
  page: PDFPage,
  delegate: Delegate,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  headerH: number,
  bodyH: number,
  bandH: number,
  event: Event,
  fontBold: ReturnType<PDFDocument['embedFont']> extends Promise<infer T> ? T : never,
  font: ReturnType<PDFDocument['embedFont']> extends Promise<infer T> ? T : never,
  fontOblique: ReturnType<PDFDocument['embedFont']> extends Promise<infer T> ? T : never,
  fgbmfiLogo?: ReturnType<PDFDocument['embedPng']> extends Promise<infer T> ? T : never,
  eventLogo?: ReturnType<PDFDocument['embedPng']> extends Promise<infer T> ? T : never,
  badgeBanner?: ReturnType<PDFDocument['embedPng']> extends Promise<infer T> ? T : never,
  isPortrait: boolean = false,
  showRank: boolean = true,
  showOffice: boolean = true
) {
  const badgeBottom = by;
  const badgeLeft = bx;

  if (isPortrait) {
    const headerTop = badgeBottom + bh;
    const headerBottom = badgeBottom + bh - headerH;

    if (badgeBanner) {
      const bannerAspect = badgeBanner.width / badgeBanner.height;
      const bannerH = bw / bannerAspect;
      const paddingH = (headerH - bannerH) / 2;
      const bannerY = headerBottom + paddingH;

      page.drawRectangle({ x: badgeLeft, y: headerBottom, width: bw, height: headerH, color: HEADER_BG });
      try {
        page.drawImage(badgeBanner as any, { x: badgeLeft, y: bannerY, width: bw, height: bannerH });
      } catch {}
      page.drawRectangle({ x: badgeLeft, y: headerBottom, width: bw, height: mmToPt(0.5), color: ACCENT_GOLD });

      const bodyBottom = badgeBottom + bandH;
      const bodyTop = badgeBottom + bh - headerH;
      page.drawRectangle({ x: badgeLeft, y: bodyBottom, width: bw, height: bodyTop - bodyBottom, color: BODY_BG });

      const qrSize = Math.min(bw * 0.55, (bodyTop - bodyBottom) * 0.55);
      const qrX = badgeLeft + (bw - qrSize) / 2;
      const qrY = bodyTop - mmToPt(6) - qrSize;
      drawQRCode(page, encodeQRData(delegate, event), qrX, qrY, qrSize);

      const isSmall = bw < mmToPt(60) || bh < mmToPt(92);
      const isExtraSmall = bh < mmToPt(82);
      const nameSize = isExtraSmall ? 8.0 : (isSmall ? 9.0 : 12.0);
      const fieldLabelSize = isExtraSmall ? 5.5 : (isSmall ? 6.5 : 7.5);
      const fieldSize = isExtraSmall ? 6.0 : (isSmall ? 7.5 : 8.5);
      const fieldSpacing = isExtraSmall ? 1.3 : 1.5;

      const fullName = [delegate.title, delegate.first_name, delegate.last_name].filter(Boolean).join(' ').toUpperCase();
      const nameW = fontBold.widthOfTextAtSize(fullName, nameSize);
      page.drawText(fullName, { x: badgeLeft + Math.max(0, (bw - nameW) / 2), y: qrY - mmToPt(6), size: nameSize, font: fontBold as any, color: TEXT_PRIMARY, maxWidth: bw - mmToPt(2) });

      let textY = qrY - mmToPt(6) - nameSize * 1.6;
      const fields: [string, string][] = [
        ['District', delegate.district || 'N/A'],
        ['Chapter', delegate.chapter || 'N/A'],
        ['ID', delegate.external_id || delegate.delegate_id.slice(0, 8)],
      ];

      for (const [label, value] of fields) {
        if (textY < bodyBottom + mmToPt(3)) break;
        const labelText = label + ': ';
        const lW = fontBold.widthOfTextAtSize(labelText, fieldLabelSize);
        const totalW = lW + font.widthOfTextAtSize(value, fieldSize);
        const sx = badgeLeft + Math.max(mmToPt(2), (bw - totalW) / 2);
        page.drawText(labelText, { x: sx, y: textY, size: fieldLabelSize, font: fontBold as any, color: TEXT_SECONDARY });
        page.drawText(value, { x: sx + lW, y: textY, size: fieldSize, font: font as any, color: TEXT_PRIMARY });
    textY -= fieldSize * fieldSpacing;
      }

      const dt = delegate.delegate_type || 'Member';
      const bc = BAND_COLORS[dt] || DEFAULT_BAND;
      page.drawRectangle({ x: badgeLeft, y: badgeBottom, width: bw, height: bandH, color: rgb(bc[0], bc[1], bc[2]) });
      const bts = isSmall ? 7.0 : 8.0;
      const btw = fontBold.widthOfTextAtSize(dt.toUpperCase(), bts);
      page.drawText(dt.toUpperCase(), { x: badgeLeft + (bw - btw) / 2, y: badgeBottom + (bandH - bts) / 2, size: bts, font: fontBold as any, color: HEADER_TEXT });
      return;
    }

     const headerCenterY = badgeBottom + bh - headerH / 2;

    // Header background
    page.drawRectangle({ x: badgeLeft, y: badgeBottom + bh - headerH, width: bw, height: headerH, color: HEADER_BG });
    page.drawRectangle({ x: badgeLeft, y: badgeBottom + bh - headerH, width: bw, height: mmToPt(0.5), color: ACCENT_GOLD });

    if (eventLogo) {
      try {
        const logoH = headerH * 0.55;
        const logoW = logoH * (eventLogo.width / eventLogo.height);
        page.drawImage(eventLogo as any, { x: badgeLeft + bw - Math.min(logoW, bw * 0.3) - mmToPt(1.5), y: headerCenterY - logoH / 2, width: Math.min(logoW, bw * 0.3), height: logoH });
      } catch {}
    }
    if (fgbmfiLogo) {
      try {
        const logoH = headerH * 0.50;
        const logoW = logoH * (fgbmfiLogo.width / fgbmfiLogo.height);
        page.drawImage(fgbmfiLogo as any, { x: badgeLeft + mmToPt(1.5), y: headerCenterY - logoH / 2, width: Math.min(logoW, bw * 0.3), height: logoH });
      } catch {}
    }

    const evLogoW = eventLogo ? bw * 0.25 : 0;
    const fgLogoW = fgbmfiLogo ? bw * 0.22 : 0;
    const textX = badgeLeft + fgLogoW + mmToPt(2);
    const textMaxW = bw - fgLogoW - evLogoW - mmToPt(4);
    const eventName = event.name || '2026 LAGOS NATIONAL CONVENTION';
    const hFontSize = bh > mmToPt(90) ? 5.8 : 4.5;
    page.drawText(eventName.toUpperCase(), { x: textX, y: headerCenterY - hFontSize * 0.35, size: hFontSize, font: fontBold as any, color: HEADER_TEXT, maxWidth: textMaxW > 0 ? textMaxW : bw * 0.4 });

    // Body
    const bodyBottom = badgeBottom + bandH;
    const bodyTop = badgeBottom + bh - headerH;
    page.drawRectangle({ x: badgeLeft, y: bodyBottom, width: bw, height: bodyTop - bodyBottom, color: BODY_BG });

    const qrSize = Math.min(bw * 0.55, (bodyTop - bodyBottom) * 0.55);
    const qrX = badgeLeft + (bw - qrSize) / 2;
    const qrY = bodyTop - mmToPt(6) - qrSize;
    drawQRCode(page, encodeQRData(delegate, event), qrX, qrY, qrSize);

    const isSmall = bw < mmToPt(60) || bh < mmToPt(92);
    const isExtraSmall = bh < mmToPt(82);
    const nameSize = isExtraSmall ? 8.0 : (isSmall ? 9.0 : 12.0);
    const fieldLabelSize = isExtraSmall ? 5.5 : (isSmall ? 6.5 : 7.5);
    const fieldSize = isExtraSmall ? 6.0 : (isSmall ? 7.5 : 8.5);
    const fieldSpacing = isExtraSmall ? 1.3 : 1.5;

    const fullName = [delegate.title, delegate.first_name, delegate.last_name].filter(Boolean).join(' ').toUpperCase();
    const nameW = fontBold.widthOfTextAtSize(fullName, nameSize);
    page.drawText(fullName, { x: badgeLeft + Math.max(0, (bw - nameW) / 2), y: qrY - mmToPt(6), size: nameSize, font: fontBold as any, color: TEXT_PRIMARY, maxWidth: bw - mmToPt(2) });

    let textY = qrY - mmToPt(6) - nameSize * 1.6;
    const fields: [string, string][] = [
      ['District', delegate.district || 'N/A'],
      ['Chapter', delegate.chapter || 'N/A'],
      ['ID', delegate.external_id || delegate.delegate_id.slice(0, 8)],
    ];

    for (const [label, value] of fields) {
      if (textY < bodyBottom + mmToPt(3)) break;
      const labelText = label + ': ';
      const lW = fontBold.widthOfTextAtSize(labelText, fieldLabelSize);
      const totalW = lW + font.widthOfTextAtSize(value, fieldSize);
      const sx = badgeLeft + Math.max(mmToPt(2), (bw - totalW) / 2);
      page.drawText(labelText, { x: sx, y: textY, size: fieldLabelSize, font: fontBold as any, color: TEXT_SECONDARY });
      page.drawText(value, { x: sx + lW, y: textY, size: fieldSize, font: font as any, color: TEXT_PRIMARY });
      textY -= fieldSize * fieldSpacing;
    }

    // Category band
    const dt = delegate.delegate_type || 'Member';
    const bc = BAND_COLORS[dt] || DEFAULT_BAND;
    page.drawRectangle({ x: badgeLeft, y: badgeBottom, width: bw, height: bandH, color: rgb(bc[0], bc[1], bc[2]) });
    const bts = isSmall ? 7.0 : 8.0;
    const btw = fontBold.widthOfTextAtSize(dt.toUpperCase(), bts);
    page.drawText(dt.toUpperCase(), { x: badgeLeft + (bw - btw) / 2, y: badgeBottom + (bandH - bts) / 2, size: bts, font: fontBold as any, color: HEADER_TEXT });
    return;
  }

  if (badgeBanner) {
    const bannerAspect = badgeBanner.width / badgeBanner.height;
    const bannerH = bw / bannerAspect;
    const paddingH = (headerH - bannerH) / 2;

    page.drawRectangle({
      x: badgeLeft, y: badgeBottom + bh - headerH, width: bw, height: headerH, color: HEADER_BG,
    });

    try {
      page.drawImage(badgeBanner as any, { x: badgeLeft, y: badgeBottom + bh - headerH + paddingH, width: bw, height: bannerH });
    } catch {}

    page.drawRectangle({
      x: badgeLeft, y: badgeBottom + bh - headerH, width: bw, height: mmToPt(0.5), color: ACCENT_GOLD,
    });
  } else {
    page.drawRectangle({
      x: badgeLeft,
      y: badgeBottom + bh - headerH,
      width: bw,
      height: headerH,
      color: HEADER_BG,
    });

    page.drawRectangle({
      x: badgeLeft,
      y: badgeBottom + bh - headerH,
      width: bw,
      height: mmToPt(0.5),
      color: ACCENT_GOLD,
    });

    const headerCenterY = badgeBottom + bh - headerH / 2;

    if (eventLogo) {
      try {
        const logoAspect = eventLogo.width / eventLogo.height;
        const logoH = headerH * 0.66;
        let logoW = logoH * logoAspect;
        if (logoW > bw * 0.25) logoW = bw * 0.25;
        const logoX = badgeLeft + bw - logoW - mmToPt(1.5);
        const logoY = headerCenterY - logoH / 2;
        page.drawImage(eventLogo as any, {
          x: logoX,
          y: logoY,
          width: logoW,
          height: logoH,
        });
      } catch {}
    }

    const logoSize = headerH * 0.55;

    if (fgbmfiLogo) {
      try {
        const logoAspect = fgbmfiLogo.width / fgbmfiLogo.height;
        let logoW = logoSize * logoAspect;
        const logoH = logoSize;
        if (logoW > bw * 0.25) logoW = bw * 0.25;
        const logoX = badgeLeft + mmToPt(1.5);
        const logoY = headerCenterY - logoH / 2;
        page.drawImage(fgbmfiLogo as any, {
          x: logoX,
          y: logoY,
          width: logoW,
          height: logoH,
        });
      } catch {}
    }

    const eventLogoWidth = eventLogo ? bw * 0.25 : 0;
    const fgbmfiLogoWidth = fgbmfiLogo ? bw * 0.22 : 0;
    const textX = badgeLeft + fgbmfiLogoWidth + mmToPt(3);
    const textMaxW = bw - fgbmfiLogoWidth - eventLogoWidth - mmToPt(6);
    const eventName = event.name || '2026 LAGOS NATIONAL CONVENTION';
    const fontSize = bh > mmToPt(55) ? 6.0 : 5.0;
    page.drawText(eventName.toUpperCase(), {
      x: textX,
      y: headerCenterY - fontSize * 0.35,
      size: fontSize,
      font: fontBold as any,
      color: HEADER_TEXT,
      maxWidth: textMaxW > 0 ? textMaxW : bw * 0.4,
    });
  }

  // Body
  page.drawRectangle({
    x: badgeLeft,
    y: badgeBottom + bandH,
    width: bw,
    height: bodyH,
    color: BODY_BG,
  });

  const bodyTop = badgeBottom + bandH + bodyH;
  const qrSize = Math.min(bodyH * 0.83, mmToPt(30));
  const qrX = badgeLeft + mmToPt(3);
  const qrY = badgeBottom + bandH + (bodyH - qrSize) / 2;

  const qrData = encodeQRData(delegate, event);
  drawQRCode(page, qrData, qrX, qrY, qrSize);

  // Delegate details
  const detailX = qrX + qrSize + mmToPt(3);
  const detailW = bw - (detailX - badgeLeft) - mmToPt(2);
  const isSmall = bw < mmToPt(85);

  const nameSize = isSmall ? 9.0 : 12.0;
  const fieldSize = isSmall ? 7.5 : 8.5;
  const labelSize = isSmall ? 6.5 : 7.5;

  const fullName = [delegate.title, delegate.first_name, delegate.last_name]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();

  let textY = bodyTop - mmToPt(5);

  const nameWidth = fontBold.widthOfTextAtSize(fullName, nameSize);
  if (nameWidth > detailW && fullName.includes(' ')) {
    const midIdx = Math.floor(fullName.length / 2);
    let splitIdx = fullName.lastIndexOf(' ', midIdx);
    if (splitIdx < 0) splitIdx = fullName.indexOf(' ');
    const line1 = fullName.substring(0, splitIdx);
    const line2 = fullName.substring(splitIdx + 1);
    page.drawText(line1, { x: detailX, y: textY, size: nameSize, font: fontBold as any, color: TEXT_PRIMARY, maxWidth: detailW });
    textY -= nameSize * 1.05;
    page.drawText(line2, { x: detailX, y: textY, size: nameSize, font: fontBold as any, color: TEXT_PRIMARY, maxWidth: detailW });
    textY -= nameSize * 1.2;
  } else {
    page.drawText(fullName, { x: detailX, y: textY, size: nameSize, font: fontBold as any, color: TEXT_PRIMARY, maxWidth: detailW });
    textY -= nameSize * 2.2;
  }

  const fields: [string, string][] = [
    ['District', delegate.district || 'N/A'],
    ['Chapter', delegate.chapter || 'N/A'],
    ['ID', delegate.external_id || delegate.delegate_id.slice(0, 8)],
  ];

  if (showRank && delegate.rank && delegate.rank !== 'CP') {
    fields.push(['Rank', delegate.rank]);
  }
  if (showOffice && delegate.office && delegate.office !== 'OTHER') {
    fields.push(['Office', delegate.office]);
  }

  for (const [label, value] of fields) {
    if (textY < badgeBottom + bandH + mmToPt(3)) break;
    const labelWidth = font.widthOfTextAtSize(label + ': ', labelSize);
    page.drawText(label + ': ', {
      x: detailX,
      y: textY,
      size: labelSize,
      font: fontBold as any,
      color: TEXT_SECONDARY,
    });
    page.drawText(value, {
      x: detailX + labelWidth,
      y: textY,
      size: fieldSize,
      font: font as any,
      color: TEXT_PRIMARY,
      maxWidth: detailW - labelWidth,
    });
    textY -= fieldSize * 1.6;
  }

  // Category band
  const delegateType = delegate.delegate_type || 'Member';
  const bandColor = BAND_COLORS[delegateType] || DEFAULT_BAND;

  page.drawRectangle({
    x: badgeLeft,
    y: badgeBottom,
    width: bw,
    height: bandH,
    color: rgb(bandColor[0], bandColor[1], bandColor[2]),
  });

  const bandTextSize = isSmall ? 7.0 : 8.0;
  const bandText = delegateType.toUpperCase();
  const bandTextW = fontBold.widthOfTextAtSize(bandText, bandTextSize);
  page.drawText(bandText, {
    x: badgeLeft + (bw - bandTextW) / 2,
    y: badgeBottom + (bandH - bandTextSize) / 2,
    size: bandTextSize,
    font: fontBold as any,
    color: HEADER_TEXT,
  });
}

export async function generateBadgePDF(
  delegates: Delegate[],
  layout: BadgeLayout,
  event: Event,
  fgbmfiLogoBytes?: Uint8Array,
  eventLogoBytes?: Uint8Array,
  badgeBannerBytes?: Uint8Array,
  onProgress?: (progress: BadgeGenerationProgress) => void
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  let fgbmfiLogo;
  if (fgbmfiLogoBytes) {
    try {
      fgbmfiLogo = await pdfDoc.embedPng(fgbmfiLogoBytes);
    } catch {}
  }

  let eventLogo;
  if (eventLogoBytes) {
    try {
      eventLogo = await pdfDoc.embedPng(eventLogoBytes);
    } catch {}
  }

  let badgeBanner;
  if (badgeBannerBytes) {
    try {
      badgeBanner = await pdfDoc.embedPng(badgeBannerBytes);
    } catch {}
  }

  const config = LAYOUTS[layout];
  const badgeW = mmToPt(config.badgeW);
  const badgeH = mmToPt(config.badgeH);
  const cutGapW = mmToPt(config.cutGap);
  const cutGapH = mmToPt(config.cutGap);

  const eventConfig = (event?.event_config || {}) as Record<string, boolean>;
  const showRank = eventConfig.show_rank !== false;
  const showOffice = eventConfig.show_office !== false;

  const headerH = badgeH * ZONES.headerFraction;
  const bodyH = badgeH * ZONES.bodyFraction;
  const bandH = badgeH * ZONES.bandFraction;

  const totalW = config.cols * badgeW + (config.cols - 1) * cutGapW;
  const totalH = config.rows * badgeH + (config.rows - 1) * cutGapH;

  const useLandscape = totalW > A4.w;
  const pageW = useLandscape ? A4.h : A4.w;
  const pageH = useLandscape ? A4.w : A4.h;
  const marginX = (pageW - totalW) / 2;
  const marginY = (pageH - totalH) / 2;

  const totalPages = Math.ceil(delegates.length / (config.cols * config.rows));
  const badgesPerPage = config.cols * config.rows;

  onProgress?.({ current: 0, total: totalPages, phase: 'composing_pages' });

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const page = pdfDoc.addPage([pageW, pageH]);
    const pageDelegates = delegates.slice(
      pageIdx * badgesPerPage,
      (pageIdx + 1) * badgesPerPage
    );

    for (let i = 0; i < pageDelegates.length; i++) {
      const row = Math.floor(i / config.cols);
      const col = i % config.cols;
      const bx = marginX + col * (badgeW + cutGapW);
      const by = marginY + (config.rows - 1 - row) * (badgeH + cutGapH);

      drawBadge(
        page as any,
        pageDelegates[i],
        bx,
        by,
        badgeW,
        badgeH,
        headerH,
        bodyH,
        bandH,
        event,
        fontBold as any,
        font as any,
        fontOblique as any,
        fgbmfiLogo as any,
        eventLogo as any,
        badgeBanner as any,
        IS_PORTRAIT[layout],
        showRank,
        showOffice
      );
      drawCropMarks(page, bx, by, badgeW, badgeH);
    }

    onProgress?.({ current: pageIdx + 1, total: totalPages, phase: 'composing_pages' });

    if (pageIdx % 5 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress?.({ current: totalPages, total: totalPages, phase: 'saving' });
  pdfDoc.setTitle('FGBMFI Delegate Badges');
  pdfDoc.setSubject('Event Delegate Badge Batch');
  pdfDoc.setCreator('FGBMFI Nigeria EMS');
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

export function getBadgePageCount(
  delegateCount: number,
  layout: BadgeLayout
): number {
  const config = LAYOUTS[layout];
  return Math.ceil(delegateCount / (config.cols * config.rows));
}

export { LAYOUTS, encodeQRData };
