import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Edit2,
  Plus,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import {
  createShoppingItem,
  deleteShoppingItem,
  markShoppingItemPurchased,
  updateShoppingItem,
} from '../../services/api';
import { formatDateToTime } from '../../utils/date';
import { dismissMobileKeyboard, handleEnterKeySubmit } from '../../utils/keyboardSubmit';
import {
  parsePriceInputToCents,
  sortPendingShoppingItems,
  type ShoppingItemRecord,
} from '../../utils/shopping';

interface ShoppingListModalProps {
  isOpen: boolean;
  initialMode?: 'list' | 'add';
  onClose: () => void;
  patientId: string;
  familyId: string;
  profileId: string;
  eventDate: string;
  canEdit: boolean;
  items: ShoppingItemRecord[];
  onChanged: () => void | Promise<void>;
}

export function ShoppingListModal({
  isOpen,
  initialMode = 'list',
  onClose,
  patientId,
  familyId,
  profileId,
  eventDate,
  canEdit,
  items,
  onChanged,
}: ShoppingListModalProps) {
  const [view, setView] = useState<'list' | 'form' | 'purchase'>('list');
  const [editingItem, setEditingItem] = useState<ShoppingItemRecord | null>(null);
  const [purchasingItem, setPurchasingItem] = useState<ShoppingItemRecord | null>(null);
  const [itemToDelete, setItemToDelete] = useState<ShoppingItemRecord | null>(null);

  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [priceInput, setPriceInput] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isSavingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setDeleteError(null);
    setItemToDelete(null);
    setPurchasingItem(null);
    setEditingItem(null);
    setPriceInput('');

    if (initialMode === 'add' && canEdit) {
      setName('');
      setQuantity('');
      setNotes('');
      setIsUrgent(false);
      setView('form');
    } else {
      setView('list');
    }
  }, [isOpen, initialMode, canEdit]);

  const sortedItems = sortPendingShoppingItems(items);

  const openAddForm = () => {
    setError('');
    setEditingItem(null);
    setName('');
    setQuantity('');
    setNotes('');
    setIsUrgent(false);
    setView('form');
  };

  const openEditForm = (item: ShoppingItemRecord) => {
    setError('');
    setEditingItem(item);
    setName(item.name);
    setQuantity(item.quantity || '');
    setNotes(item.notes || '');
    setIsUrgent(Boolean(item.is_urgent));
    setView('form');
  };

  const openPurchaseConfirm = (item: ShoppingItemRecord) => {
    setError('');
    setPurchasingItem(item);
    setPriceInput('');
    setView('purchase');
  };

  const handleSaveForm = async () => {
    if (isSavingRef.current || loading || !canEdit) return;

    const cleanName = name.trim();
    if (!cleanName) {
      setError('Informe o nome do alimento ou item que acabou.');
      return;
    }

    isSavingRef.current = true;
    setLoading(true);
    setError('');
    try {
      if (editingItem) {
        await updateShoppingItem(editingItem.id, patientId, {
          name: cleanName,
          quantity: quantity.trim() || null,
          notes: notes.trim() || null,
          is_urgent: isUrgent,
          updated_by: profileId,
        });
      } else {
        await createShoppingItem({
          family_id: familyId,
          patient_id: patientId,
          name: cleanName,
          quantity: quantity.trim() || null,
          notes: notes.trim() || null,
          is_urgent: isUrgent,
          requested_by: profileId,
        });
      }

      await onChanged();
      setEditingItem(null);
      setView('list');
    } catch (err: any) {
      setError(err?.message || 'Não foi possível salvar o item.');
    } finally {
      isSavingRef.current = false;
      setLoading(false);
    }
  };

  const handleConfirmPurchase = async () => {
    if (isSavingRef.current || loading || !canEdit || !purchasingItem) return;

    let priceCents: number | null = null;
    try {
      priceCents = parsePriceInputToCents(priceInput);
    } catch (err: any) {
      setError(err?.message || 'Valor inválido.');
      return;
    }

    isSavingRef.current = true;
    setLoading(true);
    setError('');
    try {
      await markShoppingItemPurchased({
        itemId: purchasingItem.id,
        patientId,
        profileId,
        priceCents,
        purchasedDate: eventDate,
      });
      await onChanged();
      setPurchasingItem(null);
      setPriceInput('');
      setView('list');
    } catch (err: any) {
      setError(err?.message || 'Não foi possível confirmar a compra.');
    } finally {
      isSavingRef.current = false;
      setLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (isSavingRef.current || loading || !canEdit || !itemToDelete) return;

    isSavingRef.current = true;
    setLoading(true);
    setDeleteError(null);
    try {
      await deleteShoppingItem(itemToDelete.id, patientId);
      await onChanged();
      setItemToDelete(null);
    } catch (err: any) {
      setDeleteError(err?.message || 'Não foi possível apagar este item.');
    } finally {
      isSavingRef.current = false;
      setLoading(false);
    }
  };

  const sheetTitle =
    view === 'form'
      ? editingItem
        ? 'Editar item'
        : 'Novo item para comprar'
      : view === 'purchase'
      ? 'Confirmar compra'
      : 'Lista de Compras';

  return (
    <>
      <BottomSheet
        isOpen={isOpen}
        onClose={() => {
          if (!loading) onClose();
        }}
        title={sheetTitle}
      >
        <div className="space-y-4">
          {view === 'list' && (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-gray-500 dark:text-zinc-400">
                  {sortedItems.length === 0
                    ? 'Nenhum item pendente para comprar.'
                    : `${sortedItems.length} ${
                        sortedItems.length === 1 ? 'item pendente' : 'itens pendentes'
                      }`}
                </p>

                {canEdit && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={openAddForm}
                    className="min-h-[44px] px-4 rounded-xl inline-flex items-center gap-1.5 font-semibold"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Adicionar item</span>
                  </Button>
                )}
              </div>

              {error && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 text-rose-700 dark:text-rose-300 rounded-xl text-xs">
                  {error}
                </div>
              )}

              {sortedItems.length === 0 ? (
                <div className="py-10 px-4 text-center rounded-2xl bg-gray-50 dark:bg-[#1c1c22] border border-gray-100 dark:border-white/[0.08] space-y-3">
                  <div className="w-12 h-12 rounded-full bg-white dark:bg-[#121216] border border-gray-200/70 dark:border-white/[0.08] flex items-center justify-center mx-auto text-gray-400 dark:text-zinc-500">
                    <ShoppingBag className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                      Lista de compras vazia
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-zinc-400 max-w-xs mx-auto leading-relaxed">
                      Quando algum alimento, remédio ou item de cuidado acabar, registre aqui para toda a família acompanhar.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {sortedItems.map((item) => {
                    const requesterName = item.requester?.name || 'Familiar';
                    return (
                      <div
                        key={item.id}
                        className={`rounded-2xl border p-4 transition-colors ${
                          item.is_urgent
                            ? 'bg-rose-50/75 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/60'
                            : 'bg-white dark:bg-[#1c1c22] border-gray-200/80 dark:border-white/[0.08]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            {item.is_urgent && (
                              <div className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 dark:text-rose-300 mb-1">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                <span>COMPRAR COM URGÊNCIA</span>
                              </div>
                            )}

                            <h4 className="text-base font-bold text-gray-900 dark:text-zinc-100 leading-snug break-words">
                              {item.name}
                            </h4>

                            {(item.quantity || item.notes) && (
                              <p className="text-xs text-gray-600 dark:text-zinc-300 mt-1 leading-relaxed">
                                {[item.quantity, item.notes].filter(Boolean).join(' · ')}
                              </p>
                            )}

                            <p className="text-[11px] text-gray-500 dark:text-zinc-400 mt-1.5">
                              Pedido por{' '}
                              <span className="font-medium text-gray-700 dark:text-zinc-300">
                                {requesterName}
                              </span>{' '}
                              às {formatDateToTime(item.created_at)}
                            </p>
                          </div>
                        </div>

                        {canEdit && (
                          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-white/[0.07]">
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => openPurchaseConfirm(item)}
                              className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                            >
                              <Check className="w-4 h-4" />
                              <span>Comprado</span>
                            </button>

                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => openEditForm(item)}
                              aria-label={`Editar ${item.name}`}
                              title="Editar item"
                              className="min-w-[44px] min-h-[44px] px-3 rounded-xl bg-gray-100 dark:bg-[#26262f] hover:bg-gray-200 dark:hover:bg-white/[0.12] text-gray-700 dark:text-zinc-200 inline-flex items-center justify-center transition-colors"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>

                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => {
                                setDeleteError(null);
                                setItemToDelete(item);
                              }}
                              aria-label={`Apagar ${item.name}`}
                              title="Apagar item"
                              className="min-w-[44px] min-h-[44px] px-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 inline-flex items-center justify-center transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {view === 'form' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                dismissMobileKeyboard();
                void handleSaveForm();
              }}
              className="space-y-5"
            >
              <button
                type="button"
                disabled={loading}
                onClick={() => setView('list')}
                className="min-h-[40px] inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-zinc-100"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Voltar para a lista</span>
              </button>

              {error && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 text-rose-700 dark:text-rose-300 rounded-xl text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                  O que acabou?
                </label>
                <Input
                  enterKeyHint="done"
                  disabled={loading}
                  placeholder="Ex: Leite sem lactose, Fralda G, Nutren"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => handleEnterKeySubmit(e, handleSaveForm)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                  Quantidade{' '}
                  <span className="text-gray-400 dark:text-zinc-500 font-normal">(Opcional)</span>
                </label>
                <Input
                  enterKeyHint="done"
                  disabled={loading}
                  placeholder="Ex: 2 caixas, 1 pacote, 3 unidades"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  onKeyDown={(e) => handleEnterKeySubmit(e, handleSaveForm)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                  Observação ou marca{' '}
                  <span className="text-gray-400 dark:text-zinc-500 font-normal">(Opcional)</span>
                </label>
                <Input
                  enterKeyHint="done"
                  disabled={loading}
                  placeholder="Ex: Marca específica ou tamanho"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onKeyDown={(e) => handleEnterKeySubmit(e, handleSaveForm)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                  Prioridade
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setIsUrgent(false)}
                    className={`min-h-[48px] p-3 rounded-xl border text-left transition-colors ${
                      !isUrgent
                        ? 'bg-gray-900 text-white border-gray-900 dark:bg-zinc-100 dark:text-zinc-950 dark:border-zinc-100'
                        : 'bg-white dark:bg-[#1c1c22] text-gray-700 dark:text-zinc-200 border-gray-200 dark:border-white/[0.1]'
                    }`}
                  >
                    <span className="block text-xs font-bold">Normal</span>
                    <span className="block text-[11px] opacity-80 mt-0.5">Reposição comum</span>
                  </button>

                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setIsUrgent(true)}
                    className={`min-h-[48px] p-3 rounded-xl border text-left transition-colors ${
                      isUrgent
                        ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                        : 'bg-white dark:bg-[#1c1c22] text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/50 hover:bg-rose-50/70 dark:hover:bg-rose-950/30'
                    }`}
                  >
                    <span className="flex items-center gap-1 text-xs font-bold">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>Comprar urgente</span>
                    </span>
                    <span className="block text-[11px] opacity-90 mt-0.5">Aviso imediato</span>
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  size="lg"
                  className="w-full min-h-[48px]"
                  disabled={loading || !name.trim()}
                >
                  {loading ? (
                    <Spinner className="text-white dark:text-zinc-950" />
                  ) : editingItem ? (
                    'Salvar alterações'
                  ) : (
                    'Adicionar à lista'
                  )}
                </Button>
              </div>
            </form>
          )}

          {view === 'purchase' && purchasingItem && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                dismissMobileKeyboard();
                void handleConfirmPurchase();
              }}
              className="space-y-5"
            >
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setPurchasingItem(null);
                  setView('list');
                }}
                className="min-h-[40px] inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-zinc-100"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Voltar para a lista</span>
              </button>

              <div className="rounded-2xl bg-gray-50 dark:bg-[#1c1c22] border border-gray-100 dark:border-white/[0.08] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                  Item comprado
                </p>
                <h4 className="text-base font-bold text-gray-900 dark:text-zinc-100 mt-1">
                  {purchasingItem.name}
                </h4>
                {(purchasingItem.quantity || purchasingItem.notes) && (
                  <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                    {[purchasingItem.quantity, purchasingItem.notes].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>

              {error && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 text-rose-700 dark:text-rose-300 rounded-xl text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                  Valor gasto{' '}
                  <span className="text-gray-400 dark:text-zinc-500 font-normal">(Opcional)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-500 dark:text-zinc-400 pointer-events-none">
                    R$
                  </span>
                  <Input
                    inputMode="decimal"
                    enterKeyHint="done"
                    disabled={loading}
                    placeholder="0,00"
                    className="pl-10 tabular-nums"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    onKeyDown={(e) => handleEnterKeySubmit(e, handleConfirmPurchase)}
                  />
                </div>
                <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">
                  Pode deixar em branco se não estiver com a nota agora. O valor pode ser preenchido ou ajustado depois no Histórico.
                </p>
              </div>

              <div className="pt-1 space-y-2.5">
                <Button
                  type="submit"
                  size="lg"
                  disabled={loading}
                  className="w-full min-h-[48px] bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {loading ? (
                    <Spinner className="text-white" />
                  ) : (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      <span>Confirmar compra</span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}
        </div>
      </BottomSheet>

      <ConfirmDialog
        isOpen={Boolean(itemToDelete)}
        title="Apagar item da lista?"
        description={
          <>
            Tem certeza que deseja excluir{' '}
            <strong className="text-gray-700 dark:text-zinc-200">{itemToDelete?.name}</strong> da
            lista de compras? Esta ação não pode ser desfeita.
          </>
        }
        confirmLabel="Apagar definitivamente"
        cancelLabel="Manter na lista"
        tone="danger"
        icon="trash"
        loading={loading}
        error={deleteError}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setDeleteError(null);
          setItemToDelete(null);
        }}
      />
    </>
  );
}
