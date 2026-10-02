import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import type { RequestUser } from '../../auth/presentation/jwt.strategy';
import { DecksService } from '../application/decks.service';
import { CreateDeckDto } from './dto/create-deck.dto';
import { RenameDeckDto } from './dto/rename-deck.dto';

@Controller('decks')
export class DecksController {
  constructor(private readonly decks: DecksService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateDeckDto) {
    return this.decks.create(user.id, dto.name);
  }

  // ?ownerId=... — mirrors CardsController's GET /cards?ownerId= pattern.
  // Public read, like everything else this app lists by owner (Vault
  // cards, listings) — a deck NAME isn't sensitive, only its cards' real
  // data already goes through their own auth where it matters.
  @Get()
  findAllForOwner(@Query('ownerId') ownerId: string) {
    return this.decks.findAllForOwner(ownerId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  rename(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: RenameDeckDto,
  ) {
    return this.decks.rename(id, user.id, dto.name);
  }

  // 204 (no body) — api.ts's request() only special-cases an empty body for
  // this status; Nest's DELETE default (200) would otherwise reach a bare
  // res.json() call on an empty response and throw.
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.decks.remove(id, user.id);
  }
}
