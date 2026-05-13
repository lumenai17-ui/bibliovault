/**
 * Coupons Module — Phase 14
 * Built-in coupon system for subscription discounts.
 */

import { getPgPool } from './pgDatabase.js';

export interface Coupon {
  id: number;
  code: string;
  discount_percent: number;
  max_uses: number;
  current_uses: number;
  valid_from: string;
  valid_until: string | null;
  active: boolean;
  created_at: string;
}

/** Validate a coupon code — returns discount % or throws */
export async function validateCoupon(code: string): Promise<{ valid: boolean; discount: number; message: string }> {
  const pool = getPgPool();
  const res = await pool.query(
    'SELECT * FROM coupons WHERE UPPER(code) = UPPER($1)',
    [code.trim()],
  );

  const coupon = res.rows[0] as Coupon | undefined;

  if (!coupon) {
    return { valid: false, discount: 0, message: 'Cupón no encontrado' };
  }

  if (!coupon.active) {
    return { valid: false, discount: 0, message: 'Cupón desactivado' };
  }

  if (coupon.current_uses >= coupon.max_uses) {
    return { valid: false, discount: 0, message: 'Cupón agotado' };
  }

  if (coupon.valid_until && new Date(coupon.valid_until) < new Date()) {
    return { valid: false, discount: 0, message: 'Cupón expirado' };
  }

  return {
    valid: true,
    discount: coupon.discount_percent,
    message: `${coupon.discount_percent}% de descuento en el primer mes`,
  };
}

/** Mark a coupon as used */
export async function applyCoupon(code: string): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    'UPDATE coupons SET current_uses = current_uses + 1 WHERE UPPER(code) = UPPER($1)',
    [code.trim()],
  );
}

/** Create a new coupon (admin) */
export async function createCoupon(
  code: string,
  discountPercent: number,
  maxUses: number,
  validUntil: string | null,
  createdBy: string,
): Promise<Coupon> {
  const pool = getPgPool();
  const res = await pool.query(`
    INSERT INTO coupons (code, discount_percent, max_uses, valid_until, created_by)
    VALUES (UPPER($1), $2, $3, $4, $5)
    RETURNING *
  `, [code.trim(), discountPercent, maxUses, validUntil, createdBy]);
  return res.rows[0];
}

/** List all coupons (admin) */
export async function listCoupons(): Promise<Coupon[]> {
  const pool = getPgPool();
  const res = await pool.query('SELECT * FROM coupons ORDER BY created_at DESC');
  return res.rows;
}
