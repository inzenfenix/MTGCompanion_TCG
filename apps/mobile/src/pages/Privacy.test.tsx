/**
 * ROADMAP.md O15 — the Privacy screen against a mocked api.ts: it shows each
 * purpose's own text and state, toggling one purpose grants exactly that
 * purpose (with the version of the text it displayed), flow-managed purposes
 * (2FA) get no toggle, and rights requests show their outcome and deadline.
 * O16 — objection / blocking cards, and "Completar" on a public-form request.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../lib/api';
import Privacy from './Privacy';

vi.mock('../lib/auth/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'u1',
      email: 'p@example.com',
      displayName: 'Player',
      emailVerifiedAt: null,
      role: 'USER',
      createdAt: '2026-10-01T00:00:00Z',
      settings: { language: 'es-LA', theme: 'dark', twoFactorEnabled: false, notifyByEmail: false, shareLocation: false },
    },
    logout: vi.fn(),
    updateUser: vi.fn(),
  }),
}));

const purpose = (code: api.ConsentPurposeCode, selfService = true): api.ConsentPurpose => ({
  code,
  version: '1',
  title: `title-${code}`,
  text: `text-${code}`,
  dataCategories: [],
  retention: 'r',
  onRevoke: 'x',
  selfService,
  textHash: 'h'.repeat(64),
});

const state = (code: api.ConsentPurposeCode, effective: boolean): api.ConsentState => ({
  purpose: code,
  title: `title-${code}`,
  currentVersion: '1',
  status: effective ? 'GRANTED' : 'NONE',
  acceptedVersion: effective ? '1' : null,
  requiresReconsent: false,
  effective,
  grantedAt: effective ? '2026-10-20T00:00:00Z' : null,
  revokedAt: null,
  selfService: code !== 'TWO_FACTOR',
});

const objection = (code: api.ObjectionPurposeCode, active: boolean) => ({
  code,
  title: `obj-${code}`,
  description: `desc-${code}`,
  legalBasis: 'Interés legítimo',
  decision: (code === 'SALES_STATISTICS' ? 'UPHOLD' : 'DENY') as 'UPHOLD' | 'DENY',
  effect: `effect-${code}`,
  active,
  since: active ? '2026-11-07T00:00:00Z' : null,
});

const controls = (salesObjected = false, blocked = false): api.ProcessingControls => ({
  objections: [objection('SALES_STATISTICS', salesObjected), objection('SECURITY_MONITORING', false)],
  blocking: {
    active: blocked,
    basis: blocked ? 'ALTERNATIVE_TO_ERASURE' : null,
    relatedRequestId: null,
    since: blocked ? '2026-11-07T00:00:00Z' : null,
    covers: [{ what: 'Publicación en el Bazar', how: 'x' }],
    notCovered: [{ what: 'Almacenamiento', why: 'art. 8 ter' }],
  },
  history: [],
});

function renderPage() {
  return render(
    <MemoryRouter>
      <Privacy />
    </MemoryRouter>,
  );
}

describe('Privacy screen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'getConsentPurposes').mockResolvedValue([
      purpose('LOCATION_DISTANCE'),
      purpose('EMAIL_NOTIFICATIONS'),
      purpose('TWO_FACTOR', false),
    ]);
    vi.spyOn(api, 'getMyConsents').mockResolvedValue([
      state('LOCATION_DISTANCE', false),
      state('EMAIL_NOTIFICATIONS', true),
      state('TWO_FACTOR', false),
    ]);
    vi.spyOn(api, 'getMyConsentHistory').mockResolvedValue([]);
    vi.spyOn(api, 'listMyRightsRequests').mockResolvedValue([
      {
        id: 'r1',
        type: 'ERASURE',
        status: 'CLOSED',
        outcome: 'DENIED',
        message: 'Tienes compras o ventas pendientes.',
        verificationMethod: 'password',
        details: { reason: 'OPEN_TRANSACTIONS' },
        receivedAt: '2026-10-22T10:00:00Z',
        verifiedAt: '2026-10-22T10:00:00Z',
        evaluatedAt: '2026-10-22T10:00:00Z',
        executedAt: null,
        closedAt: '2026-10-22T10:00:01Z',
        dueAt: '2026-11-21T10:00:00Z',
        channel: 'APP',
        scope: null,
        relatedRequestId: null,
        expiresAt: null,
      },
    ]);
    vi.spyOn(api, 'getProcessingControls').mockResolvedValue(controls());
  });

  it('shows every purpose with its own text, and its current state', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('text-LOCATION_DISTANCE')).toBeInTheDocument());
    expect(screen.getByText('text-EMAIL_NOTIFICATIONS')).toBeInTheDocument();
    const toggle = (code: string) =>
      screen.getByTestId(`consent-${code}`).querySelector('ion-toggle') as HTMLElement & { checked: boolean };
    expect(toggle('LOCATION_DISTANCE').checked).toBe(false);
    expect(toggle('EMAIL_NOTIFICATIONS').checked).toBe(true);
  });

  it('2FA is managed by its own flow: no toggle here', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('consent-TWO_FACTOR')).toBeInTheDocument());
    expect(screen.getByTestId('consent-TWO_FACTOR').querySelector('ion-toggle')).toBeNull();
  });

  it('turning one purpose on grants only that purpose, for the version displayed', async () => {
    const grant = vi.spyOn(api, 'grantConsent').mockResolvedValue(state('LOCATION_DISTANCE', true));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('consent-LOCATION_DISTANCE')).toBeInTheDocument());
    const toggle = screen.getByTestId('consent-LOCATION_DISTANCE').querySelector('ion-toggle')!;
    fireEvent(toggle, new CustomEvent('ionChange', { detail: { checked: true } }));
    await waitFor(() => expect(grant).toHaveBeenCalledWith('LOCATION_DISTANCE', '1'));
    expect(grant).toHaveBeenCalledTimes(1);
  });

  it('turning one off revokes it', async () => {
    const revoke = vi.spyOn(api, 'revokeConsent').mockResolvedValue(state('EMAIL_NOTIFICATIONS', false));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('consent-EMAIL_NOTIFICATIONS')).toBeInTheDocument());
    const toggle = screen.getByTestId('consent-EMAIL_NOTIFICATIONS').querySelector('ion-toggle')!;
    fireEvent(toggle, new CustomEvent('ionChange', { detail: { checked: false } }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('EMAIL_NOTIFICATIONS'));
  });

  it('lists rights requests with their outcome and the grounded denial reason', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('rights-request')).toBeInTheDocument());
    expect(screen.getByText('Tienes compras o ventas pendientes.')).toBeInTheDocument();
  });

  // ── O16 ────────────────────────────────────────────────────────────────

  it('shows one objection card per legitimate-interest processing, with the denial grounds up front', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('objection-SALES_STATISTICS')).toBeInTheDocument());
    expect(screen.getByText('desc-SALES_STATISTICS')).toBeInTheDocument();
    // Denied purposes say why before the player asks.
    expect(screen.getByText('effect-SECURITY_MONITORING')).toBeInTheDocument();
  });

  it('an active objection can be withdrawn', async () => {
    vi.spyOn(api, 'getProcessingControls').mockResolvedValue(controls(true));
    const withdraw = vi.spyOn(api, 'withdrawObjection').mockResolvedValue({});
    renderPage();
    await waitFor(() => expect(screen.getByText('privacy_object_withdraw')).toBeInTheDocument());
    fireEvent.click(screen.getByText('privacy_object_withdraw'));
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith('SALES_STATISTICS'));
  });

  it('shows what blocking stops and what it keeps, and lets the holder lift it', async () => {
    vi.spyOn(api, 'getProcessingControls').mockResolvedValue(controls(false, true));
    const lift = vi.spyOn(api, 'liftBlocking').mockResolvedValue({});
    renderPage();
    await waitFor(() => expect(screen.getByTestId('blocking')).toBeInTheDocument());
    expect(screen.getByText('• Publicación en el Bazar')).toBeInTheDocument();
    expect(screen.getByText('• Almacenamiento: art. 8 ter')).toBeInTheDocument();
    fireEvent.click(screen.getByText('privacy_block_lift'));
    await waitFor(() => expect(lift).toHaveBeenCalled());
  });

  it('a public-form request waiting for the step-up offers "Completar"', async () => {
    vi.spyOn(api, 'listMyRightsRequests').mockResolvedValue([
      {
        id: 'r2',
        type: 'ACCESS',
        status: 'PENDING_STEP_UP',
        outcome: null,
        message: null,
        verificationMethod: 'email-link',
        details: null,
        receivedAt: '2026-11-07T10:00:00Z',
        verifiedAt: '2026-11-07T10:05:00Z',
        evaluatedAt: null,
        executedAt: null,
        closedAt: null,
        dueAt: '2026-12-07T10:00:00Z',
        channel: 'EMAIL_FORM',
        scope: null,
        relatedRequestId: null,
        expiresAt: '2026-11-21T10:05:00Z',
      },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('privacy_complete_button')).toBeInTheDocument());
    expect(screen.getByText('privacy_channel_form')).toBeInTheDocument();
  });
});
