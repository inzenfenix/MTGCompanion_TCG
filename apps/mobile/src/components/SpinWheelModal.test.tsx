/**
 * ROADMAP.md L5 — the first per-component test in this app beyond
 * App.test.tsx's generic smoke test (K5 deliberately didn't add one; the
 * wheel UI is stateful/interactive enough to warrant being the exception,
 * per that row's own note). Two layers:
 *  1. computeTargetRotation()/WHEEL_TIERS — pure geometry, worth testing
 *     directly rather than only indirectly through the animated component.
 *  2. The component itself, mocking api.spinCoupon() — asserts the
 *     spin -> reveal and spin -> cooldown phase transitions render the
 *     right text, without depending on framer-motion's animation timers
 *     actually completing (onAnimationComplete is invoked directly below).
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SpinWheelModal, WHEEL_TIERS, computeTargetRotation } from './SpinWheelModal';
import * as api from '../lib/api';

describe('computeTargetRotation', () => {
  it('always lands a forward rotation whose mod-360 puts the wedge center at 0deg', () => {
    for (let tierIndex = 0; tierIndex < WHEEL_TIERS.length; tierIndex++) {
      for (const currentRotation of [0, 137, 720, 1080.5, 3599]) {
        const target = computeTargetRotation(currentRotation, tierIndex);
        expect(target).toBeGreaterThan(currentRotation);
        // The wedge's own center angle mirrors this file's WEDGE_RANGES
        // computation (not re-exported — recomputed here from weights).
        const totalWeight = WHEEL_TIERS.reduce((s, t) => s + t.weight, 0);
        let cursor = 0;
        let center = 0;
        for (let i = 0; i <= tierIndex; i++) {
          const span = (WHEEL_TIERS[i].weight / totalWeight) * 360;
          center = cursor + span / 2;
          cursor += span;
        }
        expect(target % 360).toBeCloseTo((360 - center) % 360, 5);
      }
    }
  });

  it('always spins at least 3 full turns forward, never a near-instant snap', () => {
    const target = computeTargetRotation(45, 2);
    expect(target - 45).toBeGreaterThanOrEqual(3 * 360);
  });
});

// @ionic/react's <IonModal> only mounts its children into the DOM once the
// underlying Stencil web component actually presents (a real `willPresent`
// event) — outside a full IonApp/router context in jsdom, `.present()`
// itself throws ("framework delegate is missing") and that event never
// fires. Dispatching it manually is the same event-contract the wrapper
// itself listens for (createInlineOverlayComponent, @ionic/react/dist),
// not a mock of this app's own code.
async function presentModal() {
  const modal = document.querySelector('ion-modal');
  if (!modal) throw new Error('<ion-modal> not found');
  modal.dispatchEvent(new Event('willPresent'));
  await waitFor(() => expect(document.querySelector('.spin-wheel-disc')).toBeTruthy());
}

describe('SpinWheelModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reveals the won coupon after a successful spin', async () => {
    const wonTier = WHEEL_TIERS[1]; // 10% / $10 cap
    vi.spyOn(api, 'spinCoupon').mockResolvedValue({
      id: 'coupon-1',
      issuedToUserId: 'user-1',
      discountPercent: wonTier.discountPercent,
      maxDiscount: wonTier.maxDiscount,
      redeemedAt: null,
      redeemedInTransactionId: null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    });

    const user = userEvent.setup();
    render(<SpinWheelModal isOpen={true} onClose={() => {}} />);
    await presentModal();

    await user.click(screen.getByText('spin_wheel_spin_button'));
    await waitFor(() => expect(api.spinCoupon).toHaveBeenCalled());

    // The reveal is gated on framer-motion's real onAnimationComplete (see
    // the component's own comment) — jsdom's requestAnimationFrame runs on
    // real wall-clock time, so this genuinely waits out SPIN_DURATION_S's
    // 3s spin rather than faking it, hence the longer timeout.
    await waitFor(
      () => expect(screen.getByText('spin_wheel_won_title')).toBeInTheDocument(),
      { timeout: 6000 },
    );
  });

  it('shows the cooldown message on a 400 (already spun today)', async () => {
    vi.spyOn(api, 'spinCoupon').mockRejectedValue(new api.ApiError(400, 'Already spun today', null));

    const user = userEvent.setup();
    render(<SpinWheelModal isOpen={true} onClose={() => {}} />);
    await presentModal();

    await user.click(screen.getByText('spin_wheel_spin_button'));

    // No wedge animation on the error path (rotation never changes — see
    // the component's own comment), so the cooldown text should appear as
    // soon as the rejected spinCoupon() promise settles, no waitFor needed
    // on an animation-complete callback here.
    await waitFor(() => expect(screen.getByText('spin_wheel_cooldown_title')).toBeInTheDocument());
  });
});
