import {
  Body,
  Controller,
  Get,
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
}
