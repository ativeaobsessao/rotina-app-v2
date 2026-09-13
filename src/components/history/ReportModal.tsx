import React, { useState } from 'react';
import { X, CalendarDays, FileDown, CheckCircle2, AlertCircle } from 'lucide-react';
import { getHistoricalMealLogs, getHistoricalMedicationLogs } from '../../services/api';
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
        throw new Error('A data inicial não pode ser maior que a data final.');
      }

      // Add 1 day to endDate to make it inclusive for beforeDate
      const endD = new Date(endDate + 'T00:00:00');
      endD.setDate(endD.getDate() + 1);
      const beforeDate = endD.toISOString().split('T')[0];

      // Fetch data
      const mealLogs = await getHistoricalMealLogs(patientId, beforeDate, startDate);
      const medLogs = await getHistoricalMedicationLogs(patientId, beforeDate, startDate);

      if (mealLogs.length === 0 && medLogs.length === 0) {
        throw new Error('Nenhum registro encontrado para este período.');
      }

      // Initialize PDF
      const doc = new jsPDF();
      
      // Document Settings
      const pageWidth = doc.internal.pageSize.width;
      
      // Header
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.text('Relatório de Rotina Diária', pageWidth / 2, 20, { align: 'center' });
      
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.text(`Paciente: ${patientName}`, 14, 30);
      doc.text(`Período: ${formatFriendlyDate(startDate)} a ${formatFriendlyDate(endDate)}`, 14, 38);
      doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 46);

      let currentY = 55;

      // Meals Section
      if (mealLogs.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('Refeições', 14, currentY);
        currentY += 5;

        const mealData = mealLogs.map(log => [
          log.event_date.split('-').reverse().join('/'),
          log.meal_time?.substring(0, 5) || '--:--',
          log.meal_config?.name || 'Refeição',
          log.creator?.name || 'Não informado',
          log.consumed ? 'Sim' : 'Não',
          log.notes || '-'
        ]);

        autoTable(doc, {
          startY: currentY,
          head: [['Data', 'Hora', 'Refeição', 'Cuidador', 'Consumiu', 'Observações']],
          body: mealData,
          theme: 'striped',
          headStyles: { fillColor: [79, 70, 229] }, // Indigo-600
          styles: { fontSize: 10 },
        });

        currentY = (doc as any).lastAutoTable.finalY + 15;
      }

      // Medications Section
      if (medLogs.length > 0) {
        // Check page break
        if (currentY > doc.internal.pageSize.height - 40) {
          doc.addPage();
          currentY = 20;
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('Medicamentos', 14, currentY);
        currentY += 5;

        const medData = medLogs.map(log => [
          log.event_date.split('-').reverse().join('/'),
          log.medication?.period?.scheduled_time?.substring(0, 5) || '--:--',
          log.medication?.name || 'Medicamento',
          log.medication?.dosage || '-',
          log.creator?.name || 'Não informado',
          log.status === 'administered' ? 'Administrado' : 'Não administrado',
          log.reason || log.notes || '-'
        ]);

        autoTable(doc, {
          startY: currentY,
          head: [['Data', 'Hora', 'Medicamento', 'Dose', 'Cuidador', 'Status', 'Observações']],
          body: medData,
          theme: 'striped',
          headStyles: { fillColor: [225, 29, 72] }, // Rose-600
          styles: { fontSize: 10 },
        });
      }

      // Save
      doc.save(`Relatorio_${patientName.replace(/\\s+/g, '_')}_${startDate}_${endDate}.pdf`);
      setSuccess(true);
      setTimeout(() => {
        onClose();
        setSuccess(false);
      }, 2000);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Ocorreu um erro ao gerar o relatório.');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm transition-opacity">
      <div 
        className="bg-white w-full sm:w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300"
      >
        <div className="flex justify-between items-center px-6 py-5 border-b border-gray-100">
          <div className="flex flex-col">
            <h3 className="text-xl font-bold text-gray-900">Gerar Relatório</h3>
            <p className="text-sm text-gray-500">Resumo de rotina em PDF</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-6 space-y-6 overflow-y-auto">
          {/* Apple-like Date Picker Containers */}
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 shadow-sm">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1.5">
                <CalendarDays className="w-4 h-4" /> Data Inicial
              </label>
              <input 
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-transparent text-gray-900 text-lg font-medium outline-none"
              />
            </div>
            
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 shadow-sm">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1.5">
                <CalendarDays className="w-4 h-4" /> Data Final
              </label>
              <input 
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-transparent text-gray-900 text-lg font-medium outline-none"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start space-x-2 text-rose-600 bg-rose-50 p-4 rounded-2xl">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span className="text-sm font-medium leading-tight">{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-start space-x-2 text-emerald-700 bg-emerald-50 p-4 rounded-2xl">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span className="text-sm font-medium leading-tight">Relatório gerado com sucesso! Iniciando download...</span>
            </div>
          )}
        </div>

        <div className="p-6 bg-white border-t border-gray-50 pb-safe">
          <button
            onClick={handleGenerate}
            disabled={isGenerating || success}
            className={cn(
              "w-full flex items-center justify-center space-x-2 py-4 rounded-2xl text-base font-bold transition-all active:scale-[0.98]",
              isGenerating || success 
                ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/20"
            )}
          >
            {isGenerating ? (
              <span className="animate-pulse">Processando...</span>
            ) : success ? (
              <>
                <CheckCircle2 className="w-5 h-5" />
                <span>Pronto!</span>
              </>
            ) : (
              <>
                <FileDown className="w-5 h-5" />
                <span>Baixar Relatório em PDF</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
