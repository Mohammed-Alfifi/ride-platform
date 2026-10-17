import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { UserView } from './user.presenter';
import { CreateStaffDto, ListUsersQuery, UpdateMeDto, UpdateUserDto, UserPage } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('v1/me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'The signed-in user' })
  @ApiOkResponse({ type: UserView })
  get(@CurrentUser() user: AuthUser): Promise<UserView> {
    return this.users.getMe(user.id);
  }

  @Patch()
  @ApiOperation({ summary: 'Update name or language' })
  @ApiOkResponse({ type: UserView })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto): Promise<UserView> {
    return this.users.updateMe(user.id, dto);
  }
}

@ApiTags('admin: users')
@ApiBearerAuth()
@Controller('v1/admin/users')
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles('super_admin', 'partner_admin', 'dispatcher')
  @ApiOperation({ summary: 'List users in the caller’s partner (all partners for super admins)' })
  @ApiOkResponse({ type: UserPage })
  list(@CurrentUser() user: AuthUser, @Query() query: ListUsersQuery): Promise<UserPage> {
    return this.users.list(user, query);
  }

  @Get(':id')
  @Roles('super_admin', 'partner_admin', 'dispatcher')
  @ApiOkResponse({ type: UserView })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<UserView> {
    return this.users.getForAdmin(user, id);
  }

  @Post()
  @Roles('super_admin', 'partner_admin')
  @ApiOperation({ summary: 'Add a staff member who signs in to the admin dashboard' })
  @ApiCreatedResponse({ type: UserView })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateStaffDto, @Req() req: Request): Promise<UserView> {
    return this.users.createStaff(user, dto, req.ip);
  }

  @Patch(':id')
  @Roles('super_admin', 'partner_admin')
  @ApiOperation({ summary: 'Rename, change role or suspend a user' })
  @ApiOkResponse({ type: UserView })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Request,
  ): Promise<UserView> {
    return this.users.update(user, id, dto, req.ip);
  }
}
