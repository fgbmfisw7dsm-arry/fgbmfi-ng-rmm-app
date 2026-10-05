// Tunable content zones (fractions of badge width/height, measured from the top)
// for the v2 full-bleed design (Tag 1.png, aspect 0.716) used by 6-up-portrait,
// 4-up-portrait and the Check-In E-Badge. Calibrated against Tag TEMPLATE.png.
//
// Extracted from badgePdfGenerator.ts so that consumers that only need the
// geometry (e.g. badgeImageGenerator / the Check-In E-Badge canvas) do not pull
// `pdf-lib` into their module graph.
export const V2_ZONES = {
  typeY0: 0.030,   // delegate type text zone (design's slanted navy rect), top->bottom
  typeY1: 0.150,
  typeX0: 0.58,
  typeX1: 0.955,
  nameTop: 0.462,  // delegate name fit region (measured against badge-design-v2.png: baked Theme ink spans 0.454-0.469)
  nameBottom: 0.577,
  nameClearTop: 0.480, // placement cap: name glyph tops must stay below the Theme ink bottom (~0.469)
  detailsTop: 0.587, // detail fields + QR band
  rowBottom: 0.895,
  detailsX: 0.055,   // left column: detail lines
  qrX0: 0.585,
  qrX1: 0.945,
  qrCX: 0.765,       // QR horizontal center
  // v1.65-fix2: slanted navy box (bottom-left, flush with the card corner).
  // Measured on the 100×140mm print: LEFT edge vertical = 14mm, TOP edge =
  // 34mm, BOTTOM edge = 40mm → a trapezoid whose right edge slants inward 6mm
  // over 14mm. Fractions (x/100 from left, y from top = 1−y_mm/140):
  //   BL (0,0)→(0.000,1.000)  BR (40,0)→(0.400,1.000)
  //   TR (34,14)→(0.340,0.900)  TL (0,14)→(0.000,0.900)
  // Centroid ≈ (18.5mm, 6.8mm from bottom) → (0.185, 0.951). tunable via insets.
  stampBL: [0.000, 1.000],
  stampBR: [0.400, 1.000],
  stampTR: [0.340, 0.900],
  stampTL: [0.000, 0.900],
  stampCX: 0.185,
  stampCY: 0.951,   // centroid y as a from-top fraction
  stampMaxW: 0.33,  // text width fraction at the centroid height (~33mm on 100mm)
};

// v1.65-fix4: design-matched fee stamp (REGULAR) — approximate the baked
// 'EARLY BIRD' in badge-design-v2.png (heavy bold, left-aligned in the navy
// trapezoid, cap height ≈ 2.9mm on a 100×140mm card). The design's exact font
// is rasterized and unavailable, so we approximate via size + left alignment +
// bold weight, scaled to the card width on both the PDF and canvas paths.
// NOTE: Early Bird is NOT drawn by the app (it is baked into the design); these
// constants only affect the app-drawn REGULAR stamp.
export const STAMP_TEXT_X = 0.018;     // left inset of the text within the trapezoid (fraction of bw)
// v1.65-fix5: STAMP_CAP_PT is a FONT POINT (em) size, NOT a cap height. To match
// the baked 'EARLY BIRD' cap height (~2.9mm) on the 100mm reference card, the
// point size must be ~2.9mm / 0.72 (Helvetica cap ratio) ≈ 11.4pt — the previous
// 8.2pt only produced a ~2.08mm cap and read far smaller than Early Bird.
export const STAMP_CAP_PT = 11.4;      // font point (em) size at the 100mm reference card
export const STAMP_MIN_PT = 5;         // auto-shrink floor (pt at reference / px*k on canvas)
export const STAMP_MAX_W_FRAC = 0.37;  // usable text width allowance (fraction of bw)
export const STAMP_REF_WIDTH_MM = 100; // reference card width the cap height was measured against
// v1.65-fix6: the design's baked 'EARLY BIRD' is a heavy/black weight; Helvetica-Bold
// (PDF) and 'bold sans-serif' (canvas) are lighter, so REGULAR is thickened with a
// faux-bold pass (PDF: repeat-draw at sub-point offsets; canvas: strokeText) to match.
export const STAMP_FAUX_BOLD_MM = 0.18; // extra weight thickness in mm at the reference card
