import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TransactionsService } from '../application/transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post()
  create(@Body() dto: CreateTransactionDto) {
    return this.transactions.create(dto);
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
