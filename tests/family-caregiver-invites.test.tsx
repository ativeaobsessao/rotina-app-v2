import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import { supabase } from '../src/services/supabase.ts';
import {
  createFamilyInvite,
  resendFamilyInvite,
  acceptFamilyInvite,
  revokeFamilyInvite,
  deleteFamilyInvite,
  clearFamilyInviteHistory,
  removeFamilyMember,
  updateFamilyMemberRole,
  getFamilyMembers,
  getFamilyInvites,
} from '../src/services/api.ts';
import { FamilyModal } from '../src/components/ui/FamilyModal.tsx';

let cachedCreateRoot: ((container: Element | DocumentFragment) => any) | null = null;

async function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://duca.local/',
  });
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
  (globalThis as any).Node = dom.window.Node;
  (globalThis as any).Event = dom.window.Event;
  (globalThis as any).InputEvent = dom.window.InputEvent;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });

  if (!cachedCreateRoot) {
    const reactDomClient = await import('react-dom/client');
    cachedCreateRoot = reactDomClient.createRoot;
  }

  return { dom, createRoot: cachedCreateRoot };
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const proto = (globalThis as any).HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new (globalThis as any).Event('input', { bubbles: true }));
  input.dispatchEvent(new (globalThis as any).Event('change', { bubbles: true }));
}

interface MockMember {
  id: string;
  family_id: string;
  user_id: string;
  role: 'ADMIN' | 'MEMBER';
  member_type: 'FAMILY' | 'CAREGIVER';
  created_at: string;
}

interface MockInvite {
  id: string;
  family_id: string;
  created_by: string;
  token: string;
  token_hash: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  invited_name: string | null;
  member_type: 'FAMILY' | 'CAREGIVER';
  expires_at: string;
  accepted_by: string | null;
  accepted_at: string | null;
  created_at: string;
}

