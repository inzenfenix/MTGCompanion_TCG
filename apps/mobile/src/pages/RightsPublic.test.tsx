/**
 * ROADMAP.md O16 (docs/security/ACTIVIDAD_6.md §1) — the public rights form
 * against a mocked api.ts: it sends only what the law asks for, shows the
 * server's neutral acknowledgement, and the emailed link prefills the code.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../lib/api';
import RightsPublic from './RightsPublic';

const CODE = 'A'.repeat(43);

function renderAt(path = '/derechos') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RightsPublic />
    </MemoryRouter>,
  );
}

const ionInput = (el: Element, value: string) =>
  fireEvent(el, new CustomEvent('ionInput', { detail: { value } }));

describe('Public rights form', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'getObjectionPurposes').mockResolvedValue([]);
  });

  it('sends the address and the right, and shows the neutral acknowledgement', async () => {
    const submit = vi
      .spyOn(api, 'submitPublicRightsRequest')
      .mockResolvedValue({ received: true, message: 'Recibimos tu solicitud.' });
    const { container } = renderAt();
    ionInput(container.querySelector('ion-input[type="email"]')!, 'p@example.com');
    fireEvent.click(screen.getByText('rights_public_send'));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({ email: 'p@example.com', type: 'ACCESS' }),
    );
    expect(await screen.findByText('Recibimos tu solicitud.')).toBeInTheDocument();
  });

  it('the emailed link prefills the code; a request that needs the password says so', async () => {
    const confirm = vi.spyOn(api, 'confirmPublicRightsRequest').mockResolvedValue({
      next: 'COMPLETE_IN_APP',
      request: { outcome: null, message: null } as api.RightsRequest,
    });
    renderAt(`/derechos/confirmar?code=${CODE}`);
    fireEvent.click(screen.getByText('rights_public_confirm'));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(CODE));
    expect(await screen.findByText('rights_public_complete_in_app')).toBeInTheDocument();
  });

  it('a bad code is reported without detail', async () => {
    vi.spyOn(api, 'confirmPublicRightsRequest').mockRejectedValue(new api.ApiError(400, 'Invalid', null));
    renderAt(`/derechos/confirmar?code=${CODE}`);
    fireEvent.click(screen.getByText('rights_public_confirm'));
    expect(await screen.findByText('rights_public_bad_code')).toBeInTheDocument();
  });
});
