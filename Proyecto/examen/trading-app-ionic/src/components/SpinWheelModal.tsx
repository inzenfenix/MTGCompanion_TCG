/**
 * ROADMAP.md L4 — the spin-the-wheel popup. A pure-CSS conic-gradient wheel
 * (no new animation library — confirmed none was a dependency, see L4's own
 * row) spun with framer-motion. The RNG is entirely server-side
 * (CouponsService.spin(), see api.ts's own comment) — this component never
 * decides the outcome, it only animates the wheel to land on whichever tier
 * the backend actually returned.
 *
 * WHEEL_TIERS mirrors backend/src/coupons/application/coupons.service.ts's
 * PRIZE_TIERS exactly (discountPercent/maxDiscount/weight) — kept in sync
 * by hand since the two apps don't share a package. Only `weight` (the
 * wedge sizes) and display color are used here; the actual prize a spin
 * wins always comes from the API response, matched back to a wedge by
 * discountPercent+maxDiscount.
 */
import React, { useCallback, useState } from 'react';
import { IonButton, IonIcon, IonModal, IonSpinner } from '@ionic/react';
import { closeOutline, giftOutline, sparklesOutline } from 'ionicons/icons';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import * as api from '../lib/api';
import './SpinWheelModal.css';

const WHEEL_TIERS: ReadonlyArray<{
  discountPercent: number;
  maxDiscount: number;
  weight: number;
  color: string;
}> = [
  { discountPercent: 5, maxDiscount: 5, weight: 60, color: '#4a0d15' },
  { discountPercent: 10, maxDiscount: 10, weight: 30, color: '#8b0000' },
  { discountPercent: 20, maxDiscount: 25, weight: 10, color: '#d4af37' },
];

const TOTAL_WEIGHT = WHEEL_TIERS.reduce((sum, t) => sum + t.weight, 0);

// Cumulative [start, end) degree ranges per wedge, clockwise from the top
// (0deg) — matches conic-gradient's own default start angle/direction, so
// the CSS background and this angle math describe the same wheel.
const WEDGE_RANGES = (() => {
  let cursor = 0;
  return WHEEL_TIERS.map((tier) => {
    const start = cursor;
    const span = (tier.weight / TOTAL_WEIGHT) * 360;
    cursor += span;
    return { start, end: cursor, center: start + span / 2 };
  });
})();

const CONIC_GRADIENT = `conic-gradient(from 0deg, ${WHEEL_TIERS.map(
  (tier, i) => `${tier.color} ${WEDGE_RANGES[i].start}deg ${WEDGE_RANGES[i].end}deg`,
).join(', ')})`;

const SPIN_DURATION_S = 3;

/** Forward-only rotation that lands `tierIndex`'s wedge center under the fixed top pointer, at least 3 full turns past `currentRotation`. */
function computeTargetRotation(currentRotation: number, tierIndex: number): number {
  const baseline = currentRotation - (currentRotation % 360);
  const targetOffset = (360 - WEDGE_RANGES[tierIndex].center) % 360;
  return baseline + 4 * 360 + targetOffset;
}