function installFamilySupabaseMock(initialActorId = 'admin-1') {
  const originalFrom = supabase.from;
  const originalRpc = supabase.rpc;
  const originalGetUser = supabase.auth.getUser;

  let currentActorId = initialActorId;
  const familyId = 'fam-1';

  const profiles = new Map<string, { id: string; family_id: string; name: string; email: string; avatar_url: null }>([
    ['admin-1', { id: 'admin-1', family_id: familyId, name: 'Gustavo (ADM)', email: 'gustavo@duca.local', avatar_url: null }],
    ['fam-member-1', { id: 'fam-member-1', family_id: familyId, name: 'Ana (Irmã)', email: 'ana@duca.local', avatar_url: null }],
    ['caregiver-user-1', { id: 'caregiver-user-1', family_id: 'other-fam', name: 'Carla Oliveira', email: 'carla@duca.local', avatar_url: null }],
    ['fam-invitee-1', { id: 'fam-invitee-1', family_id: 'other-fam-2', name: 'Helena Santos', email: 'helena@duca.local', avatar_url: null }],
  ]);

  let members: MockMember[] = [
    {
      id: 'mem-1',
      family_id: familyId,
      user_id: 'admin-1',
      role: 'ADMIN',
      member_type: 'FAMILY',
      created_at: '2026-11-01T10:00:00.000Z',
    },
    {
      id: 'mem-2',
      family_id: familyId,
      user_id: 'fam-member-1',
      role: 'MEMBER',
      member_type: 'FAMILY',
      created_at: '2026-11-02T10:00:00.000Z',
    },
  ];

  let invites: MockInvite[] = [];
  let inviteSeq = 0;
  let memberSeq = 2;
  const rpcCalls: Array<{ fn: string; args: any }> = [];

  (supabase.auth as any).getUser = async () => ({
    data: { user: { id: currentActorId } },
    error: null,
  });

  (supabase as any).from = (table: string) => {
    const state: any = { eqs: {}, ins: {} };
    const builder: any = {
      select: () => builder,
      eq: (col: string, val: any) => {
        state.eqs[col] = val;
        return builder;
      },
      in: (col: string, vals: any[]) => {
        state.ins[col] = vals;
        return builder;
      },
      order: () => builder,
      insert: async () => ({
        data: null,
        error: { code: '42501', message: `permission denied for table ${table}` },
      }),
      update: () => ({
        eq: async () => ({
          data: null,
          error: { code: '42501', message: `permission denied for table ${table}` },
        }),
      }),
      delete: () => ({
        eq: async () => ({
          data: null,
          error: { code: '42501', message: `permission denied for table ${table}` },
        }),
      }),
      then: (resolve: any, reject: any) => {
        try {
          if (table === 'family_members') {
            const rows = members.filter((m) =>
              (!state.eqs.family_id || m.family_id === state.eqs.family_id) &&
              (!state.eqs.user_id || m.user_id === state.eqs.user_id)
            );
            return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(resolve, reject);
          }
          if (table === 'profiles') {
            const ids = state.ins.id || [];
            const rows = ids.map((id: string) => profiles.get(id)).filter(Boolean);
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          }
          if (table === 'family_invites') {
            const caller = members.find((m) => m.family_id === state.eqs.family_id && m.user_id === currentActorId);
            if (!caller || caller.role !== 'ADMIN') {
              return Promise.resolve({ data: [], error: null }).then(resolve, reject);
            }
            const rows = invites.filter((i) => !state.eqs.family_id || i.family_id === state.eqs.family_id);
            return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        } catch (err) {
          return Promise.reject(err).then(resolve, reject);
        }
      },
    };
    return builder;
  };

  (supabase as any).rpc = async (fn: string, args: any = {}) => {
    rpcCalls.push({ fn, args });
    const callerProfile = profiles.get(currentActorId);
    const activeFamilyId = callerProfile?.family_id;

    if (fn === 'create_family_invite') {
      const callerMember = members.find((m) => m.family_id === activeFamilyId && m.user_id === currentActorId);
      if (!callerMember || callerMember.role !== 'ADMIN') {
        return { data: null, error: { code: '42501', message: 'Apenas administradores podem criar convites.' } };
      }
      const memberType = String(args?.p_member_type || 'FAMILY').trim().toUpperCase();
      if (memberType !== 'FAMILY' && memberType !== 'CAREGIVER') {
        return { data: null, error: { message: 'Tipo de convite inválido. Use FAMILY ou CAREGIVER.' } };
      }
      const invitedName = String(args?.p_invited_name ?? '').trim() || null;
      inviteSeq += 1;
      const token = `tok-${inviteSeq}-${memberType.toLowerCase()}`;
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const inv: MockInvite = {
        id: `inv-${inviteSeq}`,
        family_id: activeFamilyId!,
        created_by: currentActorId,
        token,
        token_hash: `hash-${token}`,
        status: 'pending',
        invited_name: invitedName,
        member_type: memberType as 'FAMILY' | 'CAREGIVER',
        expires_at: expiresAt,
        accepted_by: null,
        accepted_at: null,
        created_at: new Date().toISOString(),
      };
      invites.unshift(inv);
      return {
        data: {
          invite_id: inv.id,
          token: inv.token,
          expires_at: inv.expires_at,
          invited_name: inv.invited_name,
          member_type: inv.member_type,
        },
        error: null,
      };
    }

    if (fn === 'resend_family_invite') {
      const inv = invites.find((i) => i.id === args?.p_invite_id);
      if (!inv) return { data: null, error: { message: 'Convite não encontrado.' } };
      const caller = members.find((m) => m.family_id === inv.family_id && m.user_id === currentActorId);
      if (!caller || caller.role !== 'ADMIN') {
        return { data: null, error: { code: '42501', message: 'Apenas administradores podem reenviar convites desta família.' } };
      }
      if (inv.status === 'accepted') {
        return { data: null, error: { message: 'Este convite já foi aceito e não pode ser reenviado.' } };
      }
      if (inv.status === 'revoked') {
        return { data: null, error: { message: 'Este convite foi revogado. Crie um novo convite se precisar convidar novamente.' } };
      }
      if (inv.status !== 'pending' && inv.status !== 'expired') {
        return { data: null, error: { message: 'Este convite não está disponível para reenvio.' } };
      }

      inviteSeq += 1;
      const newToken = `tok-resend-${inviteSeq}-${inv.member_type.toLowerCase()}`;
      inv.token = newToken;
      inv.token_hash = `hash-${newToken}`;
      inv.status = 'pending';
      inv.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      return {
        data: {
          invite_id: inv.id,
          token: inv.token,
          expires_at: inv.expires_at,
          invited_name: inv.invited_name,
          member_type: inv.member_type,
        },
        error: null,
      };
    }

    if (fn === 'accept_family_invite') {
      const inv = invites.find((i) => i.token === args?.p_token);
      if (!inv) return { data: null, error: { message: 'Convite inválido ou não encontrado.' } };
      if (inv.status !== 'pending') return { data: null, error: { message: 'Convite já foi utilizado, expirado ou revogado.' } };
      if (new Date(inv.expires_at).getTime() < Date.now()) {
        inv.status = 'expired';
        return { data: null, error: { message: 'Convite expirado.' } };
      }
      if (members.some((m) => m.family_id === inv.family_id && m.user_id === currentActorId)) {
        return { data: null, error: { message: 'Usuário já pertence a esta família. Nenhuma alteração foi feita.' } };
      }

      const memberType = inv.member_type === 'CAREGIVER' ? 'CAREGIVER' : 'FAMILY';
      const initialRole: 'ADMIN' | 'MEMBER' = 'MEMBER';
      memberSeq += 1;
      members.push({
        id: `mem-${memberSeq}`,
        family_id: inv.family_id,
        user_id: currentActorId,
        role: initialRole,
        member_type: memberType,
        created_at: new Date().toISOString(),
      });
      inv.status = 'accepted';
      inv.accepted_by = currentActorId;
      inv.accepted_at = new Date().toISOString();

      return {
        data: {
          success: true,
          family_id: inv.family_id,
          role: initialRole,
          member_type: memberType,
        },
        error: null,
      };
    }

    if (fn === 'update_family_member_role') {
      const caller = members.find((m) => m.family_id === args.p_family_id && m.user_id === currentActorId);
      if (!caller || caller.role !== 'ADMIN') {
        return { data: null, error: { code: '42501', message: 'Apenas administradores podem alterar permissões de membros.' } };
      }
      const target = members.find((m) => m.family_id === args.p_family_id && m.user_id === args.p_user_id);
      if (!target) return { data: null, error: { message: 'Membro não encontrado nesta família.' } };
      if (target.role === 'ADMIN' && args.p_new_role === 'MEMBER') {
        const adminCount = members.filter((m) => m.family_id === args.p_family_id && m.role === 'ADMIN').length;
        if (adminCount <= 1) {
          return { data: null, error: { message: 'A família precisa ter pelo menos um Administrador ativo.' } };
        }
      }
      target.role = args.p_new_role;
      return { data: { success: true, user_id: target.user_id, role: target.role }, error: null };
    }

    if (fn === 'remove_family_member') {
      const caller = members.find((m) => m.family_id === args.p_family_id && m.user_id === currentActorId);
      if (!caller || caller.role !== 'ADMIN') {
        return { data: null, error: { code: '42501', message: 'Apenas administradores podem remover membros.' } };
      }
      const target = members.find((m) => m.family_id === args.p_family_id && m.user_id === args.p_user_id);
      if (!target) return { data: null, error: { message: 'Membro não encontrado nesta família.' } };
      if (target.role === 'ADMIN') {
        const adminCount = members.filter((m) => m.family_id === args.p_family_id && m.role === 'ADMIN').length;
        if (adminCount <= 1) {
          return { data: null, error: { message: 'Este usuário é o único administrador da família e não pode ser removido.' } };
        }
      }
      members = members.filter((m) => !(m.family_id === args.p_family_id && m.user_id === args.p_user_id));
      return { data: null, error: null };
    }

    if (fn === 'revoke_family_invite') {
      const inv = invites.find((i) => i.id === args.p_invite_id);
      if (!inv) return { data: null, error: { message: 'Convite não encontrado.' } };
      const caller = members.find((m) => m.family_id === inv.family_id && m.user_id === currentActorId);
      if (!caller || caller.role !== 'ADMIN') {
        return { data: null, error: { code: '42501', message: 'Apenas administradores podem revogar convites desta família.' } };
      }
      if (inv.status === 'pending') inv.status = 'revoked';
      return { data: null, error: null };
    }

    if (fn === 'delete_family_invite') {
      const inv = invites.find((i) => i.id === args.p_invite_id);
      if (!inv) return { data: null, error: { message: 'Convite não encontrado.' } };
      const caller = members.find((m) => m.family_id === inv.family_id && m.user_id === currentActorId);
      if (!caller || caller.role !== 'ADMIN') {
        return { data: null, error: { code: '42501', message: 'Apenas administradores podem apagar registros de convite.' } };
      }
      invites = invites.filter((i) => i.id !== args.p_invite_id);
      return { data: null, error: null };
    }

    if (fn === 'clear_family_invite_history') {
      const caller = members.find((m) => m.family_id === args.p_family_id && m.user_id === currentActorId);
      if (!caller || caller.role !== 'ADMIN') {
        return { data: null, error: { code: '42501', message: 'Apenas administradores podem limpar o histórico de convites.' } };
      }
      const before = invites.length;
      const nowMs = Date.now();
      invites = invites.filter((i) => {
        if (i.family_id !== args.p_family_id) return true;
        const isExpiredPending = i.status === 'pending' && new Date(i.expires_at).getTime() < nowMs;
        const shouldDelete = ['accepted', 'revoked', 'expired'].includes(i.status) || isExpiredPending;
        return !shouldDelete;
      });
      return { data: before - invites.length, error: null };
    }

    return { data: null, error: null };
  };

  return {
    familyId,
    setActor: (id: string) => {
      currentActorId = id;
    },
    getMembers: () => members,
    getInvites: () => invites,
    addInviteDirect: (inv: MockInvite) => invites.unshift(inv),
    getRpcCalls: () => rpcCalls,
    restore: () => {
      (supabase as any).from = originalFrom;
      (supabase as any).rpc = originalRpc;
      (supabase.auth as any).getUser = originalGetUser;
    },
  };
}

// ============================================================================
// TESTE ESTÁTICO DA MIGRATION 0015
// ============================================================================

test('[Estático SQL] Migration 0015 adiciona member_type e invited_name de forma idempotente, segura e sem perda de dados', () => {
  const sqlPath = path.resolve('supabase/migrations/0015_family_caregiver_distinction.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Colunas e CHECK constraints
  assert.match(sql, /ALTER TABLE public\.family_members[\s\S]*ADD COLUMN IF NOT EXISTS member_type TEXT NOT NULL DEFAULT 'FAMILY'/);
  assert.match(sql, /CHECK \(member_type IN \('FAMILY', 'CAREGIVER'\)\)/);
  assert.match(sql, /ALTER TABLE public\.family_invites[\s\S]*ADD COLUMN IF NOT EXISTS invited_name TEXT/);
  assert.match(sql, /ALTER TABLE public\.family_invites[\s\S]*ADD COLUMN IF NOT EXISTS member_type TEXT NOT NULL DEFAULT 'FAMILY'/);

  // Drop da assinatura antiga 0-arg para evitar overload ambíguo
  assert.ok(sql.includes('DROP FUNCTION IF EXISTS public.create_family_invite();'));
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.create_family_invite\(\s*p_invited_name TEXT DEFAULT NULL,\s*p_member_type TEXT DEFAULT 'FAMILY'/);

  // Aceitação aplicando member_type e role inicial MEMBER
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.accept_family_invite\(p_token TEXT\)/);
  assert.match(sql, /v_initial_role := 'MEMBER';/);
  assert.match(sql, /INSERT INTO public\.family_members \(family_id, user_id, role, member_type\)/);

  // Segurança RBAC e pgcrypto mantidas
  assert.ok(sql.includes('REVOKE INSERT, UPDATE, DELETE ON public.family_members FROM anon, authenticated;'));
  assert.ok(sql.includes('REVOKE INSERT, UPDATE, DELETE ON public.family_invites FROM anon, authenticated;'));
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.create_family_invite(text, text) FROM PUBLIC, anon;'));
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.create_family_invite(text, text) TO authenticated, service_role;'));
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.accept_family_invite(text) FROM PUBLIC, anon;'));
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.accept_family_invite(text) TO authenticated, service_role;'));
  assert.equal(/DROP TABLE/i.test(sql), false);
  assert.equal(/TRUNCATE/i.test(sql), false);
});

// ============================================================================
// TESTES A & B — CRIAÇÃO DE CONVITES FAMILIAR E CUIDADOR COM NOME + LISTAGEM PENDENTE
// ============================================================================

test('[Testes A & B] ADM cria convite Familiar e convite Cuidador com nome e visualiza ambos nos Convites Pendentes', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const mock = installFamilySupabaseMock('admin-1');

  try {
    await act(async () => {
      root.render(
        React.createElement(FamilyModal, {
          familyId: mock.familyId,
          currentUserId: 'admin-1',
          lovedOneName: 'Vó Lourdes',
          onClose: () => {},
        })
      );
    });

    // Abrir + Novo Convite (Teste A: Familiar)
    const openBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('+ Novo Convite')
    );
    assert.ok(openBtn);
    await act(async () => {
      openBtn.click();
    });

    // Valida erro se nome estiver vazio
    const generateBtnEmpty = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Gerar Convite')
    );
    assert.ok(generateBtnEmpty);
    await act(async () => {
      generateBtnEmpty.click();
    });
    assert.match(container.textContent || '', /informe o nome da pessoa convidada/i);

    const nameInput = container.querySelector('#invite-person-name') as HTMLInputElement;
    assert.ok(nameInput);
    await act(async () => {
      setReactInputValue(nameInput, 'Tia Helena');
    });

    const generateFamilyBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Gerar Convite Familiar')
    );
    assert.ok(generateFamilyBtn);
    await act(async () => {
      generateFamilyBtn.click();
    });

    const callA = mock.getRpcCalls().find((c) => c.fn === 'create_family_invite');
    assert.deepEqual(callA?.args, { p_invited_name: 'Tia Helena', p_member_type: 'FAMILY' });
    assert.match(container.textContent || '', /Convite Pronto!/);
    assert.match(container.textContent || '', /Tia Helena/);
    assert.match(container.textContent || '', /Familiar/);

    // Voltar para lista
    const backBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.trim() === 'Voltar'
    );
    assert.ok(backBtn);
    await act(async () => {
      backBtn.click();
    });

    // Teste B: Criar convite Cuidador
    const openBtn2 = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('+ Novo Convite')
    );
    assert.ok(openBtn2);
    await act(async () => {
      openBtn2.click();
    });

    const nameInput2 = container.querySelector('#invite-person-name') as HTMLInputElement;
    await act(async () => {
      setReactInputValue(nameInput2, 'Enf. Carla');
    });

    const caregiverRadio = (Array.from(container.querySelectorAll('button[role="radio"]')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Cuidador')
    );
    assert.ok(caregiverRadio);
    await act(async () => {
      caregiverRadio.click();
    });

    // Adiciona um convite pendente já expirado antes de finalizar o fluxo para validar exibição na recarga
    mock.addInviteDirect({
      id: 'inv-exp',
      family_id: mock.familyId,
      created_by: 'admin-1',
      token: 'tok-exp',
      token_hash: 'hash-exp',
      status: 'pending',
      invited_name: 'Primo Lucas',
      member_type: 'FAMILY',
      expires_at: '2026-11-01T10:00:00.000Z',
      accepted_by: null,
      accepted_at: null,
      created_at: '2026-10-31T10:00:00.000Z',
    });

    const generateCaregiverBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Gerar Convite para Cuidador')
    );
    assert.ok(generateCaregiverBtn);
    await act(async () => {
      generateCaregiverBtn.click();
    });

    const callB = mock.getRpcCalls().filter((c) => c.fn === 'create_family_invite')[1];
    assert.deepEqual(callB?.args, { p_invited_name: 'Enf. Carla', p_member_type: 'CAREGIVER' });

    const backBtn2 = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.trim() === 'Voltar'
    );
    await act(async () => {
      backBtn2!.click();
    });

    const pendingSection = container.querySelector('section[aria-label="Convites Pendentes"]');
    assert.ok(pendingSection);
    const pendingText = pendingSection.textContent || '';
    assert.match(pendingText, /Tia Helena/);
    assert.match(pendingText, /Enf\. Carla/);
    assert.match(pendingText, /Primo Lucas/);
    assert.match(pendingText, /Familiar/);
    assert.match(pendingText, /Cuidador/);
    assert.match(pendingText, /Pendente/);
    assert.match(pendingText, /Expirado/);
    assert.match(pendingText, /Criado em/);
  } finally {
    await act(async () => root.unmount());
    mock.restore();
    dom.window.close();
  }
});

