import { Body, Controller, Get, Header, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Actor } from '../common/actor';
import { AuthService } from './auth.service';
import { CurrentActor, Public } from './auth.decorators';
import {
  ChangePasswordDto,
  IdentityDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  UpdateAccountDto,
} from './auth.dto';
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}
  @ApiBearerAuth()
  @ApiOkResponse({ type: IdentityDto })
  @Header('Cache-Control', 'no-store')
  @Get('me')
  me(@CurrentActor() actor: Actor) {
    return this.service.me(actor);
  }
  @ApiBearerAuth()
  @ApiOkResponse({ type: IdentityDto })
  @Patch('me')
  update(@CurrentActor() actor: Actor, @Body() dto: UpdateAccountDto) {
    return this.service.updateAccount(actor, dto);
  }
  @ApiBearerAuth()
  @Post('change-password')
  changePassword(@CurrentActor() actor: Actor, @Body() dto: ChangePasswordDto) {
    return this.service.changePassword(actor, dto);
  }
  @Public() @Post('register') register(@Body() dto: RegisterDto) {
    return this.service.register(dto);
  }
  @Public() @Post('login') login(@Body() dto: LoginDto) {
    return this.service.login(dto);
  }
  @Public() @Post('refresh') refresh(@Body() dto: RefreshDto) {
    return this.service.refresh(dto.refreshToken);
  }
  @ApiBearerAuth() @Post('logout') logout(@CurrentActor() actor: Actor, @Body() dto: RefreshDto) {
    return this.service.logout(actor, dto.refreshToken);
  }
}