type Phase = 'idle' | 'spinning' | 'won' | 'cooldown' | 'error';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export const SpinWheelModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('idle');
  const [rotation, setRotation] = useState(0);
  const [wonCoupon, setWonCoupon] = useState<api.Coupon | null>(null);

  const handleSpin = useCallback(async () => {
    setPhase('spinning');
    try {
      const coupon = await api.spinCoupon();
      const tierIndex = WHEEL_TIERS.findIndex(
        (tier) =>
          tier.discountPercent === coupon.discountPercent &&
          tier.maxDiscount === coupon.maxDiscount,
      );
      // Unknown tier shape (shouldn't happen — WHEEL_TIERS mirrors the
      // backend by hand, see this file's header) — land on wedge 0 rather
      // than crash on a -1 index; the reveal text still shows the real
      // coupon values regardless of which wedge visually stops.
      setRotation((prev) => computeTargetRotation(prev, tierIndex >= 0 ? tierIndex : 0));
      setWonCoupon(coupon);
      // Reveal happens in onAnimationComplete below, once the wheel
      // actually finishes moving — not the instant the response arrives.
    } catch (err) {
      if (err instanceof api.ApiError && err.status === 400) {
        setPhase('cooldown');
      } else {
        setPhase('error');
      }
    }
  }, []);

  const handleAnimationComplete = useCallback(() => {
    // Only the winning spin animates the wheel — an error/cooldown result
    // never changes `rotation`, so this fires exactly once per real spin.
    if (wonCoupon) setPhase('won');
  }, [wonCoupon]);

  const handleClose = useCallback(() => {
    onClose();
    // Reset for the next time this modal opens (next day, or a manual
    // reopen) — but only once it's actually closed, so the reveal doesn't
    // flicker back to the wheel mid-dismiss animation.
    setTimeout(() => {
      setPhase('idle');
      setWonCoupon(null);
    }, 300);
  }, [onClose]);

  return (
    <IonModal isOpen={isOpen} onDidDismiss={handleClose} className="spin-wheel-modal">
      <div className="spin-wheel-content">
        <IonButton fill="clear" className="spin-wheel-close" onClick={handleClose}>
          <IonIcon icon={closeOutline} slot="icon-only" />
        </IonButton>

        <h1 className="spin-wheel-title">
          <IonIcon icon={giftOutline} /> {t('spin_wheel_title')}
        </h1>

        {phase !== 'won' && phase !== 'cooldown' && phase !== 'error' && (
          <>
            <p className="spin-wheel-subtitle">{t('spin_wheel_subtitle')}</p>
            <div className="spin-wheel-wrapper">
              <div className="spin-wheel-pointer" />
              <motion.div
                className="spin-wheel-disc"
                style={{ background: CONIC_GRADIENT }}
                animate={{ rotate: rotation }}
                transition={{ duration: SPIN_DURATION_S, ease: [0.12, 0.67, 0.2, 0.99] }}
                onAnimationComplete={handleAnimationComplete}
              >
                {WHEEL_TIERS.map((tier, i) => (
                  <span
                    key={i}
                    className="spin-wheel-label"
                    style={{ transform: `rotate(${WEDGE_RANGES[i].center}deg)` }}
                  >
                    {tier.discountPercent}%
                  </span>
                ))}
              </motion.div>
            </div>
            <IonButton
              expand="block"
              className="mtg-btn"
              disabled={phase === 'spinning'}
              onClick={handleSpin}
            >
              <div className="mtg-btn-content">
                {phase === 'spinning' ? (
                  <>
                    <IonSpinner name="crescent" /> <span>{t('spin_wheel_spinning')}</span>
                  </>
                ) : (
                  <span>{t('spin_wheel_spin_button')}</span>
                )}
              </div>
            </IonButton>
          </>
        )}

        {phase === 'won' && wonCoupon && (
          <motion.div
            className="spin-wheel-reveal"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
          >
            <IonIcon icon={sparklesOutline} className="spin-wheel-reveal-icon" />
            <h2>{t('spin_wheel_won_title')}</h2>
            <p className="spin-wheel-prize">
              {t('spin_wheel_won_prize', {
                percent: wonCoupon.discountPercent,
                cap: wonCoupon.maxDiscount,
              })}
            </p>
            <p className="spin-wheel-note">{t('spin_wheel_won_note')}</p>
            <IonButton expand="block" className="mtg-btn" onClick={handleClose}>
              <div className="mtg-btn-content"><span>{t('spin_wheel_close')}</span></div>
            </IonButton>
          </motion.div>
        )}

        {phase === 'cooldown' && (
          <div className="spin-wheel-reveal">
            <h2>{t('spin_wheel_cooldown_title')}</h2>
            <p className="spin-wheel-note">{t('spin_wheel_cooldown_message')}</p>
            <IonButton expand="block" className="mtg-btn" onClick={handleClose}>
              <div className="mtg-btn-content"><span>{t('spin_wheel_close')}</span></div>
            </IonButton>
          </div>
        )}

        {phase === 'error' && (
          <div className="spin-wheel-reveal">
            <p className="spin-wheel-note">{t('spin_wheel_error')}</p>
            <IonButton expand="block" className="mtg-btn" onClick={handleClose}>
              <div className="mtg-btn-content"><span>{t('spin_wheel_close')}</span></div>
            </IonButton>
          </div>
        )}
      </div>
    </IonModal>
  );
};

// Exported for SpinWheelModal.test.tsx — the tier→wedge angle math is worth
// testing directly rather than only through the animated component.
export { WHEEL_TIERS, computeTargetRotation };