// ============================================================================
// TESTES C, D, E, F — ACEITAÇÃO CUIDADOR, SEÇÕES SEPARADAS, PROMOÇÃO E EXCLUSÃO
// ============================================================================

test('[Testes C, D, E, F] Aceitação como Cuidador (MEMBER), listagem separada, promoção para ADMIN e exclusão segura', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const mock = installFamilySupabaseMock('admin-1');

  try {
    // 1. ADM cria convite para cuidador ("Enf. Carla") e para familiar ("Tia Helena")
    const careInvite = await createFamilyInvite({ invitedName: 'Enf. Carla', memberType: 'CAREGIVER' });
    const famInvite = await createFamilyInvite({ invitedName: 'Tia Helena', memberType: 'FAMILY' });

    // 2. Cuidadora aceita o convite (Teste C)
    mock.setActor('caregiver-user-1');
    const acceptRes = await acceptFamilyInvite(careInvite.token);
    assert.equal(acceptRes.success, true);
    assert.equal(acceptRes.role, 'MEMBER');
    assert.equal(acceptRes.member_type, 'CAREGIVER');

    const caregiverMember = mock.getMembers().find((m) => m.user_id === 'caregiver-user-1');
    assert.ok(caregiverMember);
    assert.equal(caregiverMember.member_type, 'CAREGIVER');
    assert.equal(caregiverMember.role, 'MEMBER');

    // Familiar aceita o convite
    mock.setActor('fam-invitee-1');
    const acceptFamRes = await acceptFamilyInvite(famInvite.token);
    assert.equal(acceptFamRes.role, 'MEMBER');
    assert.equal(acceptFamRes.member_type, 'FAMILY');

    // 3. ADM abre o painel e verifica seções separadas (Teste D)
    mock.setActor('admin-1');
    await act(async () => {
      root.render(
        React.createElement(FamilyModal, {
          familyId: mock.familyId,
          currentUserId: 'admin-1',
          lovedOneName: 'Vó Lourdes',
          onClose: () => {},
        })
      );
    });

    const familySection = container.querySelector('section[aria-label="Membros da Família"]');
    const caregiversSection = container.querySelector('section[aria-label="Cuidadores"]');
    const invitesSection = container.querySelector('section[aria-label="Convites Pendentes"]');
    assert.ok(familySection);
    assert.ok(caregiversSection);
    assert.ok(invitesSection);

    const famText = familySection.textContent || '';
    const careText = caregiversSection.textContent || '';

    // Nome usado no perfil da cuidadora ('Carla Oliveira') é preservado; 'Enf. Carla' fica organizacional no convite
    assert.match(famText, /Gustavo \(ADM\)/);
    assert.match(famText, /Ana \(Irmã\)/);
    assert.match(famText, /Helena Santos/);
    assert.equal(famText.includes('Carla Oliveira'), false);

    assert.match(careText, /Carla Oliveira/);
    assert.match(careText, /Cuidador/);
    assert.match(careText, /Acompanhante/);
    assert.equal(careText.includes('Gustavo'), false);

    // Convite aceito aparece no acompanhamento com nome organizacional do convite ('Enf. Carla')
    assert.match(invitesSection.textContent || '', /Enf\. Carla/);
    assert.match(invitesSection.textContent || '', /Aceito/);

    // 4. ADM promove cuidadora para ADMIN (Teste E)
    const caregiverPromoteBtn = (Array.from(caregiversSection.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.getAttribute('title')?.includes('Promover a Administrador')
    );
    assert.ok(caregiverPromoteBtn);
    await act(async () => {
      caregiverPromoteBtn.click();
    });

    const confirmPromoteBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Confirmar Alteração')
    );
    assert.ok(confirmPromoteBtn);
    await act(async () => {
      confirmPromoteBtn.click();
    });

    const updatedCaregiver = mock.getMembers().find((m) => m.user_id === 'caregiver-user-1');
    assert.equal(updatedCaregiver?.role, 'ADMIN');
    assert.equal(updatedCaregiver?.member_type, 'CAREGIVER');

    // Continua na seção Cuidadores agora como Administrador (ADM)
    const updatedCareText = container.querySelector('section[aria-label="Cuidadores"]')?.textContent || '';
    assert.match(updatedCareText, /Carla Oliveira/);
    assert.match(updatedCareText, /Administrador \(ADM\)/);

    // 5. Exclusão de cuidador e familiar (Teste F)
    const removeCaregiverBtn = (Array.from(
      container.querySelector('section[aria-label="Cuidadores"]')!.querySelectorAll('button')
    ) as HTMLButtonElement[]).find((b) => b.getAttribute('title') === 'Remover Membro');
    assert.ok(removeCaregiverBtn);
    await act(async () => {
      removeCaregiverBtn.click();
    });
    const confirmRemoveBtn1 = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Remover Acesso')
    );
    await act(async () => {
      confirmRemoveBtn1!.click();
    });
    assert.equal(mock.getMembers().some((m) => m.user_id === 'caregiver-user-1'), false);

    // Remove familiar ('Helena Santos')
    await removeFamilyMember('fam-invitee-1', mock.familyId);
    assert.equal(mock.getMembers().some((m) => m.user_id === 'fam-invitee-1'), false);

    // Proteção do último administrador continua funcionando
    await assert.rejects(
      () => updateFamilyMemberRole('admin-1', mock.familyId, 'MEMBER'),
      { message: /pelo menos um Administrador/ }
    );
    await assert.rejects(
      () => removeFamilyMember('admin-1', mock.familyId),
      { message: /único administrador/ }
    );
  } finally {
    await act(async () => root.unmount());
    mock.restore();
    dom.window.close();
  }
});

