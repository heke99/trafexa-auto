import assert from 'node:assert/strict';
import test from 'node:test';
import { approve, call, C, fixture, id, prepare, S, U } from './helpers/direct-deal-harness.mjs';
import { asRole } from './crm-db/helpers.mjs';
import { capability, service } from './guest-customer-db/helpers.mjs';
import { createSourceLoader } from './helpers/source-loader.mjs';

const reserve = (db, deal) => call(db, 'reserve_vehicle', { company: C, deal, hours: 48 });

test('completed direct agreement protects its hold from expiry, release and deal cancellation', async () => {
  const db = await fixture();
  try {
    const { review } = await call(db, 'prepare_direct_deal', prepare());
    const { signing } = await call(db, 'approve_direct_deal', approve(review));
    const invitation = await capability(db, 'contract_invitation', signing.id);
    const result = await service(db, 'sign_guest_contract', [invitation.invitationId, invitation.tokenHash,
      2, invitation.documentHash, 'Synthetic Buyer', [], true, '2026-10-14', id(22)]);
    assert.equal(result.document.status, 'completed');

    const reservation = await reserve(db, review.dealId);
    const ordinaryStock = id(101);
    const { rows: [source] } = await db.query('select customer_id from public.deals where id=$1', [review.dealId]);
    await db.query(`insert into public.vehicles(id,company_id,registration_number,make,model,model_year)
      values($1,$2,'TST101','Synthetic','Car',2025)`, [id(102), C]);
    await db.query(`insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)
      values($1,$2,$3,10000000,15000000,'standard')`, [ordinaryStock, C, id(102)]);
    const ordinaryDeal = await call(db, 'create_deal', {
      company: C, stock: ordinaryStock, customer: source.customer_id, price_ore: 12500000,
    });
    const ordinaryReservation = await reserve(db, ordinaryDeal);
    await db.query("update public.reservations set expires_at=now()-interval '1 minute' where id in ($1,$2)", [reservation, ordinaryReservation]);
    const expired = await db.query('select private.expire_reservations() as count');
    assert.equal(expired.rows[0].count, 1);
    await db.query('select private.expire_stock_reservations($1)', [S]);
    await assert.rejects(() => call(db, 'release_reservation', { company: C, deal: review.dealId }), { code: '40001' });
    await assert.rejects(() => call(db, 'cancel_deal', {
      p_company_id: C, p_deal_id: review.dealId, p_expected_status: 'reserved',
      p_reason: 'Synthetic cancellation', p_request_id: id(23),
    }), { code: '40001' });

    const { rows } = await db.query(`select r.status as reservation, s.status as stock, d.status as deal
      from public.reservations r join public.stock_items s on s.id=r.stock_item_id
      join public.deals d on d.id=r.deal_id where r.id in ($1,$2) order by r.status`, [reservation, ordinaryReservation]);
    assert.deepEqual(rows, [
      { reservation: 'active', stock: 'reserved', deal: 'reserved' },
      { reservation: 'expired', stock: 'available', deal: 'draft' },
    ]);
  } finally {
    await db.close();
  }
});

test('a confirmed paper sale invalidates a separate direct approval for the same vehicle', async () => {
  const db = await fixture();
  try {
    const { review } = await call(db, 'prepare_direct_deal', prepare());
    const options = await call(db, 'get_paper_sale_options', { p_company_id: C, p_stock_item_id: S });
    const paper = await call(db, 'prepare_paper_sale', {
      p_company_id: C, p_stock_item_id: S, p_deal_id: null, p_customer_id: null,
      p_buyer: { name: 'Synthetic Other Buyer', kind: 'person', email: null, phone: null },
      p_price_ore: 12500029, p_signed_on: options.businessDate, p_paper_reference: 'TEST-STOCK-LIFECYCLE',
      p_note: 'Synthetic paper agreement', p_request_id: id(901),
    });
    await call(db, 'confirm_paper_sale', {
      p_company_id: C, p_review_id: paper.reviewId, p_review_hash: paper.reviewHash,
      p_acknowledged: true, p_request_id: id(902),
    });
    const { rows: [sale] } = await db.query('select deal_id from private.paper_sales where stock_item_id=$1', [S]);
    assert.notEqual(sale.deal_id, review.dealId);
    await assert.rejects(() => call(db, 'approve_direct_deal', approve(review)), { code: '40001' });

    const { rows } = await db.query(`select s.status as stock, d.status as deal,
      exists(select 1 from private.contract_signings where deal_id=d.id) as signing
      from public.stock_items s join public.deals d on d.stock_item_id=s.id
      where s.id=$1 and d.id=$2`, [S, review.dealId]);
    assert.deepEqual(rows, [{ stock: 'sold', deal: 'draft', signing: false }]);
  } finally {
    await db.close();
  }
});

