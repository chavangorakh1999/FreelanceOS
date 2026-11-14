import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Auth, AuthContext } from '../common/auth';
import { ContactInput, CreateClientDto, CreateInteractionDto, ListClientsQuery, UpdateClientDto, UpdateContactDto } from './clients.dto';
import { ClientsService } from './clients.service';

const uuid = new ParseUUIDPipe();

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get() list(@Auth() a: AuthContext, @Query() q: ListClientsQuery) { return this.clients.list(a, q); }
  @Post() create(@Auth() a: AuthContext, @Body() dto: CreateClientDto) { return this.clients.create(a, dto); }
  @Get(':id') get(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.clients.get(a, id); }
  @Patch(':id') update(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: UpdateClientDto) { return this.clients.update(a, id, dto); }
  @HttpCode(204) @Post(':id/archive') archive(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.clients.setArchived(a, id, true); }
  @HttpCode(204) @Post(':id/restore') restore(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.clients.setArchived(a, id, false); }

  @Post(':id/contacts') addContact(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: ContactInput) { return this.clients.addContact(a, id, dto); }
  @Patch(':id/contacts/:contactId') updateContact(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('contactId', uuid) cid: string, @Body() dto: UpdateContactDto) { return this.clients.updateContact(a, id, cid, dto); }
  @HttpCode(204) @Post(':id/contacts/:contactId/primary') primary(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('contactId', uuid) cid: string) { return this.clients.setPrimaryContact(a, id, cid); }
  @HttpCode(204) @Post(':id/contacts/:contactId/archive') archiveContact(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('contactId', uuid) cid: string) { return this.clients.archiveContact(a, id, cid); }

  @Get(':id/interactions') interactions(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.clients.listInteractions(a, id); }
  @Post(':id/interactions') addInteraction(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: CreateInteractionDto) { return this.clients.addInteraction(a, id, dto); }
}