// ============================================================================
// TESTES G & H — PERMISSÕES MEMBER + REGRESSÃO
// ============================================================================

test('[Testes G & H] MEMBER não vê ações administrativas nem consegue executar RPCs de convite/papel/exclusão; chamada legada continua compatível', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const mock = installFamilySupabaseMock('fam-member-1');

  try {
    // UI como MEMBER: sem + Novo Convite, sem seção de Convites Pendentes, sem ações de ADM
    await act(async () => {
      root.render(
        React.createElement(FamilyModal, {
          familyId: mock.familyId,
          currentUserId: 'fam-member-1',
          lovedOneName: 'Vó Lourdes',
          onClose: () => {},
        })
      );
    });

    const memberText = container.textContent || '';
    assert.match(memberText, /Membros da Família/);
    assert.match(memberText, /Cuidadores/);
    assert.equal(memberText.includes('+ Novo Convite'), false);
    assert.equal(memberText.includes('Convites Pendentes'), false);
    assert.equal(container.querySelectorAll('button[title="Remover Membro"]').length, 0);

    // MEMBER bloqueado em todas as RPCs sensíveis
    await assert.rejects(
      () => createFamilyInvite({ invitedName: 'Invasor', memberType: 'CAREGIVER' }),
      { message: /Apenas administradores/ }
    );
    await assert.rejects(
      () => updateFamilyMemberRole('fam-member-1', mock.familyId, 'ADMIN'),
      { message: /Apenas administradores/ }
    );
    await assert.rejects(
      () => removeFamilyMember('admin-1', mock.familyId),
      { message: /Apenas administradores/ }
    );

    // Escrita direta em family_members bloqueada para MEMBER
    const directUpdateRes = await (supabase as any)
      .from('family_members')
      .update({ member_type: 'CAREGIVER', role: 'ADMIN' })
      .eq('user_id', 'fam-member-1');
    assert.equal(directUpdateRes.error?.code, '42501');

    // Regressão (Teste H): chamada sem argumentos como ADM continua compatível (FAMILY + MEMBER)
    mock.setActor('admin-1');
    const legacyInvite = await createFamilyInvite();
    assert.ok(legacyInvite.token);
    assert.equal(legacyInvite.member_type, 'FAMILY');

    const loadedMembers = await getFamilyMembers(mock.familyId);
    assert.ok(loadedMembers.every((m) => m.member_type === 'FAMILY' || m.member_type === 'CAREGIVER'));
    const loadedInvites = await getFamilyInvites(mock.familyId);
    assert.equal(loadedInvites.length, 1);

    // MEMBER também é bloqueado de apagar ou limpar registros de convites
    mock.setActor('fam-member-1');
    await assert.rejects(
      () => deleteFamilyInvite(legacyInvite.invite_id),
      { message: /Apenas administradores/ }
    );
    await assert.rejects(
      () => clearFamilyInviteHistory(mock.familyId),
      { message: /Apenas administradores/ }
    );
  } finally {
    await act(async () => root.unmount());
    mock.restore();
    dom.window.close();
  }
});