test('direct approval accepts its own reservation and rejects a competing hold', async () => {
  const db = await fixture();
  try {
    const { review } = await call(db, 'prepare_direct_deal', prepare());
    const { rows: [source] } = await db.query('select customer_id from public.deals where id=$1', [review.dealId]);
    const otherDeal = await call(db, 'create_deal', { company: C, stock: S, customer: source.customer_id, price_ore: 12500000 });
    await reserve(db, otherDeal);
    await assert.rejects(() => call(db, 'approve_direct_deal', approve(review)), { code: '40001' });
    await call(db, 'release_reservation', { company: C, deal: otherDeal });
    await reserve(db, review.dealId);
    const receipt = await call(db, 'approve_direct_deal', approve(review));
    assert.ok(receipt.signing.id);
    await call(db, 'release_reservation', { company: C, deal: review.dealId });
    await reserve(db, otherDeal);
    assert.deepEqual(await call(db, 'approve_direct_deal', approve(review)), receipt);
  } finally {
    await db.close();
  }
});

test('reservation release compares the displayed hold even after it was replaced in the same deal', async () => {
  const db = await fixture();
  try {
    const { review } = await call(db, 'prepare_direct_deal', prepare());
    const first = await reserve(db, review.dealId);
    const release = expected_reservation => call(db, 'release_reservation_checked', { company: C, deal: review.dealId, expected_reservation });
    await release(first);
    const replacement = await reserve(db, review.dealId);
    await assert.rejects(() => release(first), { code: '40001' });
    const projection = await call(db, 'get_deal_contract_progress', { p_company_id: C, p_deal_ids: [review.dealId] });
    assert.equal(projection.rows[0].reservationId, replacement);
    const register = await call(db, 'dealer_register_page', { p_company_id: C, p_kind: 'deals', p_status: 'reserved' });
    assert.equal(register.rows.find(row => row.id === review.dealId)?.reservationId, replacement);
    await release(replacement);
    const { rows: [current] } = await db.query('select status from public.reservations where id=$1', [replacement]);
    assert.equal(current.status, 'released');
  } finally {
    await db.close();
  }
});

test('two inventory forms with the same displayed price cannot overwrite each other', async () => {
  const db = await fixture();
  try {
    const actionDb = {
      from(table) {
        assert.equal(table, 'stock_items');
        return { update({ asking_price_ore }) {
          const filters = new Map();
          const query = {
            eq(column, value) { filters.set(column, value); return query; },
            async select(columns) {
              assert.equal(columns, 'id');
              const { rows } = await asRole(db, 'authenticated', U, tx => tx.query(`update public.stock_items
                set asking_price_ore=$1 where company_id=$2 and id=$3 and asking_price_ore=$4 returning id`,
              [asking_price_ore, filters.get('company_id'), filters.get('id'), filters.get('asking_price_ore')]));
              return { data: rows, error: null };
            },
          };
          return query;
        } };
      },
    };
    const loader = await createSourceLoader({
      'next/cache': { revalidatePath() {} },
      'next/navigation': { redirect: path => { throw new Error(path); } },
      './company-context': { getCompanySession: async () => ({
        db: actionDb, user: { id: U }, membership: { company_id: C, role: 'owner' },
      }) },
    });
    const { updateVehiclePriceAction } = loader.load('@/lib/data/actions');
    function change(price) {
      const form = new FormData();
      for (const [name, value] of Object.entries({ expected_company_id: C, stock_item_id: S,
        expected_asking_price_ore: '15000000', asking_price: price })) form.set(name, value);
      return updateVehiclePriceAction(form);
    }
    const redirect = key => error => new URL(error.message, 'https://app.example.invalid').searchParams.has(key);
    await assert.rejects(change('151000'), redirect('success'));
    await assert.rejects(change('152000'), redirect('error'));
    const { rows: [stock] } = await db.query('select asking_price_ore::text as price from public.stock_items where id=$1', [S]);
    assert.equal(stock.price, '15100000');
  } finally {
    await db.close();
  }
});
