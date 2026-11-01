import { t, languageDisplayName } from './i18n.js';
import { state } from './state.js';
import { formatDate, confidenceMeta, categoryMeta } from './ui.js';

function bulletList(items) {
  return (items || []).map((item) => `• ${item}`);
}

function slugify(value) {
  return String(value || 'scan')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'scan';
}

export function exportScanPdf(record) {
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) throw new Error('PDF library is not available.');

  const result = record.result;
  if (!result) throw new Error('This scan has no result to export.');

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 46;
  const contentWidth = pageWidth - margin * 2;
  const brand = state.config?.branding?.title || 'SmartLens AI';
  let y = 0;

  const addPageChrome = () => {
    doc.setFillColor(15, 157, 118);
    doc.rect(0, 0, pageWidth, 86, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(brand, margin, 40);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(t('footer.disclaimer').slice(0, 130), margin, 60, { maxWidth: contentWidth });
    y = 112;
    doc.setTextColor(30, 41, 37);
  };

  const ensureSpace = (height) => {
    if (y + height > pageHeight - 60) {
      doc.addPage();
      addPageChrome();
    }
  };

  const writeHeading = (text) => {
    ensureSpace(34);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 118, 110);
    doc.text(text, margin, y);
    y += 17;
    doc.setTextColor(30, 41, 37);
    doc.setFont('helvetica', 'normal');
  };

  const writeParagraph = (text, { size = 10, lineHeight = 14 } = {}) => {
    if (!text) return;
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(String(text), contentWidth);
    for (const line of lines) {
      ensureSpace(lineHeight);
      doc.text(line, margin, y);
      y += lineHeight;
    }
    y += 4;
  };

  const writeList = (items) => {
    const list = bulletList(items);
    if (!list.length) return;
    doc.setFontSize(10);
    for (const item of list) {
      const lines = doc.splitTextToSize(item, contentWidth - 12);
      ensureSpace(lines.length * 13 + 2);
      lines.forEach((line, index) => {
        doc.text(line, margin + (index === 0 ? 0 : 12), y);
        y += 13;
      });
      y += 1;
    }
    y += 4;
  };

  addPageChrome();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text(result.mainIdentification || t('common.unknown'), margin, y + 6);
  y += 26;

  if (result.scientificName) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(11);
    doc.text(result.scientificName, margin, y);
    y += 18;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const meta = [
    categoryMeta(record.category).name || result.categorySlug || '',
    `${t('result.confidence')}: ${confidenceMeta(result.confidence).label}`,
    formatDate(record.createdAt),
    languageDisplayName(result.locale || record.language),
  ]
    .filter(Boolean)
    .join('  ·  ');
  doc.setTextColor(93, 112, 105);
  doc.text(meta, margin, y);
  y += 22;
  doc.setTextColor(30, 41, 37);

  if (result.uncertaintyNotes) {
    ensureSpace(30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(153, 116, 4);
    doc.text(t('result.uncertaintyTitle'), margin, y);
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 37);
    writeParagraph(result.uncertaintyNotes, { size: 9.5, lineHeight: 13 });
  }

  writeHeading(t('result.description'));
  writeParagraph(result.description);

  if (record.recommendations?.length) {
    writeHeading(t('result.recommendations'));
    for (const recommendation of record.recommendations) {
      ensureSpace(30);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(`• ${recommendation.title}`, margin, y, { maxWidth: contentWidth });
      y += 13;
      doc.setFont('helvetica', 'normal');
      writeParagraph(recommendation.body, { size: 9.5, lineHeight: 13 });
    }
  }

  if (result.characteristics?.length) {
    writeHeading(t('result.characteristics'));
    writeList(result.characteristics);
  }

  if (result.commonUses?.length) {
    writeHeading(t('result.uses'));
    writeList(result.commonUses);
  }

  if (result.interestingFacts?.length) {
    writeHeading(t('result.facts'));
    writeList(result.interestingFacts);
  }

  if (result.safety?.length) {
    writeHeading(t('result.safety'));
    writeList(result.safety);
  }

  if (result.observations?.length) {
    writeHeading(t('result.observations'));
    writeList(result.observations);
  }

  if (result.assumptions?.length) {
    writeHeading(t('result.assumptions'));
    writeList(result.assumptions);
  }

  if (result.alternatives?.length) {
    writeHeading(t('result.alternatives'));
    writeList(
      result.alternatives.map(
        (alt) => `${alt.name} (${t('result.likelihood')}: ${alt.likelihood})${alt.note ? ` — ${alt.note}` : ''}`,
      ),
    );
  }

  if (record.notes) {
    writeHeading(t('result.notes'));
    writeParagraph(record.notes);
  }

  writeHeading(t('settings.privacyTitle'));
  writeParagraph(
    state.language === 'en' ? state.config?.privacy?.disclosure || t('settings.privacy') : t('settings.privacy'),
    { size: 8.5, lineHeight: 12 },
  );

  const pages = doc.internal.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(140, 155, 148);
    doc.text(
      `${brand} · ${record.createdAt ? formatDate(record.createdAt) : ''} · ${page}/${pages}`,
      margin,
      pageHeight - 26,
    );
  }

  doc.save(`smartlens-${slugify(result.mainIdentification)}.pdf`);
}