// ============================================================================
// TESTE ESTÁTICO DA MIGRATION 0016 + UX EMPÁTICA DE APAGAMENTO DE CONVITES
// ============================================================================

test('[Estático SQL + React/JSDOM] Migration 0016 e UI permitem ADM apagar convites com pop-up empático preservando membros ativos', async () => {
  const sql0016 = fs.readFileSync(path.resolve('supabase/migrations/0016_delete_family_invites.sql'), 'utf8');
  assert.match(sql0016, /CREATE OR REPLACE FUNCTION public\.delete_family_invite\(p_invite_id UUID\)/);
  assert.match(sql0016, /CREATE OR REPLACE FUNCTION public\.clear_family_invite_history\(p_family_id UUID\)/);
  assert.ok(sql0016.includes('user_is_family_admin'));
  assert.ok(sql0016.includes('REVOKE ALL ON FUNCTION public.delete_family_invite(uuid) FROM PUBLIC, anon;'));
  assert.ok(sql0016.includes('GRANT EXECUTE ON FUNCTION public.delete_family_invite(uuid) TO authenticated, service_role;'));
  assert.ok(sql0016.includes('REVOKE ALL ON FUNCTION public.clear_family_invite_history(uuid) FROM PUBLIC, anon;'));
  assert.ok(sql0016.includes('GRANT EXECUTE ON FUNCTION public.clear_family_invite_history(uuid) TO authenticated, service_role;'));
  assert.equal(/DELETE FROM public\.family_members/i.test(sql0016), false);

  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const mock = installFamilySupabaseMock('admin-1');

  try {
    // 1. Cria dois convites: 1 aceito pela cuidadora + 1 pendente ativo
    const careInvite = await createFamilyInvite({ invitedName: 'Enf. Carla', memberType: 'CAREGIVER' });
    const pendingInvite = await createFamilyInvite({ invitedName: 'Tia Helena', memberType: 'FAMILY' });

    mock.setActor('caregiver-user-1');
    await acceptFamilyInvite(careInvite.token);

    mock.setActor('admin-1');
    // Adiciona mais um revogado antigo no histórico
    mock.addInviteDirect({
      id: 'inv-old-revoked',
      family_id: mock.familyId,
      created_by: 'admin-1',
      token: 'tok-rev',
      token_hash: 'hash-rev',
      status: 'revoked',
      invited_name: 'Convite antigo',
      member_type: 'FAMILY',
      expires_at: '2026-11-18T10:00:00.000Z',
      accepted_by: null,
      accepted_at: null,
      created_at: '2026-11-10T10:00:00.000Z',
    });

    await act(async () => {
      root.render(
        React.createElement(FamilyModal, {
          familyId: mock.familyId,
          currentUserId: 'admin-1',
          lovedOneName: 'Vovó Dude',
          onClose: () => {},
        })
      );
    });

    // Clica para apagar o registro individual do convite pendente 'Tia Helena'
    const deletePendingBtn = container.querySelector(
      'button[aria-label="Apagar registro de Tia Helena"]'
    ) as HTMLButtonElement;
    assert.ok(deletePendingBtn);
    await act(async () => {
      deletePendingBtn.click();
    });

    const singleDialog = container.querySelector('[role="dialog"]');
    assert.ok(singleDialog);
    const singleDialogText = singleDialog.textContent || '';
    assert.match(singleDialogText, /Fique tranquilo\(a\): ninguém perde o acesso/i);
    assert.match(singleDialogText, /não remove nenhum familiar nem cuidador/i);
    assert.match(singleDialogText, /rotina de Vovó Dude/i);

    const confirmSingleBtn = (Array.from(singleDialog.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Apagar da Lista')
    );
    assert.ok(confirmSingleBtn);
    await act(async () => {
      confirmSingleBtn.click();
    });

    assert.equal(mock.getInvites().some((i) => i.id === pendingInvite.invite_id), false);

    // Clica em 'Limpar lista' no acompanhamento recente para limpar 'Enf. Carla' (aceito) e 'Convite antigo' (revogado)
    const clearBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Limpar lista')
    );
    assert.ok(clearBtn);
    await act(async () => {
      clearBtn.click();
    });

    const bulkDialog = container.querySelector('[role="dialog"]');
    assert.ok(bulkDialog);
    const bulkDialogText = bulkDialog.textContent || '';
    assert.match(bulkDialogText, /Fique tranquilo\(a\): nenhum acesso será removido/i);
    assert.match(bulkDialogText, /Todos os familiares e cuidadores continuam acompanhando a rotina de Vovó Dude/i);

    const confirmBulkBtn = (Array.from(bulkDialog.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Limpar Registros da Tela')
    );
    assert.ok(confirmBulkBtn);
    await act(async () => {
      confirmBulkBtn.click();
    });

    assert.equal(mock.getInvites().length, 0);
    // Garante que a cuidadora que aceitou o convite CONTINUA vinculada normalmente!
    assert.equal(
      mock.getMembers().some((m) => m.user_id === 'caregiver-user-1' && m.member_type === 'CAREGIVER'),
      true
    );
  } finally {
    await act(async () => root.unmount());
    mock.restore();
    dom.window.close();
  }
});

// ============================================================================
// TESTE ESTÁTICO DA MIGRATION 0017 + FLUXO COMPLETO DE REENVIO DE CONVITE PELO ADM
// ============================================================================

test('[Estático SQL + React/JSDOM] Migration 0017 e UI permitem ADM reenviar convite (pendente ou expirado) rotacionando token e renovando 24h', async () => {
  const sql0017 = fs.readFileSync(path.resolve('supabase/migrations/0017_resend_family_invite.sql'), 'utf8');
  assert.match(sql0017, /CREATE OR REPLACE FUNCTION public\.resend_family_invite\(p_invite_id UUID\)/);
  assert.match(sql0017, /FROM public\.family_invites\s+WHERE id = p_invite_id\s+FOR UPDATE/);
  assert.ok(sql0017.includes('user_is_family_admin'));
  assert.ok(sql0017.includes("v_invite.status = 'accepted'"));
  assert.ok(sql0017.includes("v_invite.status = 'revoked'"));
  assert.match(sql0017, /v_raw_token := encode\(gen_random_bytes\(32\), 'hex'\)/);
  assert.match(sql0017, /v_hashed_token := encode\(digest\(v_raw_token, 'sha256'\), 'hex'\)/);
  assert.match(sql0017, /v_expires_at := now\(\) \+ interval '24 hours'/);
  assert.ok(sql0017.includes('pg_extension'));
  assert.ok(sql0017.includes('REVOKE INSERT, UPDATE, DELETE ON public.family_invites FROM anon, authenticated;'));
  assert.ok(sql0017.includes('REVOKE ALL ON FUNCTION public.resend_family_invite(uuid) FROM PUBLIC, anon;'));
  assert.ok(sql0017.includes('GRANT EXECUTE ON FUNCTION public.resend_family_invite(uuid) TO authenticated, service_role;'));
  assert.ok(sql0017.includes("NOTIFY pgrst, 'reload schema';"));
  assert.equal(/DROP TABLE/i.test(sql0017), false);
  assert.equal(/TRUNCATE/i.test(sql0017), false);

  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const mock = installFamilySupabaseMock('admin-1');

  try {
    // 1. ADM cria convite pendente para Tia Helena (FAMILY)
    const initialInvite = await createFamilyInvite({ invitedName: 'Tia Helena', memberType: 'FAMILY' });

    // 2. Convite expirado no banco (status = 'expired' em Acompanhamento recente) para Enf. Carla (CAREGIVER)
    mock.addInviteDirect({
      id: 'inv-expired-caregiver',
      family_id: mock.familyId,
      created_by: 'admin-1',
      token: 'tok-expired-old',
      token_hash: 'hash-expired-old',
      status: 'expired',
      invited_name: 'Enf. Carla',
      member_type: 'CAREGIVER',
      expires_at: '2026-11-10T10:00:00.000Z',
      accepted_by: null,
      accepted_at: null,
      created_at: '2026-11-09T10:00:00.000Z',
    });

    // 3. Convite revogado no histórico (NÃO deve permitir reenvio)
    mock.addInviteDirect({
      id: 'inv-revoked-no-resend',
      family_id: mock.familyId,
      created_by: 'admin-1',
      token: 'tok-revoked-no-resend',
      token_hash: 'hash-revoked-no-resend',
      status: 'revoked',
      invited_name: 'Tio Marcos',
      member_type: 'FAMILY',
      expires_at: '2026-11-18T10:00:00.000Z',
      accepted_by: null,
      accepted_at: null,
      created_at: '2026-11-16T10:00:00.000Z',
    });

    await act(async () => {
      root.render(
        React.createElement(FamilyModal, {
          familyId: mock.familyId,
          currentUserId: 'admin-1',
          lovedOneName: 'Vovó Dude',
          onClose: () => {},
        })
      );
    });

    // Convite revogado não deve exibir botão de Reenviar
    assert.equal(container.querySelector('button[aria-label="Reenviar convite de Tio Marcos"]'), null);

    // 4. ADM clica em Reenviar no convite pendente de Tia Helena
    const resendPendingBtn = container.querySelector(
      'button[aria-label="Reenviar convite de Tia Helena"]'
    ) as HTMLButtonElement;
    assert.ok(resendPendingBtn);
    await act(async () => {
      resendPendingBtn.click();
    });

    // Verifica abertura do fluxo padrão de compartilhamento com novo token e aviso de reenvio
    const modalText = container.textContent || '';
    assert.match(modalText, /Reenviar Convite/);
    assert.match(modalText, /Convite Pronto!/);
    assert.match(modalText, /Tia Helena/);
    assert.match(modalText, /Novo link gerado com validade de 24h/);
    assert.match(modalText, /Enviar Convite no WhatsApp/);

    const helenaRow = mock.getInvites().find((i) => i.id === initialInvite.invite_id)!;
    assert.notEqual(helenaRow.token, initialInvite.token);
    assert.ok(modalText.includes(`?invite=${encodeURIComponent(helenaRow.token)}`));

    // Voltar para lista principal
    const backBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.trim() === 'Voltar'
    );
    assert.ok(backBtn);
    await act(async () => {
      backBtn.click();
    });

    // 5. Link antigo de Tia Helena é rejeitado; novo link é aceito como FAMILY + MEMBER
    mock.setActor('fam-invitee-1');
    await assert.rejects(
      () => acceptFamilyInvite(initialInvite.token),
      { message: /inválido ou não encontrado/i }
    );
    const acceptNewHelena = await acceptFamilyInvite(helenaRow.token);
    assert.equal(acceptNewHelena.success, true);
    assert.equal(acceptNewHelena.member_type, 'FAMILY');
    assert.equal(acceptNewHelena.role, 'MEMBER');

    // 6. ADM reenvia convite expirado de Enf. Carla direto da seção Acompanhamento recente
    mock.setActor('admin-1');
    // Força recarregamento da lista no modal via remount com nova key
    await act(async () => {
      root.render(
        React.createElement(FamilyModal, {
          key: 'reloaded',
          familyId: mock.familyId,
          currentUserId: 'admin-1',
          lovedOneName: 'Vovó Dude',
          onClose: () => {},
        })
      );
    });

    // Agora Tia Helena está aceito (não deve exibir Reenviar); Enf. Carla está expirado (deve exibir Reenviar)
    assert.equal(container.querySelector('button[aria-label="Reenviar convite de Tia Helena"]'), null);
    const resendExpiredBtn = container.querySelector(
      'button[aria-label="Reenviar convite de Enf. Carla"]'
    ) as HTMLButtonElement;
    assert.ok(resendExpiredBtn);
    await act(async () => {
      resendExpiredBtn.click();
    });

    const carlaRow = mock.getInvites().find((i) => i.id === 'inv-expired-caregiver')!;
    assert.equal(carlaRow.status, 'pending');
    assert.equal(carlaRow.member_type, 'CAREGIVER');
    assert.notEqual(carlaRow.token, 'tok-expired-old');
    assert.ok(new Date(carlaRow.expires_at).getTime() > Date.now());
    assert.match(container.textContent || '', /Cuidador/);

    // Cuidadora aceita novo link reenviado e entra como CAREGIVER + MEMBER
    mock.setActor('caregiver-user-1');
    const acceptCarla = await acceptFamilyInvite(carlaRow.token);
    assert.equal(acceptCarla.success, true);
    assert.equal(acceptCarla.member_type, 'CAREGIVER');
    assert.equal(acceptCarla.role, 'MEMBER');

    // 7. Bloqueios RBAC e de status finais: aceito, revogado e MEMBER
    mock.setActor('admin-1');
    await assert.rejects(
      () => resendFamilyInvite(initialInvite.invite_id),
      { message: /já foi aceito/i }
    );
    await assert.rejects(
      () => resendFamilyInvite('inv-revoked-no-resend'),
      { message: /revogado/i }
    );

    const freshPending = await createFamilyInvite({ invitedName: 'Neto Pedro', memberType: 'FAMILY' });
    mock.setActor('fam-member-1');
    await assert.rejects(
      () => resendFamilyInvite(freshPending.invite_id),
      { message: /Apenas administradores/i }
    );
  } finally {
    await act(async () => root.unmount());
    mock.restore();
    dom.window.close();
  }
});

