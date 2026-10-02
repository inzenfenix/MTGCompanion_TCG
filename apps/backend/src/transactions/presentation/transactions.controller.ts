import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import type { RequestUser } from '../../auth/presentation/jwt.strategy';
import { TransactionsService } from '../application/transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateTransactionDto) {
    return this.transactions.create(user.id, dto);
  }

  // ?userId=... returns transactions where the user is buyer or seller.
  @Get()
  findForUser(@Query('userId') userId: string) {
    return this.transactions.findForUser(userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.transactions.findOne(id);
  }

  @Get(':id/receipt')
  getReceipt(@Param('id') id: string) {
    return this.transactions.getReceipt(id);
  }

  // ROADMAP.md J6/J7 — seller-only, flips a PENDING cash transaction to PAID.
  @UseGuards(JwtAuthGuard)
  @Post(':id/confirm-cash-received')
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
