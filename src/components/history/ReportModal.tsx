import React, { useState } from 'react';
import { X, CalendarDays, FileDown, CheckCircle2, AlertCircle } from 'lucide-react';
import { getHistoricalMealLogs, getHistoricalMedicationLogs, getHistoricalMoodLogs } from '../../services/api';
import { getLocalDateString, formatFriendlyDate } from '../../utils/date';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { cn } from '../../utils/cn';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  patientName: string;
}

export function ReportModal({ isOpen, onClose, patientId, patientName }: ReportModalProps) {
  const [startDate, setStartDate] = useState(getLocalDateString());
  const [endDate, setEndDate] = useState(getLocalDateString());
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  async function handleGenerate() {
    setError('');
    setIsGenerating(true);
    setSuccess(false);

    try {
      if (startDate > endDate) {
        throw new Error('A data inicial não pode ser posterior à data final.');
      }

      // Add 1 day to endDate to make it fully inclusive
      const endD = new Date(endDate + 'T00:00:00');
      endD.setDate(endD.getDate() + 1);
      const beforeDate = endD.toISOString().split('T')[0];

      // Fetch data
      const [mealLogs, medLogs, moodLogs] = await Promise.all([
        getHistoricalMealLogs(patientId, beforeDate, startDate),
        getHistoricalMedicationLogs(patientId, beforeDate, startDate),
        getHistoricalMoodLogs(patientId, beforeDate, startDate),
      ]);

      if (mealLogs.length === 0 && medLogs.length === 0 && moodLogs.length === 0) {
        throw new Error('Nenhum registro encontrado para o período selecionado.');
      }

      // Initialize Portrait PDF with compact professional margins
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 12;

      // ─── Header Principal Compacto e Elegante ────────────────────────
      // Faixa de identificação superior
      doc.setFillColor(79, 70, 229); // Indigo 600
      doc.rect(margin, 10, pageWidth - margin * 2, 1.5, 'F');

      // Título e Logo
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(30, 41, 59); // Slate 800
      doc.text('DUCA — Relatório de Acompanhamento Clínico e Rotina', margin, 17);

      // Metadados em box compacto de fundo sutil
      doc.setFillColor(248, 250, 252); // Slate 50
      doc.setDrawColor(226, 232, 240); // Slate 200
      doc.roundedRect(margin, 20, pageWidth - margin * 2, 16, 2, 2, 'FD');

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('Paciente:', margin + 3, 25);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(patientName, margin + 20, 25);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('Período:', margin + 3, 31);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(`${formatFriendlyDate(startDate)} até ${formatFriendlyDate(endDate)}`, margin + 20, 31);

      // Lado direito do box de cabeçalho: Emissão e Totais rápidos
      const rightColX = pageWidth - margin - 58;
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('Emissão:', rightColX, 25);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), rightColX + 16, 25);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('Registros:', rightColX, 31);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      const summaryParts = [
        medLogs.length > 0 ? `${medLogs.length} Meds` : null,
        mealLogs.length > 0 ? `${mealLogs.length} Refeições` : null,
        moodLogs.length > 0 ? `${moodLogs.length} Bem-Estar` : null,
      ].filter(Boolean).join(' • ');
      doc.text(summaryParts || 'Sem registros', rightColX + 16, 31);

      let currentY = 40;

      // ─── Tabela 1: Medicamentos (Prioridade Clínica) ─────────────────
      if (medLogs.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(190, 18, 60); // Rose 700
        doc.text('1. Administração de Medicamentos', margin, currentY);
        currentY += 2;

        const medTableData = medLogs.map(log => {
          const dateFormatted = log.event_date ? log.event_date.split('-').reverse().join('/') : '-';
          const timeFormatted = log.medication?.period?.scheduled_time?.substring(0, 5) || '--:--';
          const medName = log.medication?.name || 'Medicamento';
          const dosage = log.medication?.dosage || '-';
          const period = log.medication?.period?.name || '-';
          const status = log.status === 'administered' ? 'Administrado' : 'NÃO Administrado';
          const observations = log.reason ? `Motivo: ${log.reason}` : (log.notes || '-');
          const caregiver = log.creator?.name || 'Familiar';

          return [dateFormatted, timeFormatted, medName, dosage, period, status, caregiver, observations];
        });

        autoTable(doc, {
          startY: currentY,
          margin: { left: margin, right: margin, bottom: 15 },
          head: [['Data', 'Hora', 'Medicamento', 'Dosagem', 'Período', 'Status', 'Cuidador', 'Observações / Motivo']],
          body: medTableData,
          theme: 'grid',
          headStyles: {
            fillColor: [225, 29, 72], // Rose 600
            textColor: [255, 255, 255],
            fontSize: 8,
            fontStyle: 'bold',
            halign: 'left',
            cellPadding: 1.8,
          },
          bodyStyles: {
            fontSize: 7.5,
            textColor: [30, 41, 59],
            cellPadding: 1.6,
            lineColor: [226, 232, 240],
            lineWidth: 0.1,
          },
          alternateRowStyles: {
            fillColor: [255, 241, 242], // Rose 50 suave
          },
          columnStyles: {
            0: { cellWidth: 16, halign: 'center' }, // Data
            1: { cellWidth: 12, halign: 'center' }, // Hora
            2: { cellWidth: 32, fontStyle: 'bold' }, // Medicamento
            3: { cellWidth: 20 },                  // Dose
            4: { cellWidth: 22 },                  // Período
            5: { cellWidth: 24, fontStyle: 'bold' }, // Status
            6: { cellWidth: 20 },                  // Cuidador
            7: { cellWidth: 'auto' },              // Observações
          },
          didParseCell: (data) => {
            // Destaque visual clínico no status de medicação
            if (data.section === 'body' && data.column.index === 5) {
              if (data.cell.raw === 'Administrado') {
                data.cell.styles.textColor = [22, 101, 52]; // Green 800
              } else {
                data.cell.styles.textColor = [185, 28, 28]; // Red 700
                data.cell.styles.fontStyle = 'bold';
              }
            }
          },
        });

        currentY = (doc as any).lastAutoTable.finalY + 8;
      }

      // ─── Tabela 2: Refeições e Nutrição ─────────────────────────────
      if (mealLogs.length > 0) {
        // Se o espaço restante for menor que 30mm, cria página nova de forma inteligente
        if (currentY > pageHeight - 35) {
          doc.addPage();
          currentY = 16;
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(67, 56, 202); // Indigo 700
        doc.text('2. Registro Nutricional e Alimentação', margin, currentY);
        currentY += 2;

        const mealTableData = mealLogs.map(log => {
          const dateFormatted = log.event_date ? log.event_date.split('-').reverse().join('/') : '-';
          const timeFormatted = log.meal_time?.substring(0, 5) || '--:--';
          const mealName = log.meal_config?.name || 'Refeição';
          
          let consumption = 'Normal';
          if (log.consumption_status === 'partial') consumption = 'Parcial';
          else if (log.consumption_status === 'none') consumption = 'Não Comeu';

          const caregiver = log.creator?.name || 'Familiar';
          const desc = log.description ? `Desc: ${log.description}` : '';
          const notes = log.notes ? `Obs: ${log.notes}` : '';
          const combinedNotes = [desc, notes].filter(Boolean).join(' | ') || '-';

          return [dateFormatted, timeFormatted, mealName, consumption, caregiver, combinedNotes];
        });

        autoTable(doc, {
          startY: currentY,
          margin: { left: margin, right: margin, bottom: 15 },
          head: [['Data', 'Hora', 'Refeição', 'Consumo', 'Cuidador', 'Descrição / Observações Nutricionais']],
          body: mealTableData,
          theme: 'grid',
          headStyles: {
            fillColor: [79, 70, 229], // Indigo 600
            textColor: [255, 255, 255],
            fontSize: 8,
            fontStyle: 'bold',
            halign: 'left',
            cellPadding: 1.8,
          },
          bodyStyles: {
            fontSize: 7.5,
            textColor: [30, 41, 59],
            cellPadding: 1.6,
            lineColor: [226, 232, 240],
            lineWidth: 0.1,
          },
          alternateRowStyles: {
            fillColor: [248, 250, 252], // Slate 50 suave
          },
          columnStyles: {
            0: { cellWidth: 16, halign: 'center' }, // Data
            1: { cellWidth: 12, halign: 'center' }, // Hora
            2: { cellWidth: 32, fontStyle: 'bold' }, // Refeição
            3: { cellWidth: 22, fontStyle: 'bold' }, // Consumo
            4: { cellWidth: 26 },                  // Cuidador
            5: { cellWidth: 'auto' },              // Observações
          },
          didParseCell: (data) => {
            if (data.section === 'body' && data.column.index === 3) {
              if (data.cell.raw === 'Normal') {
                data.cell.styles.textColor = [22, 101, 52];
              } else if (data.cell.raw === 'Parcial') {
                data.cell.styles.textColor = [161, 98, 7]; // Yellow 700
              } else {
                data.cell.styles.textColor = [185, 28, 28]; // Red 700
              }
            }
          },
        });

        currentY = (doc as any).lastAutoTable.finalY + 8;
      }

      // ─── Tabela 3: Estado de Espírito, Humor e Dores ─────────────────
      if (moodLogs.length > 0) {
        if (currentY > pageHeight - 35) {
          doc.addPage();
          currentY = 16;
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(15, 118, 110); // Teal 700
        doc.text('3. Avaliação Diária de Bem-Estar, Humor e Queixas de Dor', margin, currentY);
        currentY += 2;

        const moodMap: Record<string, string> = {
          happy: 'Feliz / Animada',
          calm: 'Calma / Tranquila',
          tired: 'Cansada / Lenta',
          sad: 'Triste / Sensível',
          agitated: 'Inquieta / Agitada',
        };

        const painMap: Record<string, string> = {
          none: 'Sem dores',
          mild: 'Dor leve',
          moderate: 'Dor moderada',
          severe: 'Dor forte',
        };

        const partsMap: Record<string, string> = {
          head: 'Cabeça',
          belly: 'Barriga/Estômago',
          back: 'Costas/Coluna',
          legs: 'Pernas/Joelhos',
          chest: 'Peito/Tórax',
          arms: 'Braços/Ombros',
          feet: 'Pés',
          joints: 'Articulações',
        };

        const moodTableData = moodLogs.map(log => {
          const dateFormatted = log.date ? log.date.split('-').reverse().join('/') : '-';
          const moodStr = moodMap[log.mood] || log.mood;
          const painStr = painMap[log.pain_level] || log.pain_level;
          const locations = (log.pain_locations || []).map(p => partsMap[p] || p).join(', ') || (log.pain_level === 'none' ? 'Nenhuma' : '-');
          const caregiver = (log as any).updater?.name || 'Familiar';
          const notesStr = log.notes || '-';

          return [dateFormatted, moodStr, painStr, locations, caregiver, notesStr];
        });

        autoTable(doc, {
          startY: currentY,
          margin: { left: margin, right: margin, bottom: 15 },
          head: [['Data', 'Humor / Disposição', 'Nível de Dor', 'Regiões da Dor', 'Registrado por', 'Observações / Contexto']],
          body: moodTableData,
          theme: 'grid',
          headStyles: {
            fillColor: [13, 148, 136], // Teal 600
            textColor: [255, 255, 255],
            fontSize: 8,
            fontStyle: 'bold',
            halign: 'left',
            cellPadding: 1.8,
          },
          bodyStyles: {
            fontSize: 7.5,
            textColor: [30, 41, 59],
            cellPadding: 1.6,
            lineColor: [226, 232, 240],
            lineWidth: 0.1,
          },
          alternateRowStyles: {
            fillColor: [240, 253, 250], // Teal 50 suave
          },
          columnStyles: {
            0: { cellWidth: 16, halign: 'center' }, // Data
            1: { cellWidth: 28, fontStyle: 'bold' }, // Humor
            2: { cellWidth: 24, fontStyle: 'bold' }, // Nível de dor
            3: { cellWidth: 32 },                  // Regiões
            4: { cellWidth: 24 },                  // Registrado por
            5: { cellWidth: 'auto' },              // Observações
          },
          didParseCell: (data) => {
            if (data.section === 'body' && data.column.index === 2) {
              if (data.cell.raw === 'Sem dores') {
                data.cell.styles.textColor = [22, 101, 52]; // Green 800
              } else if (data.cell.raw === 'Dor leve') {
                data.cell.styles.textColor = [161, 98, 7]; // Yellow 700
              } else {
                data.cell.styles.textColor = [185, 28, 28]; // Red 700
                data.cell.styles.fontStyle = 'bold';
              }
            }
          },
        });
      }

      // ─── Rodapé Fixo em Todas as Páginas ────────────────────────────
      // Exibição obrigatória de @ducaapp à direita e paginação à esquerda
      const totalPages = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);

        // Linha divisória de rodapé
        doc.setDrawColor(226, 232, 240); // Slate 200
        doc.setLineWidth(0.3);
        doc.line(margin, pageHeight - 9, pageWidth - margin, pageHeight - 9);

        // Texto à esquerda: Paginação e confidencialidade
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184); // Slate 400
        doc.text(
          `Documento de Acompanhamento Diário • Página ${i} de ${totalPages}`,
          margin,
          pageHeight - 5
        );

        // Texto à direita: OBRIGATÓRIO @ducaapp
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(99, 102, 241); // Indigo 500
        doc.text('@ducaapp', pageWidth - margin, pageHeight - 5, { align: 'right' });
      }

      // Baixar arquivo imediatamente
      const cleanPatient = patientName.replace(/\s+/g, '_');
      doc.save(`Relatorio_DUCA_${cleanPatient}_${startDate}_a_${endDate}.pdf`);

      setSuccess(true);
      setTimeout(() => {
        onClose();
        setSuccess(false);
      }, 1800);
    } catch (err: any) {
      console.error('Erro ao gerar PDF:', err);
      setError(err.message || 'Ocorreu um erro ao gerar o relatório.');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm transition-opacity">
      <div 
        className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header do Modal */}
        <div className="flex justify-between items-center px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex flex-col">
            <h3 className="text-xl font-bold text-gray-900 tracking-tight">Gerar Relatório</h3>
            <p className="text-xs text-gray-500 mt-0.5">Resumo médico e nutricional em PDF</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-full bg-gray-100 text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo do Modal com Seletores */}
        <div className="p-6 space-y-4">
          <div className="bg-gray-50/80 p-4 rounded-2xl border border-gray-100 shadow-sm focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5 text-indigo-500" /> Data Inicial
            </label>
            <input 
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-transparent text-gray-900 text-base font-semibold outline-none cursor-pointer"
            />
          </div>
          
          <div className="bg-gray-50/80 p-4 rounded-2xl border border-gray-100 shadow-sm focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5 text-indigo-500" /> Data Final
            </label>
            <input 
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-transparent text-gray-900 text-base font-semibold outline-none cursor-pointer"
            />
          </div>

          {error && (
            <div className="flex items-start space-x-2 text-rose-600 bg-rose-50 p-3.5 rounded-2xl border border-rose-100">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="text-xs font-medium leading-tight">{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-start space-x-2 text-emerald-700 bg-emerald-50 p-3.5 rounded-2xl border border-emerald-100">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="text-xs font-semibold leading-tight">Relatório gerado! O download iniciará em instantes...</span>
            </div>
          )}

          {/* Botão de Ação com Espaçamento Amplo, Ergonômico e Perfeito */}
          <div className="pt-3">
            <button
              onClick={handleGenerate}
              disabled={isGenerating || success}
              className={cn(
                "w-full flex items-center justify-center space-x-2 py-4 px-6 rounded-2xl text-sm font-bold tracking-wide transition-all active:scale-[0.98]",
                isGenerating || success 
                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/25"
              )}
            >
              {isGenerating ? (
                <span className="animate-pulse">Gerando relatório...</span>
              ) : success ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Download concluído!</span>
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4" />
                  <span>Baixar Relatório em PDF</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