test('Migration 0019 + UI E2E: eleger ADM, remover membro e exibir erros dentro do modal z-[200]', async () => {
  // 1. Verifica integridade estrutural da migration 0019
  const sqlPath = path.resolve(
    process.cwd(),
    'supabase/migrations/0019_fix_family_member_management_rpcs.sql'
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.update_family_member_role/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.remove_family_member/i);
  assert.match(sql, /SECURITY DEFINER/i);
  assert.match(sql, /SET search_path = public/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.update_family_member_role\(UUID, UUID, TEXT\) TO authenticated, service_role/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.remove_family_member\(UUID, UUID\) TO authenticated, service_role/i);
  assert.match(sql, /UPDATE public\.profiles[\s\S]*SET family_id = v_fallback_family_id/i);
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/i);

  // 2. Fluxo E2E na UI: Eleger membro como ADM, rebaixar de volta e remover membro
  const { dom, createRoot } = await setupDom();
  const mock = installFamilySupabaseMock('admin-1');
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(FamilyModal, {
          familyId: mock.familyId,
          currentUserId: 'admin-1',
          lovedOneName: 'Vovó Dude',
          onClose: () => {},
        })
      );
    });

    // Clica em "Eleger Ana (Irmã) como Administrador"
    const promoteBtn = container.querySelector(
      'button[aria-label="Eleger Ana (Irmã) como Administrador"]'
    ) as HTMLButtonElement;
    assert.ok(promoteBtn, 'Botão de eleger Ana como ADM deve existir');
    await act(async () => {
      promoteBtn.click();
    });

    const roleDialog = container.querySelector('[role="dialog"][aria-labelledby="change-role-title"]');
    assert.ok(roleDialog, 'Modal de confirmação de papel deve abrir');
    assert.match(roleDialog.textContent || '', /Eleger como Administrador\?/);

    const confirmRoleBtn = (Array.from(roleDialog.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Confirmar Alteração')
    );
    assert.ok(confirmRoleBtn);
    await act(async () => {
      confirmRoleBtn.click();
    });

    // Modal fecha, membro vira ADMIN no estado e na lista, banner de sucesso aparece
    assert.equal(container.querySelector('[role="dialog"][aria-labelledby="change-role-title"]'), null);
    const anaAfterPromote = mock.getMembers().find((m) => m.user_id === 'fam-member-1');
    assert.equal(anaAfterPromote?.role, 'ADMIN');
    assert.match(container.textContent || '', /alterado para Administrador \(ADM\) com sucesso/);
    assert.ok(
      container.querySelector('button[aria-label="Alterar Ana (Irmã) para Acompanhante"]'),
      'Botão deve refletir novo papel de ADM imediatamente'
    );

    // 3. Simula falha PGRST202 (schema cache) e garante que o erro aparece DENTRO do modal z-[200]
    const originalRpc = supabase.rpc;
    (supabase as any).rpc = async () => ({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.remove_family_member in the schema cache',
      },
    });

    const removeBtn = container.querySelector(
      'button[aria-label="Remover Ana (Irmã) da família"]'
    ) as HTMLButtonElement;
    assert.ok(removeBtn);
    await act(async () => {
      removeBtn.click();
    });

    const removeDialog = container.querySelector('[role="dialog"][aria-labelledby="remove-member-title"]');
    assert.ok(removeDialog, 'Modal de confirmação de remoção deve abrir');

    const confirmRemoveBtn = (Array.from(removeDialog.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Remover Acesso')
    );
    assert.ok(confirmRemoveBtn);
    await act(async () => {
      confirmRemoveBtn.click();
    });

    // O erro DEVE estar visível dentro do próprio modal z-[200] (role="alert")
    const inlineAlert = removeDialog.querySelector('[role="alert"]');
    assert.ok(inlineAlert, 'Alerta de erro deve ser exibido dentro do modal de confirmação z-[200]');
    assert.match(inlineAlert.textContent || '', /migration 0019 pendente no Supabase/);

    // Ao clicar em Cancelar, limpa o erro e fecha o modal
    const cancelRemoveBtn = (Array.from(removeDialog.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.trim() === 'Cancelar'
    );
    assert.ok(cancelRemoveBtn);
    await act(async () => {
      cancelRemoveBtn.click();
    });
    assert.equal(container.querySelector('[role="dialog"][aria-labelledby="remove-member-title"]'), null);

    // 4. Restaura RPC real do mock e confirma remoção com sucesso
    (supabase as any).rpc = originalRpc;
    const removeBtnRetry = container.querySelector(
      'button[aria-label="Remover Ana (Irmã) da família"]'
    ) as HTMLButtonElement;
    assert.ok(removeBtnRetry);
    await act(async () => {
      removeBtnRetry.click();
    });

    const removeDialogRetry = container.querySelector('[role="dialog"][aria-labelledby="remove-member-title"]')!;
    const confirmRemoveRetry = (Array.from(removeDialogRetry.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.includes('Remover Acesso')
    )!;
    await act(async () => {
      confirmRemoveRetry.click();
    });

    assert.equal(container.querySelector('[role="dialog"][aria-labelledby="remove-member-title"]'), null);
    assert.equal(mock.getMembers().some((m) => m.user_id === 'fam-member-1'), false);
    const familySection = container.querySelector('section[aria-label="Membros da Família"]');
    assert.ok(familySection);
    assert.equal(familySection.textContent?.includes('Ana (Irmã)'), false);
    assert.match(container.textContent || '', /Acesso de Ana \(Irmã\) removido com sucesso\./);
  } finally {
    await act(async () => root.unmount());
    mock.restore();
    dom.window.close();
  }
});

