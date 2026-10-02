import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Actor } from '../common/actor';
import { AuthService } from './auth.service';
import { CurrentActor, Public } from './auth.decorators';
import { LoginDto, RefreshDto, RegisterDto } from './auth.dto';
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}
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
