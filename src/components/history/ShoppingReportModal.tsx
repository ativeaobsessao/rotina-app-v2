import React, { useEffect, useState } from 'react';
import { AlertCircle, CalendarDays, CheckCircle2, FileDown, X } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getPurchasedShoppingItems } from '../../services/api';
import { formatFriendlyDate, getLocalDateString, shiftDateString } from '../../utils/date';
import {
  formatPriceBRL,
  getMonthStartDate,
  getPreviousMonthRange,
  summarizeShoppingExpenses,
  type ShoppingItemRecord,
} from '../../utils/shopping';
import { cn } from '../../utils/cn';

interface ShoppingReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  familyId: string;
  patientName: string;
  initialStartDate?: string;
  initialEndDate?: string;
  initialUrgentOnly?: boolean;
}

export function ShoppingReportModal({
  isOpen,
  onClose,
  patientId,
  familyId,
  patientName,
  initialStartDate,
  initialEndDate,
  initialUrgentOnly = false,
}: ShoppingReportModalProps) {
  const todayStr = getLocalDateString();
  const [startDate, setStartDate] = useState(initialStartDate || getMonthStartDate(todayStr));
  const [endDate, setEndDate] = useState(initialEndDate || todayStr);
  const [urgentOnly, setUrgentOnly] = useState(initialUrgentOnly);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const nowToday = getLocalDateString();
    setStartDate(initialStartDate || getMonthStartDate(nowToday));
    setEndDate(initialEndDate || nowToday);
    setUrgentOnly(initialUrgentOnly);
    setError('');
    setSuccess(false);
  }, [isOpen, initialStartDate, initialEndDate, initialUrgentOnly]);

  if (!isOpen) return null;

  const applyPreset = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
    setError('');
  };

  async function handleGenerate() {
    setError('');
    setIsGenerating(true);
    setSuccess(false);

    try {
      if (!startDate || !endDate) {
        throw new Error('Selecione as datas inicial e final do período.');
      }
      if (startDate > endDate) {
        throw new Error('A data inicial não pode ser posterior à data final.');
      }

      const rawItems = await getPurchasedShoppingItems(patientId, {
        familyId,
        startDate,
        endDate,
      });

      const items: ShoppingItemRecord[] = urgentOnly
        ? rawItems.filter((item) => item.is_urgent)
        : rawItems;

      if (items.length === 0) {
        throw new Error('Nenhuma compra encontrada para o período selecionado.');
      }

      const summary = summarizeShoppingExpenses(items, items, endDate);

      const JsPdfCtor = (jsPDF as any)?.jsPDF || (jsPDF as any)?.default || jsPDF;
      const runAutoTable = (autoTable as any)?.default || autoTable;

      const doc = new JsPdfCtor({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 12;

      doc.setFillColor(5, 150, 105); // Emerald 600
      doc.rect(margin, 10, pageWidth - margin * 2, 1.5, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14.5);
      doc.setTextColor(30, 41, 59);
      doc.text('DUCA — Relatório de Compras e Controle de Gastos', margin, 17);

      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(margin, 20, pageWidth - margin * 2, 16, 2, 2, 'FD');

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('Familiar:', margin + 3, 25);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(patientName, margin + 20, 25);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('Período:', margin + 3, 31);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(`${formatFriendlyDate(startDate)} até ${formatFriendlyDate(endDate)}`, margin + 20, 31);

      const rightColX = pageWidth - margin - 58;
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('Emissão:', rightColX, 25);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(
        new Date().toLocaleDateString('pt-BR') +
          ' ' +
          new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        rightColX + 16,
        25
      );

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('Filtro:', rightColX, 31);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(urgentOnly ? 'Somente urgentes' : 'Todas as compras', rightColX + 16, 31);

      const boxGap = 3;
      const contentW = pageWidth - margin * 2;
      const boxW = (contentW - boxGap * 2) / 3;
      const boxY = 38.5;
      const boxH = 13;

      // Box 1: Total gasto
      doc.setFillColor(236, 253, 245);
      doc.setDrawColor(167, 243, 208);
      doc.roundedRect(margin, boxY, boxW, boxH, 1.5, 1.5, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(4, 120, 87);
      doc.text('TOTAL GASTO NO PERÍODO', margin + 2.5, boxY + 4.5);
      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      doc.text(formatPriceBRL(summary.totalCents), margin + 2.5, boxY + 10);

      // Box 2: Quantidade de itens
      const box2X = margin + boxW + boxGap;
      doc.setFillColor(238, 242, 255);
      doc.setDrawColor(199, 210, 254);
      doc.roundedRect(box2X, boxY, boxW, boxH, 1.5, 1.5, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(67, 56, 202);
      doc.text('ITENS COMPRADOS', box2X + 2.5, boxY + 4.5);
      doc.setFontSize(8.2);
      doc.setTextColor(15, 23, 42);
      doc.text(
        `${summary.itemCount} itens (${summary.pricedCount} c/ valor)`,
        box2X + 2.5,
        boxY + 10
      );

      // Box 3: Urgência
      const box3X = box2X + boxW + boxGap;
      doc.setFillColor(255, 241, 242);
      doc.setDrawColor(254, 205, 211);
      doc.roundedRect(box3X, boxY, boxW, boxH, 1.5, 1.5, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(190, 18, 60);
      doc.text('ITENS URGENTES', box3X + 2.5, boxY + 4.5);
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(`${summary.urgentCount} compra(s) urgente(s)`, box3X + 2.5, boxY + 10);

      let currentY = boxY + boxH + 7;

      if (summary.monthlyBreakdown.length > 1) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(4, 120, 87);
        doc.text('Resumo Mensal do Período', margin, currentY);
        currentY += 2;

        runAutoTable(doc, {
          startY: currentY,
          margin: { left: margin, right: margin, bottom: 15 },
          head: [['Mês', 'Qtd. de Itens', 'Itens com Valor', 'Subtotal Gasto']],
          body: summary.monthlyBreakdown.map((m) => [
            m.label,
            String(m.itemCount),
            String(m.pricedCount),
            formatPriceBRL(m.totalCents),
          ]),
          theme: 'grid',
          headStyles: {
            fillColor: [5, 150, 105],
            textColor: [255, 255, 255],
            fontSize: 8,
            fontStyle: 'bold',
            cellPadding: 1.6,
          },
          bodyStyles: {
            fontSize: 7.5,
            textColor: [30, 41, 59],
            cellPadding: 1.5,
          },
        });

        currentY = (doc as any).lastAutoTable.finalY + 7;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(30, 41, 59);
      doc.text('Detalhamento das Compras Realizadas', margin, currentY);
      currentY += 2;

      const bodyRows = items.map((item) => {
        const dateFormatted = item.purchased_date
          ? item.purchased_date.split('-').reverse().join('/')
          : '-';
        const itemDesc = item.notes ? `${item.name} (${item.notes})` : item.name;
        const qty = item.quantity || '-';
        const priority = item.is_urgent ? 'Urgente' : 'Normal';
        const requester = item.requester?.name || 'Familiar';
        const purchaser = item.purchaser?.name || 'Familiar';
        const value = formatPriceBRL(item.price_cents);

        return [dateFormatted, itemDesc, qty, priority, requester, purchaser, value];
      });

      runAutoTable(doc, {
        startY: currentY,
        margin: { left: margin, right: margin, bottom: 15 },
        head: [['Data', 'Item / Obs.', 'Qtd.', 'Prioridade', 'Pedido por', 'Comprado por', 'Valor']],
        body: bodyRows,
        theme: 'grid',
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontSize: 7.8,
          fontStyle: 'bold',
          cellPadding: 1.6,
        },
        bodyStyles: {
          fontSize: 7.3,
          textColor: [30, 41, 59],
          cellPadding: 1.5,
          lineColor: [226, 232, 240],
          lineWidth: 0.1,
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        columnStyles: {
          0: { cellWidth: 18, halign: 'center' },
          1: { cellWidth: 'auto', fontStyle: 'bold' },
          2: { cellWidth: 20 },
          3: { cellWidth: 18, halign: 'center' },
          4: { cellWidth: 22 },
          5: { cellWidth: 24 },
          6: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 3) {
            if (data.cell.raw === 'Urgente') {
              data.cell.styles.textColor = [190, 18, 60];
              data.cell.styles.fontStyle = 'bold';
            }
          }
        },
      });

      const totalPages = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.3);
        doc.line(margin, pageHeight - 9, pageWidth - margin, pageHeight - 9);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        doc.text(
          `Controle de Compras e Abastecimento • Página ${i} de ${totalPages}`,
          margin,
          pageHeight - 5
        );

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(99, 102, 241);
        doc.text('@ducaapp', pageWidth - margin, pageHeight - 5, { align: 'right' });
      }

      const cleanPatient = patientName.replace(/\s+/g, '_');
      doc.save(`Relatorio_Compras_DUCA_${cleanPatient}_${startDate}_a_${endDate}.pdf`);

      setSuccess(true);
      setTimeout(() => {
        onClose();
        setSuccess(false);
      }, 1500);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível gerar o PDF de compras.');
    } finally {
      setIsGenerating(false);
    }
  }

  const prevMonth = getPreviousMonthRange(todayStr);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-black/75 backdrop-blur-sm">
      <div className="bg-white dark:bg-[#121216] dark:border dark:border-white/[0.08] w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center px-6 pt-6 pb-4 border-b border-gray-100 dark:border-white/[0.08]">
          <div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-zinc-100 tracking-tight">
              PDF de Compras
            </h3>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
              Controle mensal ou semestral de gastos
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-gray-100 dark:bg-[#1c1c22] text-gray-400 dark:text-zinc-400 hover:text-gray-600 dark:hover:text-zinc-200 transition-colors"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => applyPreset(getMonthStartDate(todayStr), todayStr)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-[#1c1c22] text-gray-700 dark:text-zinc-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
            >
              Este mês
            </button>
            <button
              type="button"
              onClick={() => applyPreset(prevMonth.startDate, prevMonth.endDate)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-[#1c1c22] text-gray-700 dark:text-zinc-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
            >
              Mês passado
            </button>
            <button
              type="button"
              onClick={() => applyPreset(shiftDateString(todayStr, -90), todayStr)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-[#1c1c22] text-gray-700 dark:text-zinc-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
            >
              Últimos 3 meses
            </button>
            <button
              type="button"
              onClick={() => applyPreset(shiftDateString(todayStr, -180), todayStr)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-[#1c1c22] text-gray-700 dark:text-zinc-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
            >
              Últimos 6 meses
            </button>
          </div>

          <div className="bg-gray-50/80 dark:bg-[#1c1c22] p-4 rounded-2xl border border-gray-100 dark:border-white/[0.08]">
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500 mb-1.5 flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Data Inicial
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-transparent text-gray-900 dark:text-zinc-100 text-base font-semibold outline-none cursor-pointer"
            />
          </div>

          <div className="bg-gray-50/80 dark:bg-[#1c1c22] p-4 rounded-2xl border border-gray-100 dark:border-white/[0.08]">
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500 mb-1.5 flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Data Final
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-transparent text-gray-900 dark:text-zinc-100 text-base font-semibold outline-none cursor-pointer"
            />
          </div>

          <label className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-[#1c1c22] border border-gray-100 dark:border-white/[0.08] cursor-pointer">
            <span className="text-xs font-semibold text-gray-700 dark:text-zinc-200">
              Incluir somente compras urgentes
            </span>
            <input
              type="checkbox"
              checked={urgentOnly}
              onChange={(e) => setUrgentOnly(e.target.checked)}
              className="w-4 h-4 accent-emerald-600"
            />
          </label>

          {error && (
            <div className="flex items-start space-x-2 text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 p-3.5 rounded-2xl border border-rose-100 dark:border-rose-800/50">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="text-xs font-medium leading-tight">{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-start space-x-2 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 p-3.5 rounded-2xl border border-emerald-100 dark:border-emerald-800/50">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="text-xs font-semibold leading-tight">
                PDF gerado! O download iniciará em instantes...
              </span>
            </div>
          )}

          <div className="pt-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || success}
              className={cn(
                'w-full flex items-center justify-center space-x-2 py-4 px-6 rounded-2xl text-sm font-bold tracking-wide transition-all active:scale-[0.98]',
                isGenerating || success
                  ? 'bg-gray-200 dark:bg-white/[0.08] text-gray-400 dark:text-zinc-500 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20'
              )}
            >
              {isGenerating ? (
                <span className="animate-pulse">Gerando PDF...</span>
              ) : success ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Download concluído!</span>
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4" />
                  <span>Baixar PDF de Compras</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
