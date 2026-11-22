import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import {
  deleteShoppingItem,
  revertShoppingItemToPending,
  updateShoppingItem,
} from '../../services/api';
import { formatDateToTime } from '../../utils/date';
import { dismissMobileKeyboard, handleEnterKeySubmit } from '../../utils/keyboardSubmit';
import {
  formatCentsForInput,
  parsePriceInputToCents,
  type ShoppingItemRecord,
} from '../../utils/shopping';

interface ShoppingItemEditModalProps {
  isOpen: boolean;
  item: ShoppingItemRecord | null;
  onClose: () => void;
  patientId: string;
  profileId: string;
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
}

export function ShoppingItemEditModal({
  isOpen,
  item,
  onClose,
  patientId,
  profileId,
  canEdit,
  onChanged,
}: ShoppingItemEditModalProps) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [purchasedDate, setPurchasedDate] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmAction, setConfirmAction] = useState<'delete' | 'revert' | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const isSavingRef = useRef(false);

  useEffect(() => {
    if (!isOpen || !item) return;
    setName(item.name);
    setQuantity(item.quantity || '');
    setNotes(item.notes || '');
    setPriceInput(formatCentsForInput(item.price_cents));
    setPurchasedDate(item.purchased_date || '');
    setIsUrgent(Boolean(item.is_urgent));
    setError('');
    setConfirmAction(null);
    setDialogError(null);
  }, [isOpen, item]);

  if (!item) return null;

  const handleSave = async () => {
    if (isSavingRef.current || loading || !canEdit) return;

    const cleanName = name.trim();
    if (!cleanName) {
      setError('O nome do item não pode ficar vazio.');
      return;
    }

    let parsedPrice: number | null = null;
    try {
      parsedPrice = parsePriceInputToCents(priceInput);
    } catch (err: any) {
      setError(err?.message || 'Valor inválido.');
      return;
    }

    isSavingRef.current = true;
    setLoading(true);
    setError('');
    try {
      await updateShoppingItem(item.id, patientId, {
        name: cleanName,
        quantity: quantity.trim() || null,
        notes: notes.trim() || null,
        is_urgent: isUrgent,
        price_cents: parsedPrice,
        purchased_date: purchasedDate || undefined,
        updated_by: profileId,
      });
      await onChanged();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível atualizar o registro da compra.');
    } finally {
      isSavingRef.current = false;
      setLoading(false);
    }
  };

  const handleConfirmDialog = async () => {
    if (isSavingRef.current || loading || !canEdit || !confirmAction) return;

    isSavingRef.current = true;
    setLoading(true);
    setDialogError(null);
    try {
      if (confirmAction === 'revert') {
        await revertShoppingItemToPending(item.id, patientId, profileId);
      } else {
        await deleteShoppingItem(item.id, patientId);
      }
      await onChanged();
      setConfirmAction(null);
      onClose();
    } catch (err: any) {
      setDialogError(
        err?.message ||
          (confirmAction === 'revert'
            ? 'Não foi possível devolver o item para a Lista de Compras.'
            : 'Não foi possível apagar o registro.')
      );
    } finally {
      isSavingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <>
      <BottomSheet
        isOpen={isOpen}
        onClose={() => {
          if (!loading) onClose();
        }}
        title="Detalhes da compra"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            dismissMobileKeyboard();
            void handleSave();
          }}
          className="space-y-4"
        >
          <div className="rounded-2xl bg-gray-50 dark:bg-[#1c1c22] border border-gray-100 dark:border-white/[0.08] p-3.5 text-xs text-gray-600 dark:text-zinc-300 space-y-1">
            <p>
              Pedido por{' '}
              <span className="font-semibold text-gray-900 dark:text-zinc-100">
                {item.requester?.name || 'Familiar'}
              </span>{' '}
              às {formatDateToTime(item.created_at)}
            </p>
            {item.purchased_at && (
              <p>
                Comprado por{' '}
                <span className="font-semibold text-gray-900 dark:text-zinc-100">
                  {item.purchaser?.name || 'Familiar'}
                </span>{' '}
                às {formatDateToTime(item.purchased_at)}
              </p>
            )}
          </div>

          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 text-rose-700 dark:text-rose-300 rounded-xl text-sm">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Item</label>
            <Input
              enterKeyHint="done"
              disabled={loading || !canEdit}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => handleEnterKeySubmit(e, handleSave)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                Valor gasto
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-500 dark:text-zinc-400 pointer-events-none">
                  R$
                </span>
                <Input
                  inputMode="decimal"
                  enterKeyHint="done"
                  disabled={loading || !canEdit}
                  placeholder="0,00"
                  className="pl-10 tabular-nums"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  onKeyDown={(e) => handleEnterKeySubmit(e, handleSave)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                Data da compra
              </label>
              <Input
                type="date"
                disabled={loading || !canEdit}
                value={purchasedDate}
                onChange={(e) => setPurchasedDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
              Quantidade
            </label>
            <Input
              enterKeyHint="done"
              disabled={loading || !canEdit}
              placeholder="Ex: 2 caixas"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              onKeyDown={(e) => handleEnterKeySubmit(e, handleSave)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
              Observação ou marca
            </label>
            <Input
              enterKeyHint="done"
              disabled={loading || !canEdit}
              placeholder="Alguma observação?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={(e) => handleEnterKeySubmit(e, handleSave)}
            />
          </div>

          {canEdit && (
            <>
              <button
                type="button"
                disabled={loading}
                onClick={() => setIsUrgent((prev) => !prev)}
                className={`w-full min-h-[44px] px-4 py-2.5 rounded-xl border text-left flex items-center justify-between transition-colors ${
                  isUrgent
                    ? 'bg-rose-50 dark:bg-rose-950/35 border-rose-200 dark:border-rose-800/60 text-rose-800 dark:text-rose-200'
                    : 'bg-white dark:bg-[#1c1c22] border-gray-200 dark:border-white/[0.1] text-gray-700 dark:text-zinc-300'
                }`}
              >
                <span className="inline-flex items-center gap-2 text-xs font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Marcado como compra urgente</span>
                </span>
                <span className="text-xs font-bold">{isUrgent ? 'Sim' : 'Não'}</span>
              </button>

              <div className="pt-2 space-y-2.5">
                <Button
                  type="submit"
                  size="lg"
                  disabled={loading || !name.trim()}
                  className="w-full min-h-[48px]"
                >
                  {loading ? <Spinner className="text-white dark:text-zinc-950" /> : 'Salvar alterações'}
                </Button>

                <div className="grid grid-cols-2 gap-2.5">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loading}
                    onClick={() => {
                      setDialogError(null);
                      setConfirmAction('revert');
                    }}
                    className="w-full min-h-[44px] text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Voltar p/ lista</span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    disabled={loading}
                    onClick={() => {
                      setDialogError(null);
                      setConfirmAction('delete');
                    }}
                    className="w-full min-h-[44px] text-xs font-semibold text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900/50 hover:bg-rose-50 dark:hover:bg-rose-950/40 inline-flex items-center justify-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Apagar</span>
                  </Button>
                </div>
              </div>
            </>
          )}
        </form>
      </BottomSheet>

      <ConfirmDialog
        isOpen={Boolean(confirmAction)}
        title={
          confirmAction === 'revert'
            ? 'Voltar item para a Lista de Compras?'
            : 'Apagar registro de compra?'
        }
        description={
          confirmAction === 'revert' ? (
            <>
              <strong className="text-gray-700 dark:text-zinc-200">{item.name}</strong> sairá do
              Histórico de compras e voltará imediatamente como pendente na tela Inicial.
            </>
          ) : (
            <>
              Tem certeza que deseja excluir definitivamente{' '}
              <strong className="text-gray-700 dark:text-zinc-200">{item.name}</strong> do
              Histórico de compras? Esta ação não pode ser desfeita.
            </>
          )
        }
        confirmLabel={
          confirmAction === 'revert' ? 'Voltar para a lista' : 'Apagar definitivamente'
        }
        cancelLabel="Cancelar"
        tone={confirmAction === 'revert' ? 'neutral' : 'danger'}
        icon={confirmAction === 'revert' ? 'revert' : 'trash'}
        loading={loading}
        error={dialogError}
        onConfirm={handleConfirmDialog}
        onCancel={() => {
          setDialogError(null);
          setConfirmAction(null);
        }}
      />
    </>
  );
}
