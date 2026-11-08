import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AuditAccess,
  setAuditContext,
} from '../../common/audit/audit-access.decorator';
import { JwtAuthGuard } from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import type { RequestUser } from '../../auth/presentation/jwt.strategy';
import { TransactionsService } from '../application/transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';

/** The other party of a transaction, from the requester's point of view. */
const counterparty = (t: unknown, userId?: string) => {
  const x = t as { buyerId?: string; sellerId?: string };
  return x.buyerId === userId ? x.sellerId : x.buyerId;
};
const idOf = (r: unknown) => (r as { id?: string })?.id;

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @AuditAccess({
    action: 'market.transaction.create',
    resourceType: 'transaction',
    resourceRef: idOf,
    target: (r) => (r as { sellerId?: string }).sellerId,
  })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateTransactionDto) {
    return this.transactions.create(user.id, dto);
  }

  // ROADMAP.md O14 — these three were public: anyone holding a user id or
  // a transaction id could read who bought what from whom, for how much.
  // Now: logged in, and only your own (buyer or seller). ?userId= other than
  // your own is a 403 — staff access is GET /admin/users/:id/transactions.
  @UseGuards(JwtAuthGuard)
  @Get()
  @AuditAccess({
    action: 'access.transaction.list',
    resourceType: 'transaction',
    reason: (r) => `n=${Array.isArray(r) ? r.length : 0}`,
  })
  findOwn(@CurrentUser() user: RequestUser, @Query('userId') userId?: string) {
    return this.transactions.findOwn(user.id, userId);
  }

  // O17: every read of a transaction is logged with the counterparty as
  // target; a 403/404 is logged too (transactions.enumeration alert).
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @AuditAccess({
    action: 'access.transaction.read',
    resourceType: 'transaction',
    param: 'id',
    target: (r, u) => counterparty(r, u?.id),
  })
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.transactions.findOneForParticipant(id, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/receipt')
  @AuditAccess({
    action: 'access.receipt.read',
    resourceType: 'transaction',
    param: 'id',
  })
  async getReceipt(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: unknown,
  ) {
    const receipt = await this.transactions.getReceipt(id, user.id);
    // The receipt carries names, not ids: look the parties up for the log.
    setAuditContext(req, {
      targetId: counterparty(await this.transactions.findOne(id), user.id),
    });
    return receipt;
  }

  // ROADMAP.md J6/J7 — seller-only, flips a PENDING cash transaction to PAID.
  @UseGuards(JwtAuthGuard)
  @Post(':id/confirm-cash-received')
  @AuditAccess({
    action: 'market.cash.confirm',
    resourceType: 'transaction',
    param: 'id',
    target: (r) => (r as { buyerId?: string }).buyerId,
  })
  confirmCashReceived(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.transactions.confirmCashReceived(id, user.id);
  }
}

// Separate controller so the /payments/webhook path (called by MercadoPago,
// not the app's own client) doesn't sit next to /transactions/:id routes.
// Declared here rather than in PaymentsModule to avoid a circular module
// import — TransactionsModule already imports PaymentsModule for
// PAYMENT_PROVIDERS, and this needs TransactionsService — the route path
// isn't tied to which module declares the controller. See
// payments.module.ts's header comment.
@Controller('payments')
export class PaymentsWebhookController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post('webhook')
  handleWebhook(
    @Body() payload: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: Record<string, string | string[] | undefined>,
  ) {
    return this.transactions.handlePaymentWebhook(payload, { headers, query });
  }
}
